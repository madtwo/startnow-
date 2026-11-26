import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from '../server.mjs';
import { listAttempts, openDb, reserveAttempt } from '../lib/db.mjs';

const SECRET = 'test-session-secret-1234567890';
const KEY = 'synthetic-provider-key';
const VALID_COMPLETION = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] };
let provider;
let providerCalls = [];

function makeProvider(stream) {
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    providerCalls.push({ url: req.url, headers: req.headers, body });
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(VALID_COMPLETION));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/v1` });
    });
  });
}

function makeRaw(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function makeApp(opts = {}) {
  const logs = [];
  const app = await startServer({
    sessionSecret: SECRET,
    providerAllowlist: [provider.url],
    dailyLimit: 100,
    minuteLimit: 100,
    providerTimeoutMs: 5000,
    logger: (event) => logs.push(event),
    ...opts,
  });
  return { app, logs };
}

async function issue(app) {
  const response = await fetch(`${app.url}/v1/session`, { method: 'POST' });
  assert.equal(response.status, 201);
  return response.json();
}

async function chat(app, token, body = {}) {
  return fetch(`${app.url}/v1/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-provider-key': KEY,
    },
    body: JSON.stringify({
      providerBaseUrl: provider.url,
      model: 'test-model',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
      ...body,
    }),
  });
}

before(async () => { provider = await makeProvider(false); });
after(async () => { await new Promise((resolve) => provider.server.close(resolve)); });

