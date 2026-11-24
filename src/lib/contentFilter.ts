/** Provider safety signals must never trigger fallback or compatibility retry. */
export function isContentFilteredResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const row = payload as {choices?: {finish_reason?: unknown}[]; error?: unknown};
  if (Array.isArray(row.choices) && row.choices.some(c => c?.finish_reason === 'content_filter')) return true;
  let error = row.error;
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    const e = error as {code?: unknown; type?: unknown; innererror?: unknown; inner_error?: unknown};
    if ([e.code,e.type].some(v => typeof v === 'string' && /^(?:content[_-]?filter(?:ed)?|responsibleaipolicyviolation)$/i.test(v))) return true;
    error = e.innererror ?? e.inner_error;
  }
  return false;
}
export function isContentFilteredBody(body: string): boolean {
  try { return isContentFilteredResponse(JSON.parse(body)); } catch { return false; }
}
