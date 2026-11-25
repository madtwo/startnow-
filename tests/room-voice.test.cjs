// Room voice boundary: ordinary peer suggestions are human-sounding; commands
// stay blocked. Keep the same tickRoom response path, not a direct string test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const room = lib('room');
const { defaultPersonas } = lib('personas');
const now = new Date(2026, 10, 25, 15, 0).getTime();
const config = { providerId: 'compatible', baseUrl: 'https://audit.invalid/v1', model: 'replay', fallbackModel: '', apiKey: 'synthetic-only' };
const settings = { liveliness: 0, timeFlow: false, dailyMessages: 100 };

function inputRoom() {
  const r = room.newRoom(defaultPersonas().slice(0, 4), now, 'Voice audit');
  const message = { id: 'voice-message', authorId: 'me', authorKind: 'player', authorName: 'Audit', text: '室友半夜打游戏很吵，说过两次还是这样。', at: now, kind: 'chat' };
  return {
    ...r,
    messages: [message],
    scheduled: [{ id: 'voice-reply', personaId: r.cast[0].id, at: now + 1, intent: 'reply', replyTo: message.id, depth: 0 }],
    steps: [],
    usage: { day: new Date(now).toDateString(), messages: 0 },
    lastMessageAt: now, lastSeenAt: now,
  };
}

async function reply(content) {
  const old = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    return await room.tickRoom({ room: inputRoom(), config, settings, now: now + 1000 });
  } finally {
    global.fetch = old;
  }
}

test('room accepts ordinary "你可以试试" peer phrasing', async () => {
  const out = await reply('我室友也这样，你可以试试买副耳塞，睡觉戴上会安静一点。');
  const added = out.room.messages.filter((message) => message.authorKind === 'persona');
  assert.equal(added.length, 1, out.logs.join(' '));
  assert.match(added[0].text, /耳塞/);
});

test('room still blocks command-style advice', async () => {
  const out = await reply('建议你买副耳塞。');
  const added = out.room.messages.filter((message) => message.authorKind === 'persona');
  assert.equal(added.length, 0);
  assert.ok(out.logs.some((line) => /未通过安全或内容校验/.test(line)), out.logs);
});