test('health is public and does not expose keys', async () => {
  const { app } = await makeApp();
  try {
    const response = await fetch(`${app.url}/v1/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.providers, 1);
    assert.equal(JSON.stringify(body).includes(KEY), false);
  } finally { await app.close(); }
});

test('chat requires a valid issued session', async () => {
  const { app } = await makeApp();
  try {
    const missing = await fetch(`${app.url}/v1/chat`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(missing.status, 401);
    const forged = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer forged.token', 'x-provider-key': KEY },
      body: '{}',
    });
    assert.equal(forged.status, 401);
  } finally { await app.close(); }
});

test('provider allowlist and BYOK key are required', async () => {
  const { app } = await makeApp();
  try {
    const session = await issue(app);
    const denied = await chat(app, session.token, { providerBaseUrl: 'http://127.0.0.1:1/v1' });
    assert.equal(denied.status, 403);
    const noKey = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ providerBaseUrl: provider.url, model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(noKey.status, 400);
    assert.equal(providerCalls.length, 0);
  } finally { await app.close(); }
});

test('explicit crisis fails closed before quota or upstream', async () => {
  const { app, logs } = await makeApp();
  try {
    const session = await issue(app);
    const before = providerCalls.length;
    const response = await chat(app, session.token, { messages: [{ role: 'user', content: '我想自杀' }] });
    assert.equal(response.status, 422);
    assert.equal(providerCalls.length, before);
    assert.equal(app._quotaUsed(session.sessionId), 0);
    assert.equal(JSON.stringify(logs).includes('自杀'), false);
  } finally { await app.close(); }
});

test('valid chat reserves quota, forwards stable session header and no stream_options', async () => {
  const { app, logs } = await makeApp();
  try {
    const session = await issue(app);
    const response = await chat(app, session.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), VALID_COMPLETION);
    assert.equal(providerCalls.length, 1);
    const call = providerCalls[0];
    assert.match(call.url, /\/v1\/chat\/completions$/);
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.match(call.headers['x-opencode-session'], /^gw_/);
    assert.equal('stream_options' in call.body, false);
    assert.equal(app._quotaUsed(session.sessionId), 1);
    assert.equal(JSON.stringify(logs).includes(KEY), false);
    assert.equal(JSON.stringify(logs).includes('你好'), false);
  } finally { await app.close(); }
});

test('quota is atomic and exhausted requests do not reach provider', async () => {
  const { app } = await makeApp({ dailyLimit: 2 });
  try {
    const session = await issue(app);
    assert.equal((await chat(app, session.token)).status, 200);
    assert.equal((await chat(app, session.token)).status, 200);
    const calls = providerCalls.length;
    const third = await chat(app, session.token);
    assert.equal(third.status, 429);
    assert.equal(providerCalls.length, calls);
    assert.equal(app._quotaUsed(session.sessionId), 2);
  } finally { await app.close(); }
});

test('concurrent requests respect per-session concurrency', async () => {
  const slow = createServer(async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(VALID_COMPLETION));
  });
  await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
  const slowUrl = `http://127.0.0.1:${slow.address().port}/v1`;
  const { app } = await makeApp({ providerAllowlist: [slowUrl], concurrencyLimit: 1 });
  try {
    const session = await issue(app);
    const request = () => fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, 'x-provider-key': KEY },
      body: JSON.stringify({ providerBaseUrl: slowUrl, model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });
    const first = request();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await request();
    assert.equal(second.status, 429);
    assert.equal((await first).status, 200);
  } finally {
    await app.close();
    await new Promise((resolve) => slow.close(resolve));
  }
});

test('expired sessions are rejected and malformed chat bodies never reach provider', async () => {
  let clock = 1_700_000_000_000;
  const { app } = await makeApp({ sessionTtlMs: 60_000, now: () => clock });
  try {
    const session = await issue(app);
    assert.equal((await chat(app, session.token)).status, 200);

    const calls = providerCalls.length;
    const invalid = await chat(app, session.token, { messages: [] });
    assert.equal(invalid.status, 400);
    assert.equal((await chat(app, session.token, { model: '' })).status, 400);
    assert.equal(providerCalls.length, calls);

    clock += 60_001;
    const expired = await chat(app, session.token);
    assert.equal(expired.status, 401);
    assert.equal(providerCalls.length, calls);
  } finally { await app.close(); }
});

test('SSE is forwarded and revocation invalidates the session', async () => {
  const sse = await makeProvider(true);
  const { app } = await makeApp({ providerAllowlist: [sse.url] });
  try {
    const session = await issue(app);
    const response = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, 'x-provider-key': KEY },
      body: JSON.stringify({ providerBaseUrl: sse.url, model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /data: .*你好/);
    const revoke = await fetch(`${app.url}/v1/session/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(revoke.status, 200);
    const afterRevoke = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, 'x-provider-key': KEY },
      body: JSON.stringify({ providerBaseUrl: sse.url, model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await app.close();
    await new Promise((resolve) => sse.server.close(resolve));
  }
});

test('client cancellation aborts upstream and frees the concurrency slot', async () => {
  let seen = 0;
  let providerClosed = false;
  const slow = await makeRaw((req, res) => {
    req.resume();
    seen += 1;
    if (seen > 1) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(VALID_COMPLETION));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
    }, 20);
    const close = () => { providerClosed = true; clearInterval(timer); };
    res.on('close', close);
    res.on('error', close);
  });
  const { app } = await makeApp({ providerAllowlist: [slow.url], concurrencyLimit: 1 });
  try {
    const session = await issue(app);
    const controller = new AbortController();
    const first = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-provider-key': KEY,
      },
      body: JSON.stringify({
        providerBaseUrl: slow.url,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    assert.equal(first.status, 200);
    controller.abort();
    try { await first.body?.cancel(); } catch { /* body already aborted */ }

    let recovered = null;
    for (let i = 0; i < 20 && !recovered; i += 1) {
      const response = await chat(app, session.token, { providerBaseUrl: slow.url });
      if (response.status === 200) recovered = response;
      else {
        assert.equal(response.status, 429);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(recovered, 'concurrency slot was not released after cancellation');
    assert.equal(providerClosed, true);
    assert.deepEqual(
      listAttempts(app.db, session.sessionId).map((row) => row.status),
      ['aborted', 'ok'],
    );
  } finally {
    app.server.closeAllConnections?.();
    await app.close();
    slow.server.closeAllConnections?.();
    await new Promise((resolve) => slow.server.close(resolve));
  }
});

test('shutdown is bounded with an in-flight stream', async () => {
  const slow = await makeRaw((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const timer = setInterval(() => { if (!res.destroyed) res.write('data: {}\n\n'); }, 20);
    res.on('close', () => clearInterval(timer));
    res.on('error', () => clearInterval(timer));
  });
  const { app } = await makeApp({ providerAllowlist: [slow.url], shutdownTimeoutMs: 80 });
  const controller = new AbortController();
  let streaming;
  let closed = false;
  try {
    const session = await issue(app);
    streaming = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-provider-key': KEY,
      },
      body: JSON.stringify({
        providerBaseUrl: slow.url,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    assert.equal(streaming.status, 200);
    const started = Date.now();
    await app.close();
    closed = true;
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `close took ${elapsed}ms`);
  } finally {
    if (!closed) await app.close();
    controller.abort();
    try { await streaming?.body?.cancel(); } catch { /* already torn down */ }
    slow.server.closeAllConnections?.();
    await new Promise((resolve) => slow.server.close(resolve));
  }
});

test('multi-byte SSE split inside a character is forwarded intact', async () => {
  const payload = Buffer.from('data: {"choices":[{"delta":{"content":"你好世界"}}]}\n\ndata: [DONE]\n\n');
  const cut = payload.indexOf(Buffer.from('你')) + 1;
  const splitProvider = await makeRaw((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(payload.subarray(0, cut));
    setTimeout(() => {
      res.write(payload.subarray(cut));
      res.end();
    }, 10);
  });
  const { app } = await makeApp({ providerAllowlist: [splitProvider.url] });
  try {
    const session = await issue(app);
    const response = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-provider-key': KEY,
      },
      body: JSON.stringify({
        providerBaseUrl: splitProvider.url,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), payload.toString('utf8'));
  } finally {
    await app.close();
    await new Promise((resolve) => splitProvider.server.close(resolve));
  }
});

test('oversized bodies are rejected and the gateway stays alive', async () => {
  const { app } = await makeApp();
  try {
    const session = await issue(app);
    const calls = providerCalls.length;
    const response = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-provider-key': KEY,
      },
      body: JSON.stringify({
        providerBaseUrl: provider.url,
        model: 'm',
        messages: [{ role: 'user', content: 'x'.repeat(200 * 1024) }],
      }),
    });
    assert.equal(response.status, 413);
    assert.equal(providerCalls.length, calls);
    assert.equal(app._quotaUsed(session.sessionId), 0);
    assert.equal((await fetch(`${app.url}/v1/health`)).status, 200);
  } finally { await app.close(); }
});

test('upstream timeout maps to 504 and still meters the attempt', async () => {
  const hang = await makeRaw((req) => {
    req.on('error', () => {});
  });
  const { app } = await makeApp({ providerAllowlist: [hang.url], providerTimeoutMs: 100 });
  try {
    const session = await issue(app);
    const response = await chat(app, session.token, { providerBaseUrl: hang.url });
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: { code: 'upstream_timeout' } });
    assert.equal(app._quotaUsed(session.sessionId), 1);
  } finally {
    await app.close();
    hang.server.closeAllConnections?.();
    await new Promise((resolve) => hang.server.close(resolve));
  }
});

test('upstream 500, redirects and non-JSON replies all fail closed', async () => {
  const upstream = await makeRaw((req, res) => {
    req.resume();
    if (req.url === '/fail/chat/completions') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"boom"}');
      return;
    }
    if (req.url === '/redirect/chat/completions') {
      res.writeHead(302, { location: 'https://example.com/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
  const bases = ['/fail', '/redirect', '/plain'].map((prefix) => upstream.url + prefix);
  const { app } = await makeApp({ providerAllowlist: bases });
  try {
    const session = await issue(app);
    for (const base of bases) {
      const response = await chat(app, session.token, { providerBaseUrl: base });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: { code: 'upstream_failed' } });
    }
    assert.equal(app._quotaUsed(session.sessionId), 3);
  } finally {
    await app.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  }
});

test('quota rolls over at UTC midnight', async () => {
  let clock = Date.UTC(2026, 10, 25, 23, 59, 30);
  const { app } = await makeApp({ dailyLimit: 1, now: () => clock });
  try {
    const session = await issue(app);
    assert.equal((await chat(app, session.token)).status, 200);
    assert.equal((await chat(app, session.token)).status, 429);
    assert.equal(app._quotaUsed(session.sessionId), 1);

    clock += 60_000;
    assert.equal(app._quotaUsed(session.sessionId), 0);
    assert.equal((await chat(app, session.token)).status, 200);
    assert.equal(app._quotaUsed(session.sessionId), 1);
  } finally { await app.close(); }
});

test('attempt ledger records only outbound attempts and settles each one', async () => {
  const fail = await makeRaw((req, res) => {
    req.resume();
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
  });
  const hang = await makeRaw((req) => {
    req.on('error', () => {});
  });
  const { app } = await makeApp({
    providerAllowlist: [provider.url, fail.url, hang.url],
    providerTimeoutMs: 80,
  });
  try {
    const session = await issue(app);
    assert.equal((await chat(app, session.token, { providerBaseUrl: 'http://127.0.0.1:1/v1' })).status, 403);
    assert.equal((await chat(app, session.token, { messages: [{ role: 'user', content: '我想自杀' }] })).status, 422);
    assert.equal((await chat(app, session.token, { messages: [] })).status, 400);
    assert.equal(listAttempts(app.db, session.sessionId).length, 0);

    assert.equal((await chat(app, session.token)).status, 200);
    assert.equal((await chat(app, session.token, { providerBaseUrl: fail.url })).status, 502);
    assert.equal((await chat(app, session.token, { providerBaseUrl: hang.url })).status, 504);

    const rows = listAttempts(app.db, session.sessionId);
    assert.deepEqual(rows.map((row) => row.status), ['ok', 'upstream_error', 'timeout']);
    assert.ok(rows.every((row) => row.settled_at !== null));
    assert.equal(app._quotaUsed(session.sessionId), 3);
  } finally {
    await app.close();
    await new Promise((resolve) => fail.server.close(resolve));
    hang.server.closeAllConnections?.();
    await new Promise((resolve) => hang.server.close(resolve));
  }
});

test('stale reserved attempts are settled as unknown on startup', async () => {
  const db = openDb(':memory:');
  const clock = 10_000_000;
  const base = { sessionId: 's', day: '2026-01-01', provider: 'p', model: 'm', limit: 10 };
  reserveAttempt(db, { ...base, attemptId: 'stale', createdAt: clock - 120_000 });
  reserveAttempt(db, { ...base, attemptId: 'fresh', createdAt: clock - 1_000 });
  const { app } = await makeApp({ db, now: () => clock });
  try {
    assert.deepEqual(
      listAttempts(db, 's').map((row) => [row.id, row.status]),
      [['stale', 'unknown'], ['fresh', 'reserved']],
    );
  } finally {
    await app.close();
    db.close();
  }
});

test('crisis wording in system prompts is not treated as user crisis input', async () => {
  const { app } = await makeApp();
  try {
    const session = await issue(app);
    const response = await chat(app, session.token, {
      messages: [
        { role: 'system', content: '规则：命中自杀/自残时必须停止生成并展示热线。' },
        { role: 'user', content: '论文写不出来，很焦虑。' },
      ],
    });
    assert.equal(response.status, 200);
    assert.equal(app._quotaUsed(session.sessionId), 1);
  } finally { await app.close(); }
});

test('invisible characters do not bypass the explicit crisis guard', async () => {
  const { app, logs } = await makeApp();
  try {
    const session = await issue(app);
    const calls = providerCalls.length;
    const response = await chat(app, session.token, { messages: [{ role: 'user', content: '我想自\u200b杀' }] });
    assert.equal(response.status, 422);
    assert.equal(providerCalls.length, calls);
    assert.equal(app._quotaUsed(session.sessionId), 0);
    assert.equal(JSON.stringify(logs).includes('自杀'), false);
  } finally { await app.close(); }
});

test('provider URLs with credentials, queries or fragments are denied', async () => {
  const { app } = await makeApp();
  try {
    const session = await issue(app);
    const calls = providerCalls.length;
    const denied = [
      provider.url + '?token=x',
      provider.url + '#frag',
      provider.url.replace('http://', 'http://user:pass@'),
    ];
    for (const base of denied) {
      assert.equal((await chat(app, session.token, { providerBaseUrl: base })).status, 403);
    }
    assert.equal(providerCalls.length, calls);
  } finally { await app.close(); }
});

test('streamed responses stop at the 2 MiB cap', async () => {
  const chunk = Buffer.from(':' + 'a'.repeat(64 * 1024 - 3) + '\n\n');
  const big = await makeRaw((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let sent = 0;
    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed || sent >= 3 * 1024 * 1024) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(chunk);
      sent += chunk.length;
    }, 1);
    res.on('close', () => clearInterval(timer));
    res.on('error', () => clearInterval(timer));
  });
  const { app } = await makeApp({ providerAllowlist: [big.url] });
  try {
    const session = await issue(app);
    const response = await fetch(`${app.url}/v1/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
        'x-provider-key': KEY,
      },
      body: JSON.stringify({
        providerBaseUrl: big.url,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    assert.equal(response.status, 200);
    // A cap violation after HTTP 200 headers is a transport error, not clean EOF.
    let bytes = 0;
    await assert.rejects(async () => { for await (const chunk of response.body) bytes += chunk.byteLength; });
    assert.ok(bytes <= 2 * 1024 * 1024, `received ${bytes} bytes`);
    assert.equal(listAttempts(app.db, session.sessionId)[0].status, 'upstream_error');
  } finally {
    await app.close();
    big.server.closeAllConnections?.();
    await new Promise((resolve) => big.server.close(resolve));
  }
});
