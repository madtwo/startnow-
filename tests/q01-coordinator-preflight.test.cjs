/** Q01 coordination diagnostics only; deliberately NOT a human Q01 vote. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const gate = require('../scripts/q01-human-review-gate.cjs');
const preflight = require('../scripts/q01-coordinator-preflight.cjs');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'scripts/q01-coordinator-preflight.cjs');
const digest = x => crypto.createHash('sha256').update(x).digest('hex');

function tempCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-q01-preflight-'));
  const fixtures = path.join(tmp, 'tests', 'fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/lib/completionReaction.ts'), path.join(tmp, 'src/lib/completionReaction.ts'));
  for (const [name] of gate.FIXTURES) {
    fs.copyFileSync(path.join(root, 'tests/fixtures', name), path.join(fixtures, name));
  }
  return tmp;
}

test('current source SHA and all 98 frozen Q01 fixture hashes are reported accurately', () => {
  const report = preflight.buildReport();
  assert.equal(report.pinned_runtime_sha256, gate.RUNTIME_SHA);
  assert.equal(report.current_runtime_sha256, digest(fs.readFileSync(path.join(root, 'src/lib/completionReaction.ts'))));
  assert.equal(report.frozen_fixture_count, 98);
  for (const [name, originalSha] of gate.FIXTURES) {
    assert.equal(report.frozen_fixture_sha256[name], originalSha);
  }
  assert.equal(report.fixture_integrity, 'MATCHED_ORIGINAL_PINS');
});

test('mismatched runtime fails closed; no approval or review completion is inferred', () => {
  const report = preflight.buildReport();
  assert.notEqual(report.current_runtime_sha256, report.pinned_runtime_sha256);
  assert.equal(report.status, 'BLOCKED_RUNTIME_BASELINE_DRIFT');
  assert.equal(report.may_prepare_Q01_blind_packets, false);
  assert.equal(report.human_double_review_complete, false);
  assert.equal(report.release_go, false);
  assert.equal(report.q06_review_status, 'NOT_ASSESSED');
  assert.doesNotMatch(JSON.stringify(report), /"text"\s*:|"anchor"\s*:|"expected"\s*:/);
});

test('even exact runtime pin match only permits preparing human packets, never release', () => {
  const a = preflight.classifyRuntimeDigest('same', 'same');
  assert.equal(a.runtime_pin_matches, true);
  assert.equal(a.may_prepare_Q01_blind_packets, true);
  assert.equal(a.release_go, false);
  assert.equal(a.human_double_review_complete, false);
  assert.match(a.status, /AWAITING_INDEPENDENT_HUMAN/);
});

test('only the existing gate owns pinned frozen SHA; modified fixture is refused', () => {
  const tmp = tempCopy();
  try {
    const name = gate.FIXTURES[0][0];
    fs.appendFileSync(path.join(tmp, 'tests/fixtures', name), ' ');
    assert.throws(() => preflight.buildReport(tmp), /Fixture SHA mismatch/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('different runtime bytes produce different digest, still fail closed', () => {
  const tmp = tempCopy();
  try {
    fs.appendFileSync(path.join(tmp, 'src/lib/completionReaction.ts'), '\n// coordinator review needed\n');
    const report = preflight.buildReport(tmp);
    assert.notEqual(report.current_runtime_sha256, digest(fs.readFileSync(path.join(root, 'src/lib/completionReaction.ts'))));
    assert.equal(report.may_prepare_Q01_blind_packets, false);
    assert.equal(report.release_go, false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI reports runtime drift as non-zero and prints machine-readable coordinator evidence', () => {
  const run = spawnSync(process.execPath, [cli], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(run.status, 1);
  const report = JSON.parse(run.stdout);
  assert.equal(report.current_runtime_sha256, preflight.buildReport().current_runtime_sha256);
  assert.equal(report.status, 'BLOCKED_RUNTIME_BASELINE_DRIFT');
  assert.equal(run.stderr, '');
});

test('opt-in report is new-only: no silent overwrite, and permissions are private', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-q01-report-'));
  try {
    const file = path.join(tmp, 'preflight.json');
    const first = spawnSync(process.execPath, [cli, '--out', file], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(first.status, 1);
    const bytes = fs.readFileSync(file);
    assert.deepEqual(JSON.parse(bytes).frozen_fixture_count, 98);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const second = spawnSync(process.execPath, [cli, '--out', file], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(second.status, 2);
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('unsupported switches cannot be used to spoof alternate runtime or SHA pin', () => {
  assert.throws(() => preflight.parseArgs(['--runtime', 'fake.ts']), /Usage/);
  assert.throws(() => preflight.parseArgs(['--out', 'x.json', '--force', 'true']), /Usage/);
  const r = spawnSync(process.execPath, [cli, '--pinned-sha', 'fake'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
