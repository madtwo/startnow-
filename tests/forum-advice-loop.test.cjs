const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { looksLikeActionableAdvice } = lib('brag');
const { addPlayerComment, tickCards } = lib('cards');
const { defaultPersonas } = lib('personas');
const { defaultSettings } = lib('store');

const now = 1_800_000_000_000;
const people = defaultPersonas();
const mock = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const settings = { ...defaultSettings, paused: false, aiCardLimit: 0, maxCallsPerTick: 2, speed: 6 };
const personaWorry = (extra = {}) => ({
  id: 'persona-worry', authorId: 'shenmo', authorName: '沈默', authorKind: 'persona',
  kind: 'worry', text: '背病理两页就摸一次手机。', createdAt: now - 60_000,
  status: 'talking', arrivals: [], plan: [], pending: [], comments: [], ...extra,
});
const playerWorry = (extra = {}) => ({
  ...personaWorry({ authorId: 'me', authorName: '匿', authorKind: 'player' }), ...extra,
});

test('natural actionable suggestions are detected; care and self-reflection are not', () => {
  assert.equal(looksLikeActionableAdvice('我的话一般会把手机锁起来'), true);
  assert.equal(looksLikeActionableAdvice('你可以试试把手机放远'), true);
  assert.equal(looksLikeActionableAdvice('把手机锁起来'), true);
  assert.equal(looksLikeActionableAdvice('你复习两页就摸手机，会不会很累？'), false);
  assert.equal(looksLikeActionableAdvice('我也背不进去'), false);
});

test('a natural suggestion on a persona own worry enters decide, pure care stays reply', () => {
  const suggestion = addPlayerComment(personaWorry(), '我的话一般会把手机锁起来', now, 6);
  assert.equal(suggestion.comments.at(-1).kind, 'comment');
  assert.equal(suggestion.pending.at(-1).phase, 'decide');

  const care = addPlayerComment(personaWorry(), '你背两页就摸手机，会不会很累？', now, 6);
  assert.equal(care.pending.at(-1).phase, 'reply');

  const onPlayerCard = addPlayerComment(playerWorry(), '我的话一般会把手机锁起来', now, 6, 'comment', 'shenmo');
  assert.equal(onPlayerCard.pending.at(-1).phase, 'reply');
});

test('accepted "你可以试试…" still schedules a brag; user wording is not tone-blocked', async () => {
  const card = addPlayerComment(personaWorry({
    id: 'weini-worry', authorId: 'weini', authorName: '魏霓',
    text: '开题报告的第二部分一直开不了头。',
  }), '你可以试试先把开头两句写下来', now, 6);
  const oldRandom = Math.random;
  Math.random = () => 0.1;
  try {
    const out = await tickCards({ cards: [card], personas: people, settings, config: mock, now: now + 20_000 });
    const saved = out.cards.find((row) => row.id === card.id);
    assert.equal(saved.advice?.accepted, true);
    assert.ok(saved.pendingBrag);
  } finally {
    Math.random = oldRandom;
  }
});

test('accepted natural suggestion schedules the normal fictional brag without an advice tag', async () => {
  const card = addPlayerComment(personaWorry(), '我的话一般会把手机锁起来', now, 6);
  const oldRandom = Math.random;
  Math.random = () => 0.1;
  try {
    const out = await tickCards({ cards: [card], personas: people, settings, config: mock, now: now + 20_000 });
    const saved = out.cards.find((row) => row.id === card.id);
    assert.equal(saved.comments.at(-1).authorId, 'shenmo');
    assert.equal(saved.advice?.accepted, true);
    assert.equal(saved.advice?.sourceCommentId, card.comments.at(-1).id);
    assert.ok(saved.pendingBrag);
    assert.equal(saved.status, 'advised');
    assert.match(out.logs.join(' '), /brag scheduled/);
  } finally {
    Math.random = oldRandom;
  }
});