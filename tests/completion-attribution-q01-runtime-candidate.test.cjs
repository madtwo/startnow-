/** Q01 v1.8 candidate runtime gate: synthetic labels are NOT human approvals. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
require('./_ts-loader.cjs');
const { isGroundedCompletionReaction } = require('../src/lib/completionReaction.ts');
const fixtures = [
  ['completion-attribution-q01.synthetic.json', '308e78639dc794747c935a51a9cbf09ea206bfb03404683282498810daf8e3d1'],
  ['completion-attribution-q01.adversarial.json', 'ef2303096e1f6aa4355d89d7b457cf55a77b09898095d4d8f9242665298e4bc4'],
];
const all = [];
for (const [filename, expectedSha] of fixtures) {
  const bytes = readFileSync(path.join(__dirname, 'fixtures', filename));
  const sha = createHash('sha256').update(bytes).digest('hex');
  test(`frozen Q01 fixture SHA: ${filename}`, () => assert.equal(sha, expectedSha));
  const cases = JSON.parse(bytes.toString('utf8')).cases;
  all.push(...cases);
}
const extension = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/completion-attribution-q01.extension-candidate.json'), 'utf8'));
test('candidate extension is assistant-authored, unreviewed and uniquely identified', () => {
  assert.equal(extension.version, 'q01-candidate-extension-58-v1');
  assert.equal(extension.provenance, 'assistant-authored-synthetic-no-player-content');
  assert.equal(extension.status, 'candidate-labels-not-human-reviewed');
  assert.equal(extension.cases.length, 58);
  assert.equal(new Set([...all, ...extension.cases].map(x => x.id)).size, 98);
});
all.push(...extension.cases);
// No player/model text is emitted in test titles or assertion errors.
for (const { id, anchor, text, expected } of all) {
  test(`Q01 runtime expected actor: ${id}`, () => {
    assert.equal(Boolean(isGroundedCompletionReaction(text, anchor)), expected, `Q01 case ${id}`);
  });
}
