import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, reserveAttempt, settleAttempt, markStaleAttempts, quotaUsed, getSession } from './lib/db.mjs';
import { createSessionService, sessionTag } from './lib/auth.mjs';
import { providerAllowed, normalizeProviderBase, callProvider } from './lib/provider.mjs';
import { hasExplicitCrisis, validateMessages } from './lib/safety.mjs';
import { upstreamFailure, contentFiltered, validateJsonCompletion, checkedSse } from './lib/responseProtocol.mjs';

const MAX_BODY = 128 * 1024;
const MAX_PROVIDER_BODY = 2 * 1024 * 1024;
const ROUTES = new Set(['/v1/health', '/v1/session', '/v1/session/revoke', '/v1/chat']);
function integerOption(options, name, fallback, minimum = 0) {
  const value = options[name] ?? fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) throw new Error(`invalid ${name}`);
  return value;
}
// A provider adapter may ignore AbortSignal. Bound the gateway's own wait,
// and dispose of a response that arrives after the attempt has been cancelled.
// This cannot undo an upstream request that has already been charged.
function waitAbortable(work, signal, disposeLate) {
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      aborted = true;
      cleanup();
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(work).then(value => {
      cleanup();
      if (aborted) { try { disposeLate?.(value); } catch {} }
      else resolve(value);
    }, error => { cleanup(); reject(error); });
  });
}
function cancelResponse(response) {
  try { void response?.body?.cancel().catch(() => {}); } catch {}
}
async function* providerChunks(body, signal) {
  if (!body) throw upstreamFailure('upstream_failed');
  const reader = body.getReader();
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await waitAbortable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) return;
      yield value;
    }
  } finally {
    // Cancellation callbacks supplied by adapters may themselves never settle.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch {}
  }
}
async function readBoundedJson(upstream, signal, maxBytes = MAX_PROVIDER_BODY) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of providerChunks(upstream.body, signal)) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw upstreamFailure('upstream_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
}
function retryAfterHeader(value) {
  if (typeof value !== 'string') return {};
  if (/^\d{1,6}$/.test(value)) return { 'retry-after': String(Math.min(600, Number(value))) };
  if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) && Number.isFinite(Date.parse(value))) return { 'retry-after': value };
  return {};
}

function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function readJson(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks = [];
    const fail = (error) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      chunks.length = 0;
      reject(error);
    };
    const timer = setTimeout(() => fail(Object.assign(new Error('request_timeout'), { status: 408 })), timeoutMs);
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(Object.assign(new Error('body_too_large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
    });
    req.on('error', fail);
    req.once('aborted', () => fail(new Error('request_aborted')));
  });
}

function sendJson(res, status, payload, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function bearer(req) {
  if (req.headersDistinct?.authorization?.length !== 1) return '';
  const raw = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1] : '';
}

