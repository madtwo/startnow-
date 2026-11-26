export function normalizeProviderBase(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('providerBaseUrl required');
  const text = value.trim();
  if (/[\u0000-\u0020\u007f\\?#]/.test(text) || !/^https?:\/\//i.test(text)) throw new Error('invalid providerBaseUrl syntax');
  const url = new URL(text);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error('providerBaseUrl must be HTTPS or local loopback HTTP without credentials');
  }
  return url.href.replace(/\/+$/, '');
}

export function providerAllowed(value, allowlist) {
  try {
    const normalized = normalizeProviderBase(value);
    return allowlist.some((item) => normalizeProviderBase(item) === normalized);
  } catch { return false; }
}

export async function callProvider({
  providerBaseUrl, apiKey, model, messages, maxTokens, stream, reasoningEffort, sessionId, signal, fetchImpl = fetch,
}) {
  const base = normalizeProviderBase(providerBaseUrl);
  const response = await fetchImpl(`${base}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-opencode-session': `gw_${sessionId}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: Boolean(stream),
      max_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  });
  return response;
}
