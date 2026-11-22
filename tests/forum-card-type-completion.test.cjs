'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { adoptCommentAdvice, acceptAdvice, completeCard, tickCards } = lib('cards');
const { canUseNextStep, isActionableStepText } = lib('cardPolicy');
const { completedActionAnchor } = lib('completionReaction');
const { forumReplyModeProblem } = lib('forumReplyPolicy');
const { defaultPersonas } = lib('personas');
const { defaultSettings } = lib('store');

const NOW = 1_800_000_000_000;
const mock = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const settings = { ...defaultSettings, paused: false, aiCardLimit: 0, maxCallsPerTick: 2, speed: 6 };
const people = defaultPersonas();
const comment = (text, authorId = 'shenmo', extra = {}) => ({
  id: `c-${Math.random().toString(36).slice(2)}`, authorId, authorKind: 'persona', text, at: NOW, ...extra,
});
const card = (kind, extra = {}) => ({
  id: `card-${kind}-${Math.random().toString(36).slice(2)}`, authorId: 'me', authorName: '幻辰', authorKind: 'player',
  kind, text: '今天把一件事做完了。', createdAt: NOW - 60_000, status: 'talking',
  arrivals: [], plan: [], pending: [], comments: [], ...extra,
});

test('only worry/goal/progress can enter the next-step chain', () => {
  assert.equal(canUseNextStep({ kind: 'worry' }), true);
  assert.equal(canUseNextStep({ kind: 'goal' }), true);
  assert.equal(canUseNextStep({ kind: 'progress' }), true);
  assert.equal(canUseNextStep({ kind: undefined }), true);
  assert.equal(canUseNextStep({ kind: 'brag' }), false);
  assert.equal(canUseNextStep({ kind: 'life' }), false);
  assert.equal(canUseNextStep({ kind: 'guide' }), false);
});

test('a generic empathy reply is not an executable next step', () => {
  assert.equal(isActionableStepText('呃……最近的状态的事啊。我也刚来，不太会接，但我在听。'), false);
  assert.equal(isActionableStepText('那个……你先说，我不急。'), false);
  assert.equal(isActionableStepText('先在草稿里写一句你想核实的澄清，写完再决定发不发。'), true);
});

test('brag/life cards cannot adopt a next step even when the comment is actionable', () => {
  for (const kind of ['brag', 'life']) {
    const result = adoptCommentAdvice(card(kind, { comments: [comment('先在草稿里写一句你想核实的澄清。')] }),
      'missing-id', people);
    assert.ok(result.error);
    const actionable = card(kind, { comments: [comment('先在草稿里写一句你想核实的澄清。')] });
    const out = adoptCommentAdvice(actionable, actionable.comments[0].id, people);
    assert.match(out.error ?? '', /只收回应/);
  }
});

test('worry rejects generic empathy but accepts a concrete step', () => {
  const generic = card('worry', { comments: [comment('呃……最近的状态的事啊。我也刚来，不太会接，但我在听。')] });
  const rejected = adoptCommentAdvice(generic, generic.comments[0].id, people);
  assert.match(rejected.error ?? '', /更像回应/);

  const concrete = card('worry', { comments: [comment('先在草稿里写一句你想核实的澄清。')] });
  const adopted = adoptCommentAdvice(concrete, concrete.comments[0].id, people);
  assert.ok(!adopted.error);
  const noted = acceptAdvice(adopted.card, NOW);
  assert.equal(noted.status, 'noted');
  const done = completeCard(noted, NOW, settings.speed);
  assert.equal(done.status, 'done');
  assert.match(done.comments.at(-1).text, /^做到了：先在草稿里写一句/);
});

test('bad legacy notes cannot complete or become a completion anchor', () => {
  const bad = card('worry', {
    status: 'noted',
    note: { text: '呃……最近的状态的事啊。我也刚来，不太会接，但我在听。', fromPersonaId: 'shenmo', at: NOW },
  });
  assert.equal(completeCard(bad, NOW, settings.speed), bad);
  assert.equal(completedActionAnchor(bad.note), '刚才那件小事');
  assert.equal(completedActionAnchor({ text: '先在草稿里写一句你想核实的澄清。', fromPersonaId: 'shenmo', at: NOW }), '在草稿里写一句你想核实的澄清');
});

test('brag model text must affirm the result, not ask for more context', () => {
  const brag = card('brag');
  assert.equal(forumReplyModeProblem(brag, '呃……最近的状态的事啊。我也刚来，不太会接，但我在听。', false), 'off_card');
  assert.equal(forumReplyModeProblem(brag, '这一整天都跟下来了，挺不容易的。', false), null);
});

test('mock brag replies congratulate instead of using the tentative first-meeting line', async () => {
  const brag = card('brag', {
    text: '虽然干的活很闲，但是一整天都跟下来了。',
    pending: [{ personaId: 'shenmo', at: NOW - 1, phase: 'reply' }],
  });
  const out = await tickCards({ cards: [brag], personas: people, settings, config: mock, now: NOW });
  const reply = out.cards[0].comments.find((row) => row.authorId === 'shenmo');
  assert.ok(reply);
  assert.match(reply.text, /跟下来|跟完|不容易|有始有终|结果|进展|恭喜|祝贺/);
  assert.doesNotMatch(reply.text, /我也刚来|不太会接|你想从哪讲起/);
});
