/** Synthetic-only validation of Q06 coordinator tooling. No humans, no key, no signoff. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const gate = require('../scripts/q06-human-review-gate.cjs');
const executable = path.resolve(__dirname, '../scripts/q06-human-review-gate.cjs');

function cli(...args) {
  return spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8' });
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-q06-SYNTHETIC-'));
  const run = path.join(root, 'private-run');
  const out = cli('prepare', '--out', run);
  assert.equal(out.status, 0, out.stderr);
  const manifestText = fs.readFileSync(path.join(run, 'manifest.json'), 'utf8');
  return { root, run, manifestSha: createHash('sha256').update(manifestText).digest('hex'),
    manifest: JSON.parse(manifestText) };
}
function synthesizeVoteSheet(run, manifest, slot, options = {}) {
  const rows = fs.readFileSync(path.join(run, `packet-${slot}.jsonl`), 'utf8').trimEnd().split('\n').map(JSON.parse);
  const [header, ...votes] = rows;
  header.reviewer_id = options.sameId ? 'synthetic-reviewer-a' : `synthetic-reviewer-${slot}`;
  header.reviewed_at = new Date(Date.parse(manifest.created_at) + 1000).toISOString();
  header.independent_review = options.noAttestation ? false : true;
  const byToken = new Map(manifest.rows.map(item => [item.tokens[slot], item]));
  for (const row of votes) {
    const match = byToken.get(row.token);
    row.verdict = match.expected;
    if (options.unsure === match.id) row.verdict = 'unsure';
    if (options.reverse === match.id) row.verdict = row.verdict === 'accept' ? 'reject' : 'accept';
    if (options.tamper === match.id) row.candidateLine += '（被篡改）';
  }
  if (options.dropRow) votes.pop();
  const dest = path.join(run, `synthetic-answer-${slot}.jsonl`);
  fs.writeFileSync(dest, [header, ...votes].map(JSON.stringify).join('\n') + '\n');
  return dest;
}
function runCheck(fixture, settings = {}) {
  const a = synthesizeVoteSheet(fixture.run, fixture.manifest, 'a', settings.a);
  const b = synthesizeVoteSheet(fixture.run, fixture.manifest, 'b', settings.b);
  const report = path.join(fixture.run, 'synthetic-report.json');
  const out = cli('check','--run',fixture.run,'--a',a,'--b',b,'--manifest-sha256',fixture.manifestSha,'--report',report);
  const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report,'utf8')) : null;
  return { out, result, report };
}

test('Q06-01 frozen synthetic fixture is exact: 9 accepted aliases, C04 rejected, C10 accepted', () => {
  const rows = gate.loadFrozen();
  assert.equal(rows.length, 10);
  assert.equal(rows.filter(r => r.expected === 'accept').length, 9);
  assert.equal(rows.filter(r => r.id === 'C04')[0].expected, 'reject');
  assert.equal(rows.filter(r => r.id === 'C10')[0].expected, 'accept');
});
test('Q06-01b pinned fixture permits LF/CRLF transport but refuses changed labels or text', () => {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixtures/q06-advice-alias.v1.json'));
  const lf = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
  const crlf = Buffer.from(lf.toString('utf8').replace(/\n/g, '\r\n'));
  assert.equal(gate.frozenFixtureSha(lf), gate.FIXTURE_SHA);
  assert.equal(gate.frozenFixtureSha(crlf), gate.FIXTURE_SHA);
  assert.notEqual(gate.frozenFixtureSha(Buffer.from(lf.toString('utf8').replace('"accept"', '"reject"'))), gate.FIXTURE_SHA);
  assert.notEqual(gate.frozenFixtureSha(Buffer.from(lf.toString('utf8').replace('社团答应', '社团已经答应'))), gate.FIXTURE_SHA);
  assert.notEqual(gate.frozenFixtureSha(Buffer.concat([crlf, Buffer.from(' ')])), gate.FIXTURE_SHA);
  assert.notEqual(gate.frozenFixtureSha(Buffer.from(lf.toString('utf8').replace(/\n/g, '\r'))), gate.FIXTURE_SHA);
});
test('Q06-02 prepared blind packets have no case IDs or expected labels and differ in tokenization', () => {
  const { root, run, manifest } = setup();
  try {
    const texts = ['a','b'].map(s => fs.readFileSync(path.join(run,`packet-${s}.jsonl`),'utf8'));
    for (const text of texts) {
      assert.doesNotMatch(text, /"expected"|"actionId"|"id":"(?:AL0[1-8]|C04|C10)"/);
      assert.equal(text.trim().split('\n').length, 11);
      assert.doesNotMatch(text, /"independent_review":true/);
    }
    assert.notEqual(manifest.rows[0].tokens.a, manifest.rows[0].tokens.b);
    assert.equal(cli('prepare', '--out', run).status, 2, 'must refuse overwriting a review run');
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
test('Q06-03 without real reviewer attestation, check rejects the unfilled packet', () => {
  const { root, run, manifestSha } = setup();
  try {
    const checked = cli('check','--run',run,'--a',path.join(run,'packet-a.jsonl'),'--b',path.join(run,'packet-b.jsonl'),'--manifest-sha256',manifestSha);
    assert.equal(checked.status, 2);
    assert.match(checked.stderr, /attestation/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
test('Q06-04 synthetic filled packets exercise ready *tool logic* but never grant release go or score locked', () => {
  const setupObj = setup();
  try {
    const { out, result } = runCheck(setupObj, {});
    assert.equal(out.status, 0, out.stderr);
    assert.equal(result.status, 'READY_FOR_EXTERNAL_SIGNOFF');
    assert.equal(result.agreed, 10);
    assert.equal(result.release_go, false);
    assert.equal(result.score_locked, false);
    assert.equal(result.reviewer_a.id, 'synthetic-reviewer-a');
    assert.ok(!JSON.stringify(result).includes('借钱没还'), 'report must never include raw reviewer sample content');
  } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
});
test('Q06-05 duplicate reviewer IDs are rejected', () => {
  const setupObj = setup();
  try {
    const { out, result } = runCheck(setupObj, { b: { sameId:true } });
    assert.equal(out.status, 2); assert.equal(result, null);
    assert.match(out.stderr,/reviewer IDs must differ/);
  } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
});
test('Q06-06 incomplete packet and modified case text are rejected', () => {
  for (const changes of [{ a: { dropRow:true } }, { b: { tamper:'C10' } }]) {
    const setupObj = setup();
    try {
      const { out, result } = runCheck(setupObj, changes);
      assert.equal(out.status, 2); assert.equal(result, null);
    } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
  }
});
test('Q06-07 two independent reviewers in disagreement remain blocked', () => {
  const setupObj = setup();
  try {
    const { out, result } = runCheck(setupObj, { b: { reverse:'AL01' } });
    assert.equal(out.status, 1); assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.disagreed, ['AL01']);
    assert.equal(result.release_go, false);
  } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
});
test('Q06-08 unsure vote remains blocked, not counted as pass', () => {
  const setupObj = setup();
  try {
    const { out, result } = runCheck(setupObj, { a: { unsure:'C10' } });
    assert.equal(out.status, 1); assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.pending, ['C10']);
  } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
});
test('Q06-09 frozen negative C04 cannot be approved, positive C10 cannot be rejected', () => {
  for (const id of ['C04', 'C10']) {
    const setupObj = setup();
    try {
      const { out, result } = runCheck(setupObj, { a:{reverse:id}, b:{reverse:id} });
      assert.equal(out.status, 1); assert.equal(result.status, 'BLOCKED');
      assert.deepEqual(result.label_conflicts,[id]);
    } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
  }
});
test('Q06-10 manifest/fixture tampering fails closed even when both packets are present', () => {
  const setupObj = setup();
  try {
    const manifestFile = path.join(setupObj.run, 'manifest.json');
    setupObj.manifest.rows[0].expected = 'reject';
    fs.writeFileSync(manifestFile, JSON.stringify(setupObj.manifest));
    const { out, result } = runCheck(setupObj);
    assert.equal(out.status, 2); assert.equal(result, null);
    assert.match(out.stderr,/manifest SHA differs/);
  } finally { fs.rmSync(setupObj.root, { recursive:true, force:true }); }
});
test('Q06-11 frozen cases match current *synthetic runtime* behavior (NOT human approval)', () => {
  const { lib } = require('./_ts-loader.cjs');
  const { actionMap } = lib('actions');
  const { validateAdviceLine } = lib('adviceLine');
  for (const row of gate.loadFrozen()) {
    const result = validateAdviceLine(row.candidateLine, actionMap[row.actionId], row.context);
    assert.equal(result.ok, row.expected === 'accept', `${row.id}: frozen/runtime divergence`);
  }
});
