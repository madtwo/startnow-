'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { PUBLIC_RULES, REPLY_CONSTRAINTS, COMMENT_RULES, forumCardSystemFor, systemFor } = lib('prompts');
const { systemForRoom } = lib('room');
const { auditTone } = lib('baseline');
const { defaultPersonas } = lib('personas');

const persona = defaultPersonas()[0];
const now = 1_800_000_000_000;
const card = {
  id: 'prompt-constraint-card', authorId: 'me', authorName: '幻辰', authorKind: 'player',
  kind: 'worry', text: '简历改了三版还是不放心，不知道投什么岗位。',
  createdAt: now - 60_000, status: 'talking', arrivals: [], plan: [], pending: [], comments: [],
};

test('conversational replies forbid inventing unstated user facts', () => {
  assert.match(REPLY_CONSTRAINTS, /不补写对方没说过的专业、年级、岗位、求职方向/u);
  assert.match(REPLY_CONSTRAINTS, /不要把猜测写成事实/u);
  assert.match(systemFor(persona, '', COMMENT_RULES), /不补写对方没说过的专业/u);
  assert.match(forumCardSystemFor(persona, card, COMMENT_RULES), /不补写对方没说过的专业/u);
  assert.match(systemForRoom(persona, [persona]), /不补写对方没说过的专业/u);
});

test('completion protocol does not inherit conversational reply constraints', () => {
  assert.doesNotMatch(PUBLIC_RULES, /不补写对方没说过的专业/u);
  assert.doesNotMatch(systemForRoom(persona, [persona], false), /不补写对方没说过的专业/u);
});

test('conversational replies forbid invalidating fatigue comparisons', () => {
  assert.match(REPLY_CONSTRAINTS, /不要拿自己的课表、早八、路程、作息或经历去比较谁更累/u);
  assert.match(REPLY_CONSTRAINTS, /我都不好意思喊累/u);
  assert.match(systemFor(persona, '', COMMENT_RULES), /不要拿自己的课表、早八、路程、作息或经历去比较谁更累/u);
  assert.match(forumCardSystemFor(persona, card, COMMENT_RULES), /不要拿自己的课表、早八、路程、作息或经历去比较谁更累/u);
  assert.match(systemForRoom(persona, [persona]), /不要拿自己的课表、早八、路程、作息或经历去比较谁更累/u);
});

test('academic fabrication advice is blocked by the shared tone guard', () => {
  assert.match(REPLY_CONSTRAINTS, /不教对方编造、篡改、伪造或直接抄写、照搬数据、来源、文献、结果/u);
  assert.match(REPLY_CONSTRAINTS, /不假定对方研究的是某种疾病、患者或临床问题/u);
  assert.match(REPLY_CONSTRAINTS, /不教硬套模板、套话或凑字数/u);
  assert.match(REPLY_CONSTRAINTS, /先回应对方的具体内容；自己的经历最多补一句/u);
  assert.match(REPLY_CONSTRAINTS, /不要建议翘课、逃课、代签/u);
  assert.match(REPLY_CONSTRAINTS, /不要混入英文单词、乱码或不完整句子/u);
  assert.equal(auditTone('误差按系统误差和随机误差分开列，各自编个来源，居然过了。'), '不要教用户编造数据或来源');
  assert.equal(auditTone('把领域缺口直接抄成一句话塞进研究意义。'), '不要教用户照搬或拼凑内容');
  assert.equal(auditTone('一般就是抄仪器精度那段，再编两句人为读数误差。'), '不要教用户编造或照搬实验内容');
  assert.equal(auditTone('误差按系统误差和随机误差分开列，各挑一两个来源写。'), null);
});
