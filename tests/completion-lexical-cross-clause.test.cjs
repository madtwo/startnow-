/**
 * Synthetic boundary cases for completion-reply ownership.
 * No API calls, player content, or changes to production validation thresholds.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./_ts-loader.cjs');
const { isGroundedCompletionReaction } = require('../src/lib/completionReaction.ts');

const question = '写出一个尚未确定的问题';
const resume = '打开简历';
const cases = [
  // The object/verb can straddle a comma while a later persona reaction says “一点好奇”.
  { id: 'pos-object-comma-player-write', anchor: question, text: '那个尚未确定的问题，你已经写下来了。我心里还有一点好奇。', expected: true },
  { id: 'pos-short-object-comma-player-write', anchor: question, text: '那个问题，你已经写下来了。我心里还有一点好奇。', expected: true },
  { id: 'pos-written-with-curiosity', anchor: question, text: '那个问题已经写下来了。我心里还有一点好奇。', expected: true },
  { id: 'pos-unresolved-problem-written', anchor: question, text: '那个没想明白的问题写下来了。我心里还有一点好奇。', expected: true },
  { id: 'pos-resume-opened', anchor: resume, text: '简历打开了。我有一点好奇，后面会改哪部分。', expected: true },
  { id: 'pos-lab-record-written', anchor: '写一行实验记录', text: '实验记录写好一行了，我现在还有一点好奇。', expected: true },

  // Persona-owned completions must remain invalid, even in the SAME clause as curiosity.
  { id: 'neg-persona-opened-resume', anchor: resume, text: '我把简历打开了。', expected: false },
  { id: 'neg-persona-wrote-problem', anchor: question, text: '我刚刚把那个问题写下来了。', expected: false },
  { id: 'neg-curiosity-then-persona-wrote-same-clause', anchor: question, text: '我心里有一点好奇但我已经把那个问题写下来了。', expected: false },
  { id: 'neg-curiosity-then-persona-opened-same-clause', anchor: resume, text: '我心里有一点好奇其实我刚把简历打开了。', expected: false },
  { id: 'neg-curiosity-then-persona-wrote-good-same-clause', anchor: question, text: '我心里有一点好奇我已经把问题写好了。', expected: false },
  { id: 'neg-curiosity-then-persona-clicked-same-clause', anchor: resume, text: '我心里有一点好奇但我自己点好了简历。', expected: false },

  // Negation / questions / hypothetical actions must never become confirmations.
  { id: 'neg-curiosity-no-written-action', anchor: question, text: '我心里还有一点好奇，但那个问题没有写下来。', expected: false },
  { id: 'neg-still-unwritten', anchor: question, text: '那个问题还没写下来。', expected: false },
  { id: 'neg-written-question', anchor: question, text: '那个问题写下来了吗？', expected: false },
  { id: 'neg-resume-hypothetical', anchor: resume, text: '等你打开简历，再看看第一行。', expected: false },
];

for (const { id, anchor, text, expected } of cases) {
  test(id, () => {
    assert.equal(Boolean(isGroundedCompletionReaction(text, anchor)), expected, `case=${id}`);
  });
}
