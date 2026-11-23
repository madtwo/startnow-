/** Seed-free deterministic metamorphic properties on assistant-authored synthetic strings. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
require('./_ts-loader.cjs');
const { isGroundedCompletionReaction } = require('../src/lib/completionReaction.ts');
const filenames = [
  'completion-attribution-q01.synthetic.json',
  'completion-attribution-q01.adversarial.json',
  'completion-attribution-q01.extension-candidate.json',
];
const cases = filenames.flatMap(filename =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', filename), 'utf8')).cases,
);
const mutations = [
  ['ascii-comma', s => s.replace(/，/gu, ',')],
  ['extra-space', s => `  ${s}  `],
  ['exclamation', s => s.replace(/。/gu, '！')],
  ['semicolon', s => s.replace(/。/gu, '；')],
  ['comma-semicolon', s => s.replace(/，/gu, '；')],
];
test('Q01 semantic-preserving punctuation/spacing variants, 98 x 5', () => {
  assert.equal(cases.length, 98);
  for (const { id, anchor, text, expected } of cases) {
    for (const [mutationId, mutate] of mutations) {
      assert.equal(Boolean(isGroundedCompletionReaction(mutate(text), anchor)), expected,
        `Q01 case ${id}, mutation ${mutationId}`);
    }
  }
});
