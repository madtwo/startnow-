const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { roomPrompt } = lib('prompts');
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
