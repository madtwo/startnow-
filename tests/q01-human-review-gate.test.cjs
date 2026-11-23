/** Offline plumbing tests only. Mock reviewer IDs are NOT human sign-offs. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gate = path.resolve(__dirname, '../scripts/q01-human-review-gate.cjs');
const fixtures = path.resolve(__dirname, 'fixtures');
const fixtureNames = [
  'completion-attribution-q01.synthetic.json',
  'completion-attribution-q01.adversarial.json',
  'completion-attribution-q01.extension-candidate.json',
];
function cli(...args) {
  return spawnSync(process.execPath, [gate, ...args], { encoding: 'utf8', timeout: 10000 });
}
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-q01-review-')); }
function parseJsonl(p) { return fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse); }
function writeJsonl(p, lines) { fs.writeFileSync(p, lines.map(x => JSON.stringify(x)).join('\n') + '\n'); }
function setup() {
  const root = temp();
  const run = path.join(root, 'run');
  const result = cli('prepare', '--fixtures-dir', fixtures, '--out', run);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'), 'utf8'));
  const a = path.join(run, 'packet-a.jsonl');
  const b = path.join(run, 'packet-b.jsonl');
  return { root, run, manifest, a, b, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
// This helper deliberately forges "human" metadata to test validation wiring. It
// must never be used as evidence of actual human review or unlock release.
function fillMock(s, slot, verdictFor) {
  const p = slot === 'a' ? s.a : s.b;
  const records = parseJsonl(p);
  records[0].reviewer_id = slot === 'a' ? 'mockA' : 'mockB';
  records[0].reviewed_at = '2026-11-21T08:00:00.000Z';
  records[0].independent_review = true;
  const lookup = new Map(s.manifest.rows.map(row => [row.tokens[slot], row]));
  for (const item of records.slice(1)) item.verdict = verdictFor(lookup.get(item.token));
  writeJsonl(p, records);
}
function check(s, report) {
  const args = ['check', '--fixtures-dir', fixtures, '--run', s.run, '--a', s.a, '--b', s.b];
  if (report) args.push('--report', report);
  return cli(...args);
}
function verdict(row) { return row.expected ? 'player' : 'not_player'; }
function withRun(fn) { const s = setup(); try { return fn(s); } finally { s.cleanup(); } }

test('prepares 2 independently shuffled and pseudonymized 98-case packets with pinned SHA', () => withRun(s => {
  assert.equal(s.manifest.rows.length, 98);
  const a = parseJsonl(s.a), b = parseJsonl(s.b);
  assert.equal(a.length, 99); assert.equal(b.length, 99);
  assert.notDeepEqual(a.slice(1).map(x => x.token), b.slice(1).map(x => x.token));
  assert.equal(new Set([...a.slice(1), ...b.slice(1)].map(x => x.token)).size, 196);
  for (const x of [...a.slice(1), ...b.slice(1)]) {
    assert.deepEqual(Object.keys(x).sort(), ['anchor','note','text','token','type','verdict'].sort());
    assert.equal(x.verdict, null);
    assert.match(x.token, /^[a-f0-9]{24}$/);
  }
  assert.equal(a[0].independent_review, false);
  assert.equal(b[0].independent_review, false);
  assert.equal(a[0].reviewer_id, '');
}));

test('refuses to overwrite a previous review run', () => withRun(s => {
  const res = cli('prepare', '--fixtures-dir', fixtures, '--out', s.run);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /refusing to overwrite/);
}));

test('unreviewed packets fail closed; report cannot be invented', () => withRun(s => {
  const res = check(s);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Invalid reviewer metadata/);
}));

test('both synthetic mock verdict lists match -> READY, never GO/score-locked', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const file = path.join(s.root, 'report.json');
  const res = check(s, file);
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(report.status, 'READY_FOR_EXTERNAL_SIGNOFF');
  assert.equal(report.agreed, 98);
  assert.deepEqual(report.label_conflicts, []);
  assert.equal(report.release_go, false); assert.equal(report.score_locked, false);
  assert.equal(typeof report.manifest_sha256, 'string');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(s.manifest.rows[0].text));
  const second = check(s, file);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /EEXIST/);
}));

test('same reviewer ID is disallowed even with case/whitespace differences', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const b = parseJsonl(s.b); b[0].reviewer_id = 'MOCKA'; writeJsonl(s.b, b);
  const res = check(s);
  assert.equal(res.status, 2); assert.match(res.stderr, /Reviewer IDs must differ/);
}));

test('unanswered judgment produces BLOCKED, not acceptance', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const b = parseJsonl(s.b); b[1].verdict = null; writeJsonl(s.b, b);
  const file = path.join(s.root, 'pending.json');
  const res = check(s, file);
  assert.equal(res.status, 1); assert.match(res.stdout, /pending=1/);
  assert.equal(JSON.parse(fs.readFileSync(file)).status, 'BLOCKED');
}));

test('an unsure verdict produces BLOCKED', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const a = parseJsonl(s.a); a[1].verdict = 'unsure'; writeJsonl(s.a, a);
  const res = check(s);
  assert.equal(res.status, 1); assert.match(res.stdout, /pending=1/);
}));

test('reviewer disagreement is counted and blocks', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const b = parseJsonl(s.b); b[1].verdict = b[1].verdict === 'player' ? 'not_player' : 'player'; writeJsonl(s.b, b);
  const res = check(s);
  assert.equal(res.status, 1); assert.match(res.stdout, /disagreed=1/);
}));

test('both reviewers challenging a frozen label also blocks pending adjudication', () => withRun(s => {
  fillMock(s, 'a', row => row.id === 'P01' ? 'not_player' : verdict(row));
  fillMock(s, 'b', row => row.id === 'P01' ? 'not_player' : verdict(row));
  const res = check(s);
  assert.equal(res.status, 1); assert.match(res.stdout, /label_conflicts=1/);
}));

test('tampered text cannot pass even if verdicts are complete', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const a = parseJsonl(s.a); a[1].text += '（已被修改）'; writeJsonl(s.a, a);
  const res = check(s);
  assert.equal(res.status, 2); assert.match(res.stderr, /Tampered sample/);
}));

test('duplicated token cannot pass even if count stays 98', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const a = parseJsonl(s.a); a[2].token = a[1].token; writeJsonl(s.a, a);
  const res = check(s);
  assert.equal(res.status, 2); assert.match(res.stderr, /Duplicate\/unrecognized/);
}));

test('missing case cannot pass', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const b = parseJsonl(s.b); b.pop(); writeJsonl(s.b, b);
  const res = check(s);
  assert.equal(res.status, 2); assert.match(res.stderr, /row count mismatch/);
}));

test('interchanged a/b answers cannot pass even with different reviewers', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const res = cli('check', '--fixtures-dir', fixtures, '--run', s.run, '--a', s.b, '--b', s.a);
  assert.equal(res.status, 2); assert.match(res.stderr, /Invalid reviewer metadata/);
}));

test('altered fixture file SHA is rejected; pinned snapshot is enforced', () => withRun(s => {
  const newFixtures = path.join(s.root, 'fixtures'); fs.mkdirSync(newFixtures);
  for (const file of fixtureNames) fs.copyFileSync(path.join(fixtures, file), path.join(newFixtures, file));
  fs.appendFileSync(path.join(newFixtures, fixtureNames[2]), '\n');
  const res = cli('check', '--fixtures-dir', newFixtures, '--run', s.run, '--a', s.a, '--b', s.b);
  assert.equal(res.status, 2); assert.match(res.stderr, /Fixture SHA mismatch/);
}));

test('manifest tampering invalidates both review packets', () => withRun(s => {
  fillMock(s, 'a', verdict); fillMock(s, 'b', verdict);
  const manifestPath = path.join(s.run, 'manifest.json');
  fs.appendFileSync(manifestPath, ' ');
  const res = check(s);
  assert.equal(res.status, 2); assert.match(res.stderr, /stale packet/);
}));

test('arbitrary new option is rejected', () => withRun(s => {
  const res = cli('prepare', '--fixtures-dir', fixtures, '--out', path.join(s.root,'new'), '--force', 'yes');
  assert.equal(res.status, 2); assert.match(res.stderr, /Invalid\/repeated option/);
}));

test('pinned v1.8 runtime SHA is recorded in the run manifest', () => withRun(s => {
  assert.equal(s.manifest.runtime_sha256, '21db764e500e077a486e310450c5bc146ee54b0171e4636bf45e9f2710d6e7f8');
}));
