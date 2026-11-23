'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lib } = require('./_ts-loader.cjs');
const { adoptCommentAdvice, acceptAdvice, completeCard, tickCards } = lib('cards');
const { canUseNextStep, isActionableStepText } = lib('cardPolicy');
const { completedActionAnchor } = lib('completionReaction');
const { forumReplyFallback, forumReplyModeProblem, distinctForumShortAck } = lib('forumReplyPolicy');
const { resultCardDetail } = lib('peerReactions');
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

test('mock first replies echo the topic instead of asking the player to re-explain', async () => {
  const worry = card('worry', {
    text: '明天材料物理小测，书才背到第三章。',
    pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply' }],
  });
  const out = await tickCards({ cards: [worry], personas: people, settings, config: mock, now: NOW });
  const reply = out.cards[0].comments.find((row) => row.authorId === 'weini');
  assert.ok(reply);
  assert.doesNotMatch(reply.text, /你想从哪讲起|先说是哪一件|先说说是哪一件/);
  assert.match(reply.text, /学习|材料物理/);
});

test('short result clauses without punctuation are quoted whole, not cut mid-word', async () => {
  const brag = card('brag', { text: '今天终于把方法部分的三个小标题列完了。' });
  assert.equal(resultCardDetail(brag), '今天终于把方法部分的三个小标题列完了');
  const out = await tickCards({ cards: [{ ...brag, pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply' }] }], personas: people, settings, config: mock, now: NOW });
  const reply = out.cards[0].comments.find((row) => row.authorId === 'weini');
  assert.ok(reply);
  assert.match(reply.text, /三个小标题列完了/);
  assert.doesNotMatch(reply.text, /标题列…/);
});

test('mock short acknowledgements stay short and life questions do not become a moment', async () => {
  const ack = comment('嗯嗯', 'me', { authorKind: 'player' });
  const shortCard = card('worry', {
    text: '明天有门课要交作业。',
    comments: [ack],
    pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply', sourceCommentId: ack.id }],
  });
  const shortOut = await tickCards({ cards: [shortCard], personas: people, settings, config: mock, now: NOW });
  const shortReply = shortOut.cards[0].comments.filter((row) => row.authorKind === 'persona').at(-1);
  assert.ok(shortReply);
  assert.match(shortReply.text, /收到|知道|听见|接到/);
  assert.doesNotMatch(shortReply.text, /学习|状态|先听你讲/);

  const ask = card('life', {
    text: '周末有人去图书馆吗？',
    pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply' }],
  });
  const askOut = await tickCards({ cards: [ask], personas: people, settings, config: mock, now: NOW });
  const askReply = askOut.cards[0].comments.find((row) => row.authorKind === 'persona');
  assert.ok(askReply);
  assert.match(askReply.text, /去不了|在线/);
  assert.doesNotMatch(askReply.text, /瞬间/);
});

test('mock brag/life replies quote the card instead of borrowing another topic', async () => {
  const bragCard = card('brag', {
    text: '今天把实验报告的第一段写完了，虽然只有三百字。',
    pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply' }],
  });
  const bragOut = await tickCards({ cards: [bragCard], personas: people, settings, config: mock, now: NOW });
  const bragReply = bragOut.cards[0].comments.find((row) => row.authorId === 'weini');
  assert.ok(bragReply);
  assert.match(bragReply.text, /实验报告/);
  assert.doesNotMatch(bragReply.text, /跟完整天|一整天都跟下来/);

  const lifeCard = card('life', {
    text: '周末打了场球，赢了。',
    pending: [{ personaId: 'weini', at: NOW - 1, phase: 'reply' }],
  });
  const lifeOut = await tickCards({ cards: [lifeCard], personas: people, settings, config: mock, now: NOW });
  const lifeReply = lifeOut.cards[0].comments.find((row) => row.authorId === 'weini');
  assert.ok(lifeReply);
  assert.match(lifeReply.text, /打球|球|赢了/);
  assert.doesNotMatch(lifeReply.text, /饭|食堂|顿/);
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

test('mock life replies stay on the small moment instead of asking for context', async () => {
  const life = card('life', {
    text: '食堂鸡腿饭今天很好吃。',
    pending: [{ personaId: 'shenmo', at: NOW - 1, phase: 'reply' }],
  });
  const out = await tickCards({ cards: [life], personas: people, settings, config: mock, now: NOW });
  const reply = out.cards[0].comments.find((row) => row.authorId === 'shenmo');
  assert.ok(reply);
  assert.doesNotMatch(reply.text, /我也刚来|不太会接|你想从哪讲起|最近的状态/);
});

test('long result details truncate at a phrase boundary, not a half character', () => {
  const brag = card('brag', { text: '今天把实验报告的第一段写完了，虽然只有三百字。' });
  assert.equal(resultCardDetail(brag), '今天把实验报告的第一段写完了…');
});

test('brag fallbacks are persona-specific instead of the same sentence', () => {
  const brag = card('brag', { text: '今天把实验报告的第一段写完了，虽然只有三百字。' });
  const lines = ['shenmo', 'weini', 'miaoze', 'yanggao'].map((id) =>
    forumReplyFallback(brag, people.find((p) => p.id === id)));
  assert.equal(new Set(lines).size, lines.length, JSON.stringify(lines));
});

test('short acknowledgements cycle through four lines before repeating the last one', () => {
  const lines = [];
  for (let i = 0; i < 6; i += 1) lines.push(distinctForumShortAck(new Set(lines)));
  assert.equal(new Set(lines.slice(0, 4)).size, 4, JSON.stringify(lines));
  assert.equal(lines[4], lines[3]);
  assert.equal(lines[5], lines[3]);
});

test('comment rules scope 在的, memory attribution and invitations', () => {
  const { COMMENT_RULES } = lib('prompts');
  assert.match(COMMENT_RULES, /只有对方在打招呼.*在的/u);
  assert.match(COMMENT_RULES, /属于玩家/u);
  assert.match(COMMENT_RULES, /邀请或提问/u);
  assert.match(COMMENT_RULES, /没去过你们食堂/u);
});

test('step board, card detail and note drawer share the same card-type/actionability gates', () => {
  const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const step = read('src/components/StepBoard.tsx');
  const detail = read('src/components/CardDetail.tsx');
  const drawer = read('src/components/NoteDrawer.tsx');
  assert.match(step, /canUseNextStep\(c\)/);
  assert.match(step, /noteActionable/);
  assert.match(step, /adviceActionable/);
  assert.match(detail, /nextStepAllowed/);
  assert.match(detail, /adviceActionable/);
  assert.match(drawer, /canUseNextStep\(c\)/);
  assert.match(drawer, /usableNote/);
});