function providerKey(req) {
  if (req.headersDistinct?.['x-provider-key']?.length !== 1) return '';
  const raw = req.headers['x-provider-key'];
  if (Array.isArray(raw)) return raw[0] || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

export function createGateway(options = {}) {
  const allowlist = (options.providerAllowlist || []).map(normalizeProviderBase);
  const dailyLimit = integerOption(options, 'dailyLimit', 60);
  const minuteLimit = integerOption(options, 'minuteLimit', 10);
  const concurrencyLimit = integerOption(options, 'concurrencyLimit', 2);
  // Provisional local resource ceilings, not a stable subject identity.
  const globalDailyLimit = integerOption(options, 'globalDailyLimit', 600);
  const globalConcurrencyLimit = integerOption(options, 'globalConcurrencyLimit', 8);
  const sessionIssueLimit = integerOption(options, 'sessionIssueLimit', 60);
  const providerTimeoutMs = integerOption(options, 'providerTimeoutMs', 120_000, 1);
  const requestBodyTimeoutMs = integerOption(options, 'requestBodyTimeoutMs', 10_000, 1);
  const maxPendingUploads = integerOption(options, 'maxPendingUploads', 16);
  const allowedOrigin = options.allowedOrigin ?? 'http://127.0.0.1:5173';
  let origin;
  try { origin = new URL(allowedOrigin); } catch { throw new Error('invalid allowedOrigin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== allowedOrigin) throw new Error('invalid allowedOrigin');
  const secret = options.sessionSecret ?? randomBytes(32).toString('hex');
  const ownsDb = !options.db;
  const db = options.db || openDb(options.dbPath || ':memory:');
  let sessions;
  try { sessions = createSessionService({ db, secret, ttlMs: options.sessionTtlMs, now: options.now }); }
  catch (error) { if (ownsDb) db.close(); throw error; }
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || ((event) => console.log(JSON.stringify(event)));
  const active = new Map();
  const inFlight = new Map();
  let activeTotal = 0;
  let pendingUploads = 0;
  let issueMinute = -1, issueCount = 0;
  const minuteBuckets = new Map();
  let lastSweepMinute = -1;
  let ledgerHealthy = true;

  const modelTag = value => `hmac-sha256:${createHmac('sha256', secret).update(value).digest('hex')}`;
  function log(event) {
    try { logger(event); } catch { /* logging must not break requests */ }
  }

  function ledgerCall(work) {
    try { return work(); }
    catch { ledgerHealthy = false; log({ type: 'ledger_error' }); throw upstreamFailure('ledger_unavailable', 503); }
  }
  try { markStaleAttempts(db, now() - (providerTimeoutMs + 60_000), now()); }
  catch { ledgerHealthy = false; log({ type: 'ledger_recovery_error' }); }

  function cors(req) {
    const origin = req.headers.origin;
    return origin && origin === allowedOrigin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization,x-provider-key',
          'access-control-max-age': '600',
          'access-control-expose-headers': 'retry-after',
          vary: 'origin',
        }
      : {};
  }

  async function handler(req, res) {
    const started = Date.now();
    const requestId = randomUUID();
    const headers = cors(req);
    let url;
    try {
      const target = req.url || '/';
      if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) throw new Error('invalid target');
      url = new URL(target, 'http://127.0.0.1');
    } catch { return sendJson(res, 400, { error: { code: 'invalid_request_target' } }, headers); }
    const route = ROUTES.has(url.pathname) ? url.pathname : 'not_found';
    let sessionId = null;
    let status = 500;
    let logged = false;
    const finish = () => {
      if (logged) return;
      logged = true;
      log({
        type: 'request',
        requestId,
        method: req.method,
        path: route,
        status: res.headersSent ? res.statusCode : status,
        transport: res.writableFinished ? 'finished' : 'disconnected',
        durationMs: Date.now() - started,
        session: sessionId ? sessionTag(sessionId) : undefined,
      });
    };
    res.once('finish', finish);
    res.once('close', finish);
    res.on('error', () => { /* client may drop the socket mid-response */ });

    if (req.headers.origin !== undefined && req.headers.origin !== allowedOrigin) {
      status = 403;
      return sendJson(res, status, { error: { code: 'origin_not_allowed' } }, headers);
    }

    if (req.method === 'OPTIONS') {
      status = 204;
      res.writeHead(204, headers);
      res.end();
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        status = ledgerHealthy ? 200 : 503;
        return sendJson(res, status, { ok: ledgerHealthy, phase: 'gateway-mvp', providers: allowlist.length }, headers);
      }

      if (req.method === 'POST' && url.pathname === '/v1/session') {
        if (!ledgerHealthy) { status = 503; return sendJson(res, status, { error: { code: 'ledger_unavailable' } }, headers); }
        const minute = Math.floor(now() / 60_000);
        if (issueMinute !== minute) { issueMinute = minute; issueCount = 0; }
        if (issueCount >= sessionIssueLimit) { status = 429; return sendJson(res, status, { error: { code: 'rate_limited' } }, headers); }
        const session = ledgerCall(() => sessions.issue());
        issueCount++;
        status = 201;
        return sendJson(res, status, session, headers);
      }

      if (req.method === 'POST' && url.pathname === '/v1/session/revoke') {
        const session = ledgerCall(() => sessions.verify(bearer(req)));
        if (!session) { status = 401; return sendJson(res, status, { error: { code: 'unauthorized' } }, headers); }
        sessionId = session.sessionId;
        ledgerCall(() => sessions.revoke(session.sessionId));
        for (const controller of inFlight.get(session.sessionId) ?? []) {
          controller.abort(upstreamFailure('session_revoked', 403));
        }
        status = 200;
        return sendJson(res, status, { ok: true }, headers);
      }

      if (!(req.method === 'POST' && url.pathname === '/v1/chat')) {
        status = 404;
        return sendJson(res, status, { error: { code: 'not_found' } }, headers);
      }

      const session = ledgerCall(() => sessions.verify(bearer(req)));
      if (!session) { status = 401; return sendJson(res, status, { error: { code: 'unauthorized' } }, headers); }
      sessionId = session.sessionId;

      // Bound the authenticated upload phase separately from the upstream
      // concurrency slots. Rejected/expired uploads consume no model quota.
      if (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > MAX_BODY) {
        status = 413;
        return sendJson(res, status, { error: { code: 'body_too_large' } }, { ...headers, connection: 'close' });
      }
      if (pendingUploads >= maxPendingUploads) {
        status = 429;
        return sendJson(res, status, { error: { code: 'upload_concurrency_limited' } }, { ...headers, connection: 'close' });
      }
      let body;
      pendingUploads++;
      try { body = await readJson(req, requestBodyTimeoutMs); }
      catch (error) {
        status = error.status || 400;
        const errorHeaders = { ...headers, connection: 'close' };
        return sendJson(res, status, { error: { code: status === 413 ? 'body_too_large' : status === 408 ? 'request_timeout' : error.message === 'invalid_json' ? 'invalid_json' : 'invalid_request' } }, errorHeaders);
      } finally { pendingUploads--; }

      // Authentication before body upload does not authorize a revoked/expired
      // session after the asynchronous read. Recheck before reserving any quota.
      if (req.aborted || res.destroyed) return;
      if (!ledgerCall(() => sessions.verify(bearer(req)))) { status = 401; return sendJson(res, status, { error: { code: 'unauthorized' } }, headers); }
      if (!ledgerHealthy) { status = 503; return sendJson(res, status, { error: { code: 'ledger_unavailable' } }, headers); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          !Object.keys(body).every(key => ['providerBaseUrl','model','messages','stream','maxTokens','reasoningEffort'].includes(key)) ||
          (body.stream !== undefined && typeof body.stream !== 'boolean') ||
          (body.maxTokens !== undefined && (!Number.isSafeInteger(body.maxTokens) || body.maxTokens < 1)) ||
          (body.reasoningEffort !== undefined && !['low','medium','high'].includes(body.reasoningEffort))) {
        status = 400; return sendJson(res, status, { error: { code: 'invalid_messages' } }, headers);
      }
      if (!providerAllowed(body?.providerBaseUrl, allowlist)) {
        status = 403;
        return sendJson(res, status, { error: { code: 'provider_not_allowed' } }, headers);
      }
      if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 120 || !validateMessages(body.messages)) {
        status = 400;
        return sendJson(res, status, { error: { code: 'invalid_messages' } }, headers);
      }
      const apiKey = providerKey(req);
      if (!apiKey || apiKey.length > 256) {
        status = 400;
        return sendJson(res, status, { error: { code: 'provider_key_required' } }, headers);
      }
      if (hasExplicitCrisis(body.messages)) {
        // Do not echo content, do not log it, and do not call the provider.
        status = 422;
        return sendJson(res, status, { error: { code: 'safety_blocked' } }, headers);
      }

      if (minuteLimit === 0) { status = 429; return sendJson(res, status, { error: { code: 'rate_limited' } }, headers); }
      const minute = Math.floor(now() / 60_000);
      if (minute !== lastSweepMinute) {
        for (const [key, value] of minuteBuckets) {
          if (value.minute !== minute) minuteBuckets.delete(key);
        }
        lastSweepMinute = minute;
      }
      const bucket = minuteBuckets.get(session.sessionId);
      if (!bucket || bucket.minute !== minute) minuteBuckets.set(session.sessionId, { minute, count: 1 });
      else if (bucket.count >= minuteLimit) { status = 429; return sendJson(res, status, { error: { code: 'rate_limited' } }, headers); }
      else bucket.count += 1;

      const activeCount = active.get(session.sessionId) || 0;
      if (activeCount >= concurrencyLimit || activeTotal >= globalConcurrencyLimit) {
        status = 429;
        return sendJson(res, status, { error: { code: 'concurrency_limited' } }, headers);
      }
      active.set(session.sessionId, activeCount + 1);
      activeTotal++;
      try {
        const createdAt = now();
        const day = dayKey(createdAt);
        const attemptId = randomUUID();
        const quota = ledgerCall(() => reserveAttempt(db, {
          attemptId,
          sessionId: session.sessionId,
          day,
          provider: normalizeProviderBase(body.providerBaseUrl),
          model: modelTag(body.model),
          createdAt,
          limit: dailyLimit,
          globalLimit: globalDailyLimit,
          requireActiveSession: true,
        }));
        if (!quota.ok) {
          status = quota.reason === 'unauthorized' ? 401 : 429;
          return sendJson(res, status, { error: { code: status === 401 ? 'unauthorized' : 'quota_exhausted' } }, headers);
        }

        let timedOut = false;
        let settled = false;
        const settle = (attemptStatus) => {
          if (settled) return true;
          try {
            const settledAt = now();
            if (settleAttempt(db, attemptId, attemptStatus, settledAt, attemptStatus === 'ok') !== 1) {
              if (attemptStatus === 'ok' && !getSession(db, session.sessionId, settledAt)) {
                const failure = upstreamFailure('session_revoked', 403);
                controller.abort(failure);
                throw failure;
              }
              throw new Error('settlement conflict');
            }
            settled = true;
            return true;
          } catch (error) {
            if (error?.code === 'session_revoked') throw error;
            ledgerHealthy = false; log({ type: 'ledger_error', requestId }); return false;
          }
        };

        const controller = new AbortController();
        const owned = inFlight.get(session.sessionId) ?? new Set();
        owned.add(controller); inFlight.set(session.sessionId, owned);
        const checkLive = () => {
          if (controller.signal.aborted || res.destroyed) throw controller.signal.reason ?? new DOMException('closed', 'AbortError');
          if (!ledgerCall(() => sessions.verify(bearer(req)))) {
            const failure = upstreamFailure('session_revoked', 403);
            controller.abort(failure); throw failure;
          }
          if (!ledgerHealthy) throw upstreamFailure('ledger_unavailable', 503);
        };
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, providerTimeoutMs);
        const onClose = () => { if (!res.writableFinished) controller.abort(); };
        res.once('close', onClose);
        let upstream;
        try {
          checkLive();
          upstream = await waitAbortable(callProvider({
            providerBaseUrl: body.providerBaseUrl,
            apiKey,
            model: body.model,
            messages: body.messages,
            maxTokens: Math.min(4096, Math.max(1, Number.isSafeInteger(body.maxTokens) ? body.maxTokens : 600)),
            stream: body.stream !== false,
            reasoningEffort: body.reasoningEffort,
            sessionId: session.sessionId,
            signal: controller.signal,
            fetchImpl,
          }), controller.signal, cancelResponse);
          checkLive();
          if (!upstream.ok) {
            let filtered = false;
            try { filtered = contentFiltered(await readBoundedJson(upstream, controller.signal, 64 * 1024)); } catch { /* Never forward arbitrary upstream error text. */ }
            checkLive();
            if (!settle('upstream_error')) throw upstreamFailure('ledger_unavailable', 503);
            status = filtered ? 422 : upstream.status === 429 ? 429 : [401, 403].includes(upstream.status) ? 403 : upstream.status === 402 ? 402 : upstream.status >= 400 && upstream.status < 500 ? 400 : 502;
            const code = filtered ? 'upstream_content_filtered' : status === 429 ? 'rate_limited' : status === 403 ? 'provider_auth_failed' : status === 402 ? 'provider_quota_exhausted' : status === 400 ? 'provider_request_rejected' : 'upstream_failed';
            return sendJson(res, status, { error: { code } }, { ...headers, ...(status === 429 ? retryAfterHeader(upstream.headers.get('retry-after')) : {}) });
          }
          // The supported completion protocol has one successful HTTP status.
          // A 206 partial response is not a completed model attempt, even if
          // the contained JSON or SSE happens to have a terminal marker.
          if (upstream.status !== 200) throw upstreamFailure('upstream_protocol_error');
          const mediaType = (upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
          if (mediaType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)) {
            // Some compatible providers legitimately return JSON for a streaming request.
            const result = await readBoundedJson(upstream, controller.signal);
            checkLive();
            validateJsonCompletion(result);
            if (!settle('ok')) throw upstreamFailure('ledger_unavailable', 503);
            status = 200;
            return sendJson(res, status, result, headers);
          }
          if (body.stream === false || mediaType !== 'text/event-stream' || !upstream.body) throw upstreamFailure('upstream_failed');
          const terminalTail = [];
          const sendSseHeaders = () => {
            if (res.headersSent) return;
            status = 200;
            res.writeHead(200, {
              ...headers,
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            });
          };
          for await (const event of checkedSse(providerChunks(upstream.body, controller.signal), { maxBytes: MAX_PROVIDER_BODY, checkLive })) {
            checkLive();
            // Do not give even a marker-oriented client a successful terminal
            // event until upstream EOF, authorization and durable settlement.
            // The tail is bounded by the same 2 MiB upstream cap.
            if (event.terminal) { terminalTail.push(event.wire); continue; }
            sendSseHeaders();
            if (!res.write(event.wire)) await once(res, 'drain', { signal: controller.signal });
          }
          checkLive();
          if (!settle('ok')) throw upstreamFailure('ledger_unavailable', 503);
          sendSseHeaders();
          res.end(terminalTail.join(''));
        } catch (error) {
          const aborted = controller.signal.aborted || error?.name === 'AbortError';
          const ledgerOk = settle(aborted ? (timedOut ? 'timeout' : 'aborted') : 'upstream_error');
          const revoked = controller.signal.reason?.code === 'session_revoked' || error?.code === 'session_revoked';
          const known = ['upstream_too_large','upstream_content_filtered','upstream_protocol_error','ledger_unavailable'].includes(error?.code);
          status = !ledgerOk ? 503 : revoked ? 403 : aborted ? 504 : known ? error.status : 502;
          const code = !ledgerOk ? 'ledger_unavailable' : revoked ? 'session_revoked' : aborted ? 'upstream_timeout' : known ? error.code : 'upstream_failed';
          if (!res.destroyed) {
            if (!res.headersSent) sendJson(res, status, { error: { code } }, headers);
            // A post-header protocol failure is never a clean success. The
            // client must not automatically retry an ambiguous sent attempt.
            else res.destroy();
          }
        } finally {
          clearTimeout(timer);
          owned.delete(controller); if (owned.size === 0) inFlight.delete(session.sessionId);
          res.off('close', onClose);
          controller.abort(); // Release unread bodies on non-2xx, cap, disconnect, or other failure.
          cancelResponse(upstream); // Also covers injected/non-cooperative adapters.
        }
      } finally {
        activeTotal--;
        const current = active.get(session.sessionId) || 1;
        if (current <= 1) active.delete(session.sessionId);
        else active.set(session.sessionId, current - 1);
      }
    } catch (error) {
      status = error.status || 500;
      if (!res.headersSent && !res.destroyed) sendJson(res, status, { error: { code: error?.code === 'ledger_unavailable' ? 'ledger_unavailable' : 'internal_error' } }, headers);
    }
  }

  return {
    db,
    handler,
    issueSession: sessions.issue,
    close: () => { if (ownsDb) db.close(); },
    _quotaUsed: (id) => quotaUsed(db, id, dayKey(now())),
    _sessionTag: sessionTag,
  };
}

