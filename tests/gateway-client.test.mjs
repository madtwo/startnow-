import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  gatewayChatFetch,
  gatewayErrorCode,
  normalizeGatewayBase,
  resetGatewaySessions,
} from '../src/lib/gatewayClient.ts';

beforeEach(() => resetGatewaySessions());

const response = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

const baseInput = {
  base: 'http://127.0.0.1:8787',
  providerBaseUrl: 'http://127.0.0.1:9999/v1',
  apiKey: 'synthetic-key',
  model: 'test-model',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
  maxTokens: 600,
};

test('normalizeGatewayBase only allows https or loopback http', () => {
  assert.equal(normalizeGatewayBase('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeGatewayBase('https://gw.example.com'), 'https://gw.example.com');
  assert.equal(normalizeGatewayBase('http://gw.example.com'), null);
  assert.equal(normalizeGatewayBase('http://user:pass@127.0.0.1:8787'), null);
  assert.equal(normalizeGatewayBase('http://127.0.0.1:8787?x=1'), null);
  assert.equal(normalizeGatewayBase(''), null);
});

test('chat reuses one session and sends the gateway contract', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/session')) {
      return response(201, { token: 'tok-1', expiresAt: Date.now() + 3_600_000 });
    }
    return response(200, { ok: true });
  };

  const first = await gatewayChatFetch({ ...baseInput, fetchImpl });
  assert.equal(first.status, 200);
  await gatewayChatFetch({ ...baseInput, fetchImpl });

  assert.equal(calls.filter((c) => c.url.endsWith('/v1/session')).length, 1);
  const chat = calls.find((c) => c.url.endsWith('/v1/chat'));
  assert.equal(chat.url, 'http://127.0.0.1:8787/v1/chat');
  assert.equal(chat.init.headers.authorization, 'Bearer tok-1');
  assert.equal(chat.init.headers['x-provider-key'], 'synthetic-key');
  const body = JSON.parse(chat.init.body);
  assert.deepEqual(body, {
    providerBaseUrl: 'http://127.0.0.1:9999/v1',
    model: 'test-model',
    messages: [{ role: 'user', content: '你好' }],
    stream: true,
    maxTokens: 600,
  });
});

test('a 401 re-issues the session and retries once', async () => {
  let sessions = 0;
  let chats = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/session')) {
      sessions += 1;
      return response(201, { token: `tok-${sessions}`, expiresAt: Date.now() + 3_600_000 });
    }
    chats += 1;
    return chats === 1 ? response(401, { error: { code: 'unauthorized' } }) : response(200, { ok: true });
  };

  const res = await gatewayChatFetch({ ...baseInput, fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(sessions, 2);
  assert.equal(chats, 2);
});

test('gatewayErrorCode reads only string error codes', () => {
  assert.equal(gatewayErrorCode('{"error":{"code":"safety_blocked"}}'), 'safety_blocked');
  assert.equal(gatewayErrorCode('{"error":{}}'), '');
  assert.equal(gatewayErrorCode('not json'), '');
});
