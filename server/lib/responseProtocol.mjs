// The local gateway accepts a bounded OpenAI-compatible text protocol only.
// A valid transport is not evidence that a role really completed an action.
export function upstreamFailure(code, status = 502) {
  return Object.assign(new Error(code), { code, status });
}
export function contentFiltered(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload.choices) && payload.choices.some(c => c?.finish_reason === 'content_filter')) return true;
  let error = payload.error;
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    if ([error.code, error.type].some(v => typeof v === 'string' && /^(?:content[_-]?filter(?:ed)?|responsibleaipolicyviolation)$/i.test(v))) return true;
    error = error.innererror ?? error.inner_error;
  }
  return false;
}
function invalid() { throw upstreamFailure('upstream_protocol_error'); }
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// Check visibility without rewriting legitimate text (e.g. emoji joiners).
const hasVisibleText = text => /[^\s\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}]/u.test(text);
function textContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(x => isObject(x) && typeof x.text === 'string' && (x.type === undefined || x.type === 'text'))) return value.map(x => x.text).join('');
  invalid();
}
function checkEnvelope(payload) {
  if (contentFiltered(payload)) throw upstreamFailure('upstream_content_filtered', 422);
  if (!isObject(payload) || payload.error != null) invalid();
}
function checkChoice(choice) {
  if (!isObject(choice) || (choice.index !== undefined && choice.index !== 0) || (choice.finish_reason != null && choice.finish_reason !== 'stop')) invalid();
}
function checkPart(part) {
  if (part == null) return;
  if (!isObject(part) || part.tool_calls != null || part.function_call != null ||
      (part.role != null && part.role !== 'assistant')) invalid();
  // A mixed text/refusal response is not a successful text completion.
  if (part.refusal != null && part.refusal !== '') throw upstreamFailure('upstream_content_filtered', 422);
}
export function validateJsonCompletion(payload) {
  checkEnvelope(payload);
  if (!Array.isArray(payload.choices) || payload.choices.length !== 1) invalid();
  const choice = payload.choices[0];
  checkChoice(choice);
  if (choice.finish_reason !== 'stop' || !isObject(choice.message)) invalid();
  checkPart(choice.message);
  const text = textContent(choice.message.content);
  if (!hasVisibleText(text) || text.length > 20_000 || choice.delta != null) invalid();
}

// Buffer at most one event, not the whole response. Validate a whole event
// before forwarding it, so raw error details cannot leak in a split frame.
// LF/CRLF and standard multi-line data are supported. The existing direct
// transport remains unchanged. Incomplete final events are rejected.
export async function* checkedSse(body, { maxBytes, checkLive }) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', raw = '', data = [], bytes = 0, visible = 0, events = 0;
  let badEvent = false, filterEvent = false;
  let stopped = false, done = false, nonWhitespace = false;
  function apply(value) {
    if (done) invalid();
    if (value === '[DONE]') { done = true; return; }
    let obj;
    try { obj = JSON.parse(value); } catch { invalid(); }
    checkEnvelope(obj);
    // A metadata-only heartbeat/usage event is legal, but cannot complete.
    if (obj.choices === undefined) return;
    if (!Array.isArray(obj.choices) || obj.choices.length > 1) invalid();
    if (obj.choices.length === 0) return;
    const c = obj.choices[0];
    checkChoice(c);
    for (const part of [c.delta, c.message]) checkPart(part);
    // A choice may provide a delta OR a message, not competing text sources.
    if (c.delta?.content != null && c.message?.content != null) invalid();
    const text = textContent(c.delta?.content ?? c.message?.content);
    if (stopped && text) invalid();
    visible += text.length;
    if (visible > 20_000) invalid();
    if (hasVisibleText(text)) nonWhitespace = true;
    if (c.finish_reason === 'stop') stopped = true;
  }
  function flush() {
    if (++events > 8192) invalid();
    if (filterEvent) throw upstreamFailure('upstream_content_filtered', 422);
    if (badEvent) invalid();
    if (data.length) {
      const joined = data.join('\n').trim();
      // Match the client's existing compatibility for providers that omit
      // blank separators. Parse syntactically first; never mutate state while
      // guessing whether a joined event was valid JSON.
      let validJoined = joined === '[DONE]';
      if (!validJoined) { try { JSON.parse(joined); validJoined = true; } catch {} }
      if (validJoined) apply(joined);
      else if (data.length > 1) {
        const lines = data.map(x => x.trim());
        for (const line of lines) if (line !== '[DONE]') { try { JSON.parse(line); } catch { invalid(); } }
        for (const line of lines) apply(line);
      } else invalid();
    }
    const result = raw;
    raw = ''; data = []; badEvent = false; filterEvent = false;
    return { wire: result, terminal: stopped || done };
  }
  function* consume(text) {
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline + 1);
      buffer = buffer.slice(newline + 1);
      raw += line;
      if (raw.length > 256_000) invalid();
      const clean = line.slice(0, -1).replace(/\r$/, '');
      if (clean.includes('\r')) invalid();
      if (clean === '') { const event = flush(); if (event.wire) yield event; }
      else if (clean === 'data' || clean.startsWith('data:')) data.push(clean === 'data' ? '' : clean.slice(5).replace(/^ /, ''));
      else if (clean.startsWith('event:')) {
        const name = clean.slice(6).trim().toLowerCase();
        if (name === 'content_filter') filterEvent = true;
        if (/^(?:error|response[._-](?:error|failed|incomplete))$/.test(name)) badEvent = true;
      }
      // Other SSE fields are ignored, as specified by the event format.
    }
    if (buffer.length + raw.length > 256_000) invalid();
  }
  for await (const chunk of body) {
    checkLive();
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw upstreamFailure('upstream_too_large');
    yield* consume(decoder.decode(chunk, { stream: true }));
  }
  checkLive();
  yield* consume(decoder.decode());
  // Compatibility: a complete final data line without a blank separator is
  // accepted only if it parses and the stream has a valid terminal marker.
  if (buffer) yield* consume('\n');
  if (raw) { const event = flush(); if (event.wire) yield event; }
  if ((!done && !stopped) || !nonWhitespace) invalid();
}