export async function startServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1','::1'].includes(host)) throw new Error('local gateway must bind to a loopback IP');
  const shutdownTimeoutMs = integerOption(options, 'shutdownTimeoutMs', 5000, 1);
  const gateway = createGateway(options);
  const handlers = new Set();
  const server = createServer((req, res) => {
    const work = gateway.handler(req, res).catch(() => { if (!res.destroyed) res.destroy(); });
    handlers.add(work);
    void work.finally(() => handlers.delete(work));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, host, resolve);
    });
  } catch (error) { gateway.close(); throw error; }
  const address = server.address();
  let closing;
  return {
    ...gateway,
    server,
    port: address.port,
    url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    close: () => closing ??= new Promise((resolve, reject) => {
      const force = setTimeout(() => server.closeAllConnections?.(), shutdownTimeoutMs);
      force.unref?.();
      server.close(async () => {
        clearTimeout(force);
        // Socket closure precedes the async fetch rejection/ledger settlement.
        // Bound the extra wait; a non-cooperative injected upstream can still
        // leave a reserved attempt for the existing recovery process.
        let wait;
        await Promise.race([Promise.allSettled([...handlers]), new Promise(r => { wait = setTimeout(r, 1000); })]);
        clearTimeout(wait);
        try { gateway.close(); resolve(); } catch (error) { reject(error); }
      });
    }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const dbPath = process.env.GATEWAY_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'gateway.db');
  const sessionSecret = process.env.GATEWAY_SESSION_SECRET ?? randomBytes(32).toString('hex');
  const providerAllowlist = (process.env.GATEWAY_PROVIDER_ALLOWLIST || '').split(',').map((x) => x.trim()).filter(Boolean);
  const port = Number(process.env.GATEWAY_PORT || 8787);
  const allowedOrigin = process.env.GATEWAY_ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173';
  const dailyLimit = Number(process.env.GATEWAY_DAILY_LIMIT || 60);
  const minuteLimit = Number(process.env.GATEWAY_MINUTE_LIMIT || 10);
  const concurrencyLimit = Number(process.env.GATEWAY_CONCURRENCY_LIMIT || 2);
  const shutdownTimeoutMs = Number(process.env.GATEWAY_SHUTDOWN_TIMEOUT_MS || 5000);
  const globalDailyLimit = Number(process.env.GATEWAY_GLOBAL_DAILY_LIMIT ?? 600);
  const globalConcurrencyLimit = Number(process.env.GATEWAY_GLOBAL_CONCURRENCY_LIMIT ?? 8);
  const sessionIssueLimit = Number(process.env.GATEWAY_SESSION_ISSUE_LIMIT ?? 60);
  const requestBodyTimeoutMs = Number(process.env.GATEWAY_REQUEST_BODY_TIMEOUT_MS ?? 10000);
  const maxPendingUploads = Number(process.env.GATEWAY_MAX_PENDING_UPLOADS ?? 16);
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const app = await startServer({
    port, dbPath, sessionSecret, providerAllowlist, allowedOrigin,
    dailyLimit, minuteLimit, concurrencyLimit, shutdownTimeoutMs,
    globalDailyLimit, globalConcurrencyLimit, sessionIssueLimit, requestBodyTimeoutMs, maxPendingUploads,
  });
  console.log(JSON.stringify({
    type: 'startup',
    port: app.port,
    providers: providerAllowlist.length,
    persistent_db: dbPath !== ':memory:',
    warning: sessionSecret === process.env.GATEWAY_SESSION_SECRET ? undefined : 'ephemeral session secret',
  }));
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
