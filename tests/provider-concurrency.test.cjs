'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const {
  MAX_PROVIDER_IN_FLIGHT, withProviderRequestSlot, rejectQueuedProviderRequests,
} = lib('providerConcurrency');
const { streamChat, testConnection, LlmError } = lib('llm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const cfg = (baseUrl = 'https://concurrency.test/v1') => ({
  providerId: 'compatible', baseUrl, model: 'unit-test', apiKey: 'placeholder-not-real',
});
const streamOpts = (signal = AbortSignal.timeout(3000), baseUrl) => ({
  config: cfg(baseUrl), signal, messages: [{ role: 'user', content: 'unit test' }],
  onDelta: () => {}, maxTokens: 250,
});
const jsonResponse = (text = '测试结束') => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: text } }],
}), { headers: { 'content-type': 'application/json' } });

test('C01 per-provider capacity is exactly two and queued work runs FIFO', async () => {
  assert.equal(MAX_PROVIDER_IN_FLIGHT, 2);
  const hold = Array.from({ length: 5 }, deferred);
  const starts = [];
  let active = 0;
  let peak = 0;
  const jobs = hold.map((d, i) => withProviderRequestSlot('https://fifo.test/v1', undefined, async () => {
    starts.push(i); active++; peak = Math.max(peak, active);
    await d.promise;
    active--;
    return i;
  }));
  await flush();
  assert.deepEqual(starts, [0, 1]);
  for (let i = 0; i < hold.length; i++) {
    hold[i].resolve();
    await flush();
    assert.deepEqual(starts, [0, 1, 2, 3, 4].slice(0, Math.min(5, i + 3)));
  }
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('C02 independent provider paths have separate quotas', async () => {
  const hold = deferred();
  let active = 0;
  const keys = ['/api/opencode/v1', '/api/opencode-go/v1'];
  const jobs = keys.flatMap(key => [0, 1].map(() => withProviderRequestSlot(key, undefined, async () => {
    active++;
    await hold.promise;
    active--;
  })));
  await flush();
  assert.equal(active, 4);
  hold.resolve();
  await Promise.all(jobs);
  assert.equal(active, 0);
});

test('C03 queued abort removes work and never invokes its callback', async () => {
  const hold = deferred();
  const active = [0, 1].map(() => withProviderRequestSlot('https://abort.test/v1', undefined, () => hold.promise));
  const controller = new AbortController();
  let invoked = false;
  const pending = withProviderRequestSlot('https://abort.test/v1', controller.signal, async () => {
    invoked = true;
  });
  await flush();
  controller.abort();
  await assert.rejects(pending, err => err.name === 'AbortError');
  assert.equal(invoked, false);
  hold.resolve();
  await Promise.all(active);
  await withProviderRequestSlot('https://abort.test/v1', undefined, async () => { invoked = true; });
  assert.equal(invoked, true);
});

test('C04 rejected work and double calls cannot lose or duplicate a slot', async () => {
  const hold = deferred();
  const a = withProviderRequestSlot('https://release.test/v1', undefined, async () => { throw new Error('offline failure'); });
  const b = withProviderRequestSlot('https://release.test/v1', undefined, () => hold.promise);
  let started = false;
  const c = withProviderRequestSlot('https://release.test/v1', undefined, async () => { started = true; });
  await assert.rejects(a, /offline failure/);
  await c;
  assert.equal(started, true);
  hold.resolve();
  await b;
  await withProviderRequestSlot('https://release.test/v1', undefined, async () => 'still works');
});

test('C05 one 429 rejects only the queued burst and preserves Retry-After error', async () => {
  const hold = deferred();
  const key = 'https://burst.test/v1';
  const a = withProviderRequestSlot(key, undefined, () => hold.promise);
  const b = withProviderRequestSlot(key, undefined, () => hold.promise);
  let reached = 0;
  const queue = [0, 1, 2].map(() => withProviderRequestSlot(key, undefined, async () => { reached++; }));
  const rate = new LlmError('rate', '请求太频繁（429）', 90_000);
  assert.equal(rejectQueuedProviderRequests(key, rate), 3);
  for (const p of queue) await assert.rejects(p, err => err === rate);
  assert.equal(reached, 0);
  hold.resolve();
  await Promise.all([a, b]);
  assert.equal(rejectQueuedProviderRequests(key, rate), 0);
  await withProviderRequestSlot(key, undefined, async () => { reached++; });
  assert.equal(reached, 1);
});

test('C06 a provider slot spans streaming SSE content, not only fetch headers', async () => {
  const previous = global.fetch;
  const controllers = [];
  global.fetch = async () => new Response(new ReadableStream({
    start(ctrl) { controllers.push(ctrl); },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const feed = (controller) => {
    controller.enqueue(new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"测试结束"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
    ));
    controller.close();
  };
  try {
    const a = streamChat(streamOpts());
    const b = streamChat(streamOpts());
    const c = streamChat(streamOpts());
    await flush();
    assert.equal(controllers.length, 2, 'third request must not fetch before an SSE slot finishes');
    feed(controllers[0]);
    assert.equal(await a, '测试结束');
    await flush();
    assert.equal(controllers.length, 3);
    feed(controllers[1]);
    feed(controllers[2]);
    assert.deepEqual(await Promise.all([b, c]), ['测试结束', '测试结束']);
  } finally { global.fetch = previous; }
});

test('C07 queued stream timeout is classified as timeout and never sends request', async () => {
  const previous = global.fetch;
  const hold = deferred();
  let posts = 0;
  global.fetch = async () => { posts++; await hold.promise; return jsonResponse(); };
  try {
    const a = streamChat(streamOpts());
    const b = streamChat(streamOpts());
    await flush();
    assert.equal(posts, 2);
    const ctl = new AbortController();
    const pending = streamChat(streamOpts(ctl.signal));
    await flush();
    ctl.abort(new DOMException('test expiry', 'TimeoutError'));
    await assert.rejects(pending, err => err instanceof LlmError && err.kind === 'timeout');
    assert.equal(posts, 2);
    hold.resolve();
    await Promise.all([a, b]);
  } finally { global.fetch = previous; }
});

test('C08 a 429 response prevents queued network calls and fallback retry', async () => {
  const previous = global.fetch;
  const first = deferred();
  const second = deferred();
  const posts = [];
  global.fetch = async (_url, options) => {
    posts.push(JSON.parse(options.body).model);
    return (posts.length === 1 ? first : second).promise;
  };
  try {
    const options = { ...streamOpts(), config: { ...cfg('https://burst-http.test/v1'), fallbackModel: 'backup' } };
    const a = streamChat(options);
    const b = streamChat(options);
    const c = streamChat(options);
    await flush();
    assert.equal(posts.length, 2);
    first.resolve(new Response(JSON.stringify({ error: { message: 'slow down' } }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '95' },
    }));
    await assert.rejects(a, err => err instanceof LlmError && err.kind === 'rate' && err.retryAfterMs === 95_000);
    await assert.rejects(c, err => err instanceof LlmError && err.kind === 'rate');
    assert.equal(posts.length, 2, 'queued call must not hit provider after 429');
    second.resolve(jsonResponse());
    await b;
    assert.deepEqual(posts, ['unit-test', 'unit-test'], 'fallback must not fire on 429');
  } finally { global.fetch = previous; }
});

test('C09 testConnection shares the same provider slots as streamed messages', async () => {
  const previous = global.fetch;
  const gate = deferred();
  let posts = 0;
  global.fetch = async () => { posts++; await gate.promise; return jsonResponse(); };
  try {
    const a = streamChat(streamOpts());
    const b = streamChat(streamOpts());
    await flush();
    const c = testConnection(cfg());
    await flush();
    assert.equal(posts, 2);
    gate.resolve();
    assert.equal(await a, '测试结束');
    assert.equal(await b, '测试结束');
    assert.match(await c, /连接成功/);
    assert.equal(posts, 3);
  } finally { global.fetch = previous; }
});

test('C10 an already-aborted signal does not acquire a slot or invoke callback', async () => {
  const ctl = new AbortController(); ctl.abort();
  let posts = 0;
  await assert.rejects(withProviderRequestSlot('https://preabort.test/v1', ctl.signal,
    async () => { posts++; }), err => err.name === 'AbortError');
  assert.equal(posts, 0);
  await withProviderRequestSlot('https://preabort.test/v1', undefined, async () => { posts++; });
  assert.equal(posts, 1);
});

test('C11 trailing slash aliases share a pool, without leaking into other endpoints', async () => {
  const hold = deferred();
  let entered = 0;
  const first = withProviderRequestSlot('/api/opencode/v1/', undefined, async () => { entered++; await hold.promise; });
  const second = withProviderRequestSlot('/api/opencode/v1', undefined, async () => { entered++; await hold.promise; });
  let thirdEntered = false;
  const third = withProviderRequestSlot('/api/opencode/v1/', undefined, async () => { thirdEntered = true; });
  await flush();
  assert.equal(entered, 2);
  assert.equal(thirdEntered, false);
  hold.resolve();
  await Promise.all([first, second, third]);
  assert.equal(thirdEntered, true);
});

test('C12 timeout during queued connection test is classified and sends no HTTP call', async () => {
  const previous = global.fetch;
  const hold = deferred();
  let posts = 0;
  global.fetch = async () => { posts++; await hold.promise; return jsonResponse(); };
  try {
    const a = streamChat(streamOpts());
    const b = streamChat(streamOpts());
    await flush();
    const ctl = new AbortController();
    const pending = testConnection(cfg(), ctl.signal);
    await flush();
    ctl.abort(new DOMException('test timeout', 'TimeoutError'));
    await assert.rejects(pending, err => err instanceof LlmError && err.kind === 'timeout');
    assert.equal(posts, 2);
    hold.resolve();
    await Promise.all([a, b]);
  } finally { global.fetch = previous; }
});
