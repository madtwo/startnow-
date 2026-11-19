const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { roomPrompt, commentPrompt } = lib('prompts');
const { defaultPersonas } = lib('personas');

const cast = defaultPersonas();
const say = (text, extra = {}) => roomPrompt(
  cast,
  [{ name: '匿', text }],
  { mode: 'reply', replyName: '匿', topic: text, selfName: '魏霓', replyText: text, replyIsPlayer: true, ...extra },
);

test('玩家关心同伴时，群聊要求先回应自己而不是给建议或追问', () => {
  const prompt = say('魏姐这么好的学校也有就业焦虑吗');
  assert.match(prompt, /不是向你求助/);
  assert.match(prompt, /不要给建议/);
  assert.match(prompt, /不要追问对方/);
});

test('玩家询问同伴近况也走同一规则', () => {
  assert.match(say('你最近压力大吗'), /不是向你求助/);
});

test('玩家明确要下一步、谈自己的问题或同伴互聊时，不触发关心规则', () => {
  assert.doesNotMatch(say('你能给我一个下一步吗'), /不是向你求助/);
  assert.doesNotMatch(say('我简历删到第五遍，怎么办'), /不是向你求助/);
  assert.doesNotMatch(say('魏姐最近怎么样', { mode: 'peer', replyIsPlayer: false }), /不是向你求助/);
});

const forumCard = (text, peer, authorKind = 'player') => ({
  id: 'forum-care', authorId: authorKind === 'player' ? 'me' : 'shenmo',
  authorName: authorKind === 'player' ? '匿' : '沈默', authorKind,
  kind: 'worry', text: '背病理总是想摸手机。', createdAt: 1, status: 'talking',
  arrivals: [], plan: [], pending: [],
  comments: [{ id: 'c1', authorId: 'me', authorKind: 'player', text, at: 2, kind: 'comment', peer }],
});
const shenmo = cast.find((persona) => persona.id === 'shenmo');

test('论坛里玩家回复并安慰/支招同伴时，同伴先回应自己而不是反问或给建议', () => {
  const prompt = commentPrompt(forumCard('我的话一般会把手机锁起来', 'shenmo'), shenmo);
  assert.match(prompt, /不是向你求助/);
  assert.match(prompt, /不要反问对方/);
  assert.match(prompt, /不要给对方下一步/);
});

test('同伴自己的帖子下，玩家未点名的评论也走同一条边界', () => {
  const prompt = commentPrompt(forumCard('你背两页就摸手机，会不会很累', undefined, 'persona'), shenmo);
  assert.match(prompt, /不是向你求助/);
});

test('论坛里玩家明确求助或只是普通短评时不触发关心规则', () => {
  assert.doesNotMatch(commentPrompt(forumCard('你能给我一个下一步吗', 'shenmo'), shenmo), /不是向你求助/);
  assert.doesNotMatch(commentPrompt(forumCard('嗯嗯', 'shenmo'), shenmo), /不是向你求助/);
  assert.doesNotMatch(commentPrompt(forumCard('我最近背书也卡住了', undefined), shenmo), /不是向你求助/);
});
