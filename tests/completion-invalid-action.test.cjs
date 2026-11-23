/**
 * Regression sample set for completion-reply invalid_action.
 * It exercises the existing validator; the production fix is limited to the
 * adjective-phrase negation case in completionReaction.ts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./_ts-loader.cjs');
const { isGroundedCompletionReaction } = require('../src/lib/completionReaction.ts');
const samples = require('./fixtures/completion-invalid-action-samples.json');

const positives = samples.filter((row) => row.expected === true);
const negatives = samples.filter((row) => row.expected === false);

test('positive completion samples are accepted', () => {
  const failures = positives
    .filter((row) => !isGroundedCompletionReaction(row.text, row.anchor))
    .map((row) => ({ id: row.id, anchor: row.anchor, text: row.text }));
  assert.deepEqual(failures, [], 'valid completions were rejected as invalid_action');
});

test('negative completion samples stay rejected', () => {
  const escapes = negatives
    .filter((row) => isGroundedCompletionReaction(row.text, row.anchor))
    .map((row) => ({ id: row.id, anchor: row.anchor, text: row.text }));
  assert.deepEqual(escapes, [], 'invalid completions escaped as grounded');
});

test('sample set has both labels and unique IDs', () => {
  assert.ok(positives.length >= 10);
  assert.ok(negatives.length >= 10);
  assert.equal(new Set(samples.map((row) => row.id)).size, samples.length);
});
