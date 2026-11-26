/**
 * Opt-in transport for the local model gateway (server/ prototype).
 * Enabled only when VITE_GATEWAY_URL is set at build time; the default
 * direct-provider path in llm.ts stays untouched when it is empty.
 */

export interface GatewayChatInput {
  base: string;
  providerBaseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  maxTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Runs immediately before every chat POST, never before session issuance. */
  beforeSend?: () => void;
}

interface CachedSession {
  token: string;
  expiresAt: number;
}

const SESSION_KEY = 'startnow.gateway.session.v1';
const memorySessions = new Map<string, CachedSession>();
const pendingSessions = new Map<string, Promise<CachedSession>>();
let cacheEpoch = 0;
let epochController = new AbortController();
let persistedCacheAllowed = true;
export const GATEWAY_BODY_LIMIT = 2 * 1024 * 1024;

/** Capture once, before queuing, for the entire logical gateway operation. */
export function gatewayOperationSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, epochController.signal]) : epochController.signal;
}

/** Bound a fetch wait even when an adapter does not cooperate with cancellation. */
function waitGateway<T>(work: Promise<T>, signal: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { aborted = true; cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => {
      cleanup();
      if (aborted) { try { disposeLate?.(value); } catch {} }
      else resolve(value);
    }, error => { cleanup(); reject(error); });
  });
}
function cancelResponse(res: Response): void {
  try { void res.body?.cancel().catch(() => {}); } catch {}
}
function fetchGateway(fetchImpl: typeof fetch, url: string, init: RequestInit & {signal: AbortSignal}): Promise<Response> {
  init.signal.throwIfAborted();
  return waitGateway(fetchImpl(url, init), init.signal, cancelResponse);
}

/** Cancel a pending read even when the Response body is not coupled to fetch's signal. */
export function readGatewayChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Bounded, fatal-UTF8 JSON/text reader for gateway responses only. */
export async function readGatewayText(res: Response, maxBytes = GATEWAY_BODY_LIMIT, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await readGatewayChunk(reader, signal);
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('gateway_body_too_large');
      text += decoder.decode(value, {stream:true});
    }
    return text + decoder.decode();
  } finally {
    // Do not wait on an arbitrary upstream cancellation callback.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readGatewayJson(res: Response, maxBytes = GATEWAY_BODY_LIMIT, signal?: AbortSignal): Promise<unknown> {
  const type = (res.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') { void res.body?.cancel().catch(() => {}); throw new Error('gateway_json_type'); }
  return JSON.parse(await readGatewayText(res, maxBytes, signal));
}

/** HTTPS anywhere, or HTTP on loopback only; no credentials, query or fragment. */
export function normalizeGatewayBase(value: string): string | null {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text || /[\u0000-\u0020\u007f\\?#]/.test(text) || !/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (url.username || url.password || url.search || url.hash) return null;
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) return null;
  return url.href.replace(/\/+$/, '');
}

export function resetGatewaySessions(): void {
  cacheEpoch++;
  epochController.abort(new DOMException('Gateway session cache reset', 'AbortError'));
  epochController = new AbortController();
  memorySessions.clear();
  pendingSessions.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`${SESSION_KEY}:`)) sessionStorage.removeItem(key);
      }
    }
  } catch { persistedCacheAllowed = false; } // Never re-read a failed-to-clear cache in this runtime.
}

const readCached = (base: string): CachedSession | null => {
  const memory = memorySessions.get(base);
  if (memory) return memory;
  if (!persistedCacheAllowed) return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY}:${base}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.token === 'string' && data.token.length > 0 && data.token.length <= 2048 && /^[A-Za-z0-9._-]+$/.test(data.token) && Number.isSafeInteger(data?.expiresAt)) {
      const session = { token: data.token, expiresAt: Number(data.expiresAt) };
      memorySessions.set(base, session);
      return session;
    }
  } catch { /* no sessionStorage (tests, private mode) */ }
  return null;
};

const writeCached = (base: string, session: CachedSession): void => {
  memorySessions.set(base, session);
  if (!persistedCacheAllowed) return;
  try { sessionStorage.setItem(`${SESSION_KEY}:${base}`, JSON.stringify(session)); }
  catch { /* memory copy still works for this tab */ }
};

