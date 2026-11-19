const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { commentPrompt } = lib('prompts');
const { tickCards } = lib('cards');
const { defaultPersonas } = lib('personas');
const { defaultSettings } = lib('store');

const now = 1_800_000_000_000;
const people = defaultPersonas();
const config = { providerId: 'compatible', apiKey: 'local-fixture-key', model: 'deepseek-v4.1-flash', baseUrl: 'https://example.test/v1' };
const settings = { ...defaultSettings, paused: false, aiCardLimit: 8, maxCallsPerTick: 2, speed: 6 };
const card = (kind, text, extra = {}) => ({
  id: `care-${kind}`, authorId: 'me', authorName: '匿', authorKind: 'player',
  kind, text, createdAt: now - 60_000, status: 'talking', arrivals: [], plan: [], pending: [], comments: [], ...extra,
});
const shenmo = people.find((persona) => persona.id === 'shenmo');
const json = (text) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: text } }],
  usage: { prompt_tokens: 50, completion_tokens: 30 },
}), { status: 200, headers: { 'content-type': 'application/json' } });
async function fakeFetch(handler, run) {
  const old = global.fetch;
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return handler();
  };
  try { return { output: await run(), calls }; } finally { global.fetch = old; }
}
function careCard() {
  return card('worry', '背病理两页就摸一次手机。', {
    comments: [
      { id: 'p0', authorId: 'shenmo', authorKind: 'persona', text: '我背两页就摸一次手机。', at: now - 20_000 },
      { id: 'p1', authorId: 'me', authorKind: 'player', text: '我的话一般会把手机锁起来', at: now - 10_000, peer: 'shenmo' },
    ],
    pending: [{ personaId: 'shenmo', at: now - 1, phase: 'reply', sourceCommentId: 'p1' }],
    arrivals: ['shenmo'],
  });
}
async function generate(handler) {
  return fakeFetch(handler, () => tickCards({
    cards: [careCard()], personas: people, settings, config, now,
  }));
}

test('different card kinds carry different reply constraints', () => {
  assert.match(commentPrompt(card('brag', '今天把第一段写完了。'), shenmo), /完成\/炫耀卡/);
  assert.match(commentPrompt(card('life', '食堂鸡腿饭今天很好吃。'), shenmo), /生活分享卡/);
  assert.match(commentPrompt(card('goal', '这周把综述框架发出去。'), shenmo), /目标\/进度卡/);
  assert.match(commentPrompt(card('worry', '今天没做完。', { vulnerability: { kind: 'missed', personaId: 'shenmo', at: now } }), shenmo), /没做到\/失败卡/);
});

test('care turn keeps the first self-disclosure but removes the follow-up question', async () => {
  const { output } = await generate(() => json('锁起来这招我试过，撑了十分钟就找借口拿回来了。你是怎么做到不惦记的？'));
  const reply = output.cards[0].comments.filter((row) => row.authorId === 'shenmo').at(-1);
  assert.equal(reply.text, '锁起来这招我试过，撑了十分钟就找借口拿回来了。');
  assert.doesNotMatch(reply.text, /[?？]|你是怎么/);
  assert.match(output.logs.join(' '), /关心场景剔除问句/);
});

test('a clean self-report in a care turn is kept as model output', async () => {
  const selfReport = '累倒不累，就是手比脑子快，解锁完才反应过来自己在干嘛。';
  const { output } = await generate(() => json(selfReport));
  const reply = output.cards[0].comments.filter((row) => row.authorId === 'shenmo').at(-1);
  assert.equal(reply.text, selfReport);
  assert.equal(reply.origin, 'model');
});

test('a self-clause followed by a question in the same sentence is retained', async () => {
  const { output } = await generate(() => json('我复习两页就摸一次手机，你复习的时候会不会也这样？'));
  const reply = output.cards[0].comments.filter((row) => row.authorId === 'shenmo').at(-1);
  assert.equal(reply.text, '我复习两页就摸一次手机，');
  assert.doesNotMatch(reply.text, /[?？]|你复习/);
});

test('invalid care output gets one stricter retry before falling back', async () => {
  let calls = 0;
  const { output } = await generate(() => {
    calls += 1;
    return json(calls === 1 ? '你可以试试把手机交给室友。' : '我试过把手机放远，还是会惦记。');
  });
  const reply = output.cards[0].comments.filter((row) => row.authorId === 'shenmo').at(-1);
  assert.equal(reply.text, '我试过把手机放远，还是会惦记。');
  assert.equal(calls, 2);
  assert.match(output.logs.join(' '), /重试通过/);
});

test('advice-only model output after retry falls back to a calm self-report', async () => {
  const { output } = await generate(() => json('你可以试试把手机交给室友，肯定能管住。'));
  const reply = output.cards[0].comments.filter((row) => row.authorId === 'shenmo').at(-1);
  assert.match(reply.text, /我|自己/);
  assert.doesNotMatch(reply.text, /[?？]|你可以|试试/);
  assert.match(output.logs.join(' '), /关心场景仍不合格/);
});