/**
 * Per-endpoint chat response limiter. A slot spans the entire streamed response,
 * not merely fetch() returning headers. Neither credentials nor prompt content
 * are ever stored in the queue. Independent provider URLs have separate pools.
 */
export const MAX_PROVIDER_IN_FLIGHT = 2;

type Release = () => void;
type Waiting = {
  signal?: AbortSignal;
  resolve: (release: Release) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
};
type Pool = { active: number; waiting: Waiting[] };
const pools = new Map<string, Pool>();
const poolKey = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '');
const abortedError = () => new DOMException('请求已取消。', 'AbortError');

function discardEmpty(key: string, pool: Pool): void {
  if (pool.active === 0 && pool.waiting.length === 0 && pools.get(key) === pool) {
    pools.delete(key);
  }
}

function createRelease(key: string, pool: Pool): Release {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pool.active--;
    // FIFO, including cancelled entries, with exactly one replacement per slot.
    while (pool.waiting.length) {
      const next = pool.waiting.shift()!;
      next.signal?.removeEventListener('abort', next.onAbort);
      if (next.signal?.aborted) {
        next.reject(abortedError());
        continue;
      }
      pool.active++;
      next.resolve(createRelease(key, pool));
      break;
    }
    discardEmpty(key, pool);
  };
}

function acquire(baseUrl: string, signal?: AbortSignal): Promise<Release> {
  if (signal?.aborted) return Promise.reject(abortedError());
  const key = poolKey(baseUrl);
  let pool = pools.get(key);
  if (!pool) {
    pool = { active: 0, waiting: [] };
    pools.set(key, pool);
  }
  const current = pool;
  return new Promise<Release>((resolve, reject) => {
    if (current.active < MAX_PROVIDER_IN_FLIGHT && current.waiting.length === 0) {
      current.active++;
      resolve(createRelease(key, current));
      return;
    }
    const waiting: Waiting = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const position = current.waiting.indexOf(waiting);
        if (position < 0) return;
        current.waiting.splice(position, 1);
        signal?.removeEventListener('abort', waiting.onAbort);
        reject(abortedError());
        discardEmpty(key, current);
      },
    };
    current.waiting.push(waiting);
    signal?.addEventListener('abort', waiting.onAbort, { once: true });
    // Handle a signal cancelled during registration or an unusual custom signal.
    if (signal?.aborted) waiting.onAbort();
  });
}

/** The work callback is invoked only after acquiring a provider slot. */
export async function withProviderRequestSlot<T>(
  baseUrl: string, signal: AbortSignal | undefined, work: () => Promise<T>,
): Promise<T> {
  const release = await acquire(baseUrl, signal);
  try {
    if (signal?.aborted) throw abortedError();
    return await work();
  } finally {
    release();
  }
}

/** A 429 stops the already queued burst, rather than sending it straight back
 * to a rate-limited provider. Active requests and future user actions are not
 * cancelled; the existing caller-level backoff and Retry-After remain in charge.
 */
export function rejectQueuedProviderRequests(baseUrl: string, error: Error): number {
  const key = poolKey(baseUrl);
  const pool = pools.get(key);
  if (!pool) return 0;
  const waiting = pool.waiting.splice(0);
  for (const request of waiting) {
    request.signal?.removeEventListener('abort', request.onAbort);
    request.reject(error);
  }
  discardEmpty(key, pool);
  return waiting.length;
}