const issueSession = async (
  base: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<CachedSession> => {
  const res = await fetchGateway(fetchImpl, `${base}/v1/session`, { method: 'POST', signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (signal.aborted) { void res.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
  // Legacy compatible gateways use 200, this gateway uses 201. A partial
  // (206) or pending (202) handshake must not authorize a credential POST.
  if (res.status !== 200 && res.status !== 201) { cancelResponse(res); throw new Error(`gateway_session_${res.status}`); }
  const data = await readGatewayJson(res, 8192, signal).catch(() => null) as { token?: unknown; expiresAt?: number } | null;
  signal.throwIfAborted();
  if (!data || typeof data.token !== 'string' || !data.token || data.token.length > 2048 || !/^[A-Za-z0-9._-]+$/.test(data.token) || typeof data.expiresAt !== 'number' || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Date.now()) {
    throw new Error('gateway_session_invalid');
  }
  const session = { token: data.token, expiresAt: Number(data.expiresAt) };
  return session;
};

// A caller may cancel its own wait without cancelling another caller's shared
// session issuance. The issuance itself has a bounded timeout and no model key.
function waitForSession(work: Promise<CachedSession>, signal?: AbortSignal): Promise<CachedSession> {
  if (!signal) return work;
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
const sessionFor = async (
  base: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  rejectedToken?: string,
): Promise<CachedSession> => {
  signal?.throwIfAborted();
  const cached = readCached(base);
  if (cached && cached.token !== rejectedToken && cached.expiresAt > Date.now()) return cached;
  let work = pendingSessions.get(base);
  if (!work) {
    const epoch = cacheEpoch;
    work = issueSession(base, fetchImpl, AbortSignal.any([epochController.signal, AbortSignal.timeout(10_000)])).then(session => {
      if (epoch === cacheEpoch) writeCached(base, session);
      return session;
    }).finally(() => { if (pendingSessions.get(base) === work) pendingSessions.delete(base); });
    pendingSessions.set(base, work);
  }
  return waitForSession(work, signal);
};

export async function gatewayChatFetch(input: GatewayChatInput): Promise<Response> {
  const base = normalizeGatewayBase(input.base);
  if (!base) throw new Error('gateway_base_invalid');
  const fetchImpl = input.fetchImpl ?? fetch;
  const signal = gatewayOperationSignal(input.signal);
  signal.throwIfAborted();
  let session = await sessionFor(base, fetchImpl, signal);
  const send = (token: string) => {
    signal.throwIfAborted();
    input.beforeSend?.();
    signal.throwIfAborted();
    return fetchGateway(fetchImpl, `${base}/v1/chat`, {
      method: 'POST',
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-provider-key': input.apiKey,
      },
      body: JSON.stringify({
        providerBaseUrl: input.providerBaseUrl,
        model: input.model,
        messages: input.messages,
        stream: input.stream,
        maxTokens: input.maxTokens,
        reasoningEffort: input.reasoningEffort,
      }),
    });
  };
  const checkedResponse = (res: Response) => {
    if (signal.aborted) { void res.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
    return res;
  };
  let res = checkedResponse(await send(session.token));
  if (res.status === 401) {
    // Only the gateway's exact pre-outbound rejection can justify re-issuance.
    // An arbitrary reverse-proxy 401 is not evidence that no attempt was sent.
    let code = '';
    try {
      const data = await readGatewayJson(res, 8192, signal);
      code = gatewayErrorCode(JSON.stringify(data));
    } catch { /* malformed/unknown 401 must not cause another credential POST */ }
    signal.throwIfAborted();
    if (code !== 'unauthorized') return new Response(JSON.stringify({error:{code:'gateway_auth_rejected'}}), {
      status:401, headers:{'content-type':'application/json'},
    });
    session = await sessionFor(base, fetchImpl, signal, session.token);
    res = checkedResponse(await send(session.token));
  }
  return res;
}

export function gatewayErrorCode(body: string): string {
  try {
    const code = JSON.parse(body)?.error?.code;
    return typeof code === 'string' ? code : '';
  } catch {
    return '';
  }
}
