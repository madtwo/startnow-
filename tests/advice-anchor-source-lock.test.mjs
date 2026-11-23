import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  readSamples, parseCsv, renderCsv, runCli,
  evaluateReviewSheetsAgainstSource,
} from '../scripts/advice-anchor-review.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/advice-anchor-v12-report.jsonl', import.meta.url));
const original = fs.readFileSync(fixturePath, 'utf8');
const EXPECTED_SHA256 = '7dc08331e6a087b725ba396a7ae371686fae078f7de8e5cffc4a1a92c10dc134';
const samples = readSamples(original);
const reviewed = (reviewerId) => renderCsv(samples.map((row) => ({
  ...row,
  reviewer_id: reviewerId,
  independent_confirmed: 'Y',
  same_action: row.source === 'rejected' ? 'Y' : 'N',
  grounded: row.source === 'rejected' ? 'Y' : 'N',
  one_step: row.source === 'rejected' ? 'Y' : 'N',
  safety: 'Y',
  notes: 'Test fixture only, not an actual reviewer judgment.',
})));
const a = reviewed('test_reviewer_A');
const b = reviewed('test_reviewer_B');

function sameAfterChange(rowIndex, field, value) {
  const update = (csv) => {
    const rows = parseCsv(csv);
    rows[rowIndex][field] = value;
    return renderCsv(rows);
  };
  return [update(a), update(b)];
}

test('provided sampling source has 2 rejected and 4 negative control rows', () => {
  assert.equal(samples.length, 6);
  assert.equal(samples.filter((row) => row.source === 'rejected').length, 2);
  assert.equal(samples.filter((row) => row.source === 'negative').length, 4);
  assert.equal(createHash('sha256').update(original).digest('hex'), EXPECTED_SHA256);
});

test('blank reviewer sheets fail closed: no synthetic reviewer completion', () => {
  const blank = renderCsv(samples);
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, blank, blank, EXPECTED_SHA256),
    /Missing\/invalid independent reviewer/u);
});

test('source-locked score does not grant release with only two rejected examples', () => {
  const result = evaluateReviewSheetsAgainstSource(original, a, b, EXPECTED_SHA256);
  assert.equal(result.reviewed, 6);
  assert.equal(result.rejected, 2);
  assert.equal(result.negativeTotal, 4);
  assert.equal(result.negativeEscapes, 0);
  assert.equal(result.ready_for_consideration, false);
  assert.equal(result.change_validator_automatically, false);
  assert.equal(result.source_sha256, EXPECTED_SHA256);
});

test('a fabricated replacement line in both sheets is rejected against source', () => {
  const [x, y] = sameAfterChange(0, 'rejectedLine', 'This line was swapped by a test case.');
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, x, y, EXPECTED_SHA256),
    /facts differ/u);
});

test('a swapped action ID in both sheets cannot pass by agreeing with each other', () => {
  const [x, y] = sameAfterChange(1, 'actionId', 'peer-boundary-2');
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, x, y, EXPECTED_SHA256),
    /facts differ/u);
});

test('source classification, seed, and order stay immutable', () => {
  for (const [field, value] of [['source', 'negative'], ['seed', '43'], ['topic', 'future']]) {
    const [x,y] = sameAfterChange(0, field, value);
    assert.throws(() => evaluateReviewSheetsAgainstSource(original, x, y, EXPECTED_SHA256),
      /facts differ/u);
  }
  const reverse = (csv) => renderCsv(parseCsv(csv).reverse());
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, reverse(a), reverse(b), EXPECTED_SHA256),
    /facts differ/u);
});

test('a missing row or a source hash mismatch stops scoring', () => {
  const fewer = renderCsv(parseCsv(a).slice(1));
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, fewer, b, EXPECTED_SHA256), /case counts/u);
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, a, b, '0'.repeat(64)), /SHA256/u);
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, a, b, 'any-hash'), /trusted SHA256/u);
});

test('a changed synthetic source cannot be passed off as the original receipt', () => {
  const changed = original.replace('deepseek-v4.1-flash', 'fixture-model');
  assert.throws(() => evaluateReviewSheetsAgainstSource(changed, a, b, EXPECTED_SHA256), /SHA256/u);
});

test('independent reviewer declarations still must be present and different', () => {
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, a, a, EXPECTED_SHA256), /identities/u);
  const rows = parseCsv(b);
  rows[0].independent_confirmed = '';
  assert.throws(() => evaluateReviewSheetsAgainstSource(original, a, renderCsv(rows), EXPECTED_SHA256), /Missing\/invalid/u);
});

test('score-locked CLI reports source digest without printing sample lines', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'advice-anchor-locked-'));
  try {
    const ar = path.join(folder, 'a.csv');
    const br = path.join(folder, 'b.csv');
    const out = path.join(folder, 'summary.md');
    fs.writeFileSync(ar, a);
    fs.writeFileSync(br, b);
    const msg = runCli(['score-locked', fixturePath, ar, br, out, EXPECTED_SHA256]);
    assert.match(msg, /Source-locked review: 6/u);
    const report = fs.readFileSync(out, 'utf8');
    assert.match(report, /INSUFFICIENT/u);
    assert.match(report, /VERIFIED/u);
    assert.match(report, new RegExp(EXPECTED_SHA256, 'u'));
    assert.ok(!report.includes(JSON.parse(original.split('\n')[0]).rejectedLine)); // no raw rejected text
    assert.throws(() => runCli(['score-locked', fixturePath, ar, br, out, EXPECTED_SHA256]), /EEXIST/u);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('legacy score CLI clearly warns when source is unverified', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'advice-anchor-unlocked-'));
  try {
    const ar = path.join(folder, 'a.csv');
    const br = path.join(folder, 'b.csv');
    const out = path.join(folder, 'summary.md');
    fs.writeFileSync(ar, a);
    fs.writeFileSync(br, b);
    assert.match(runCli(['score', ar, br, out]), /WARNING: unpinned source/u);
    assert.match(fs.readFileSync(out, 'utf8'), /NOT VERIFIED/u);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
