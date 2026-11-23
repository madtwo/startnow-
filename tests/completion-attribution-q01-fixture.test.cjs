/** Offline schema and contract checks: not an assertion that Q01 is fixed. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixtureFile = path.join(__dirname, 'fixtures/completion-attribution-q01.synthetic.json');
const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));

test('Q01 has exactly 20 labeled synthetic cases in four groups', () => {
  assert.equal(fixture.version, 'q01-synthetic-20-v1');
  assert.equal(fixture.provenance, 'assistant-authored-synthetic-no-player-content');
  assert.equal(fixture.cases.length, 20);
  assert.equal(new Set(fixture.cases.map((c) => c.id)).size, 20);
  const kinds = new Set(fixture.cases.map((c) => c.kind));
  assert.deepEqual([...kinds].sort(), ['explicit_player','implicit_player','persona_self','third_party']);
});

test('synthetic labels cover both permitted and forbidden ownership', () => {
  for (const c of fixture.cases) {
    assert.equal(c.expected, c.id.startsWith('P'));
    assert.ok(c.anchor.length >= 2 && c.text.length >= 6 && c.text.length <= 100);
  }
});

test('fixture contains no network endpoints or credential-looking fields', () => {
  const raw = fs.readFileSync(fixtureFile, 'utf8');
  assert.doesNotMatch(raw, /https?:\/\/|api[_-]?key|bearer\s+|private[_-]?key|@\w+\.[a-z]{2,}/iu);
});

test('audit rejects unknown flags without loading the runtime', () => {
  const cli = path.resolve(__dirname, '../scripts/audit-completion-attribution-q01.cjs');
  const r = spawnSync(process.execPath, [cli, '--bad-option'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage:/);
  assert.doesNotMatch(r.stdout, /那个问题/u);
});


test('audit emits structured metadata only, without source snippets', () => {
  const cli = path.resolve(__dirname, '../scripts/audit-completion-attribution-q01.cjs');
  const r = spawnSync(process.execPath, [cli, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.count, 20);
  assert.equal(result.matches + result.mismatches, 20);
  assert.deepEqual(Object.keys(result).sort(),
    ['by_category','count','fixture_sha256','source_sha256','matches','mismatch_ids','mismatches','status'].sort());
  assert.doesNotMatch(r.stdout, /那个问题|简历|实验记录/u);
  assert.match(result.fixture_sha256, /^[a-f0-9]{64}$/u);
  assert.match(result.source_sha256, /^[a-f0-9]{64}$/u);
});


test('adversarial set extends Q01 with 20 unique synthetic cases', () => {
  const adversarial = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/completion-attribution-q01.adversarial.json'), 'utf8'));
  assert.equal(adversarial.cases.length, 20);
  assert.equal(adversarial.provenance, fixture.provenance);
  const ids = [...fixture.cases, ...adversarial.cases].map((x) => x.id);
  assert.equal(new Set(ids).size, 40);
  assert.ok(adversarial.cases.every((x) => x.kind === 'adversarial' && typeof x.expected === 'boolean'));
});

test('audit stress mode adds 20 cases without echoing raw phrases', () => {
  const cli = path.resolve(__dirname, '../scripts/audit-completion-attribution-q01.cjs');
  const r = spawnSync(process.execPath, [cli, '--json', '--stress'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.count, 40);
  assert.equal(result.matches + result.mismatches, 40);
  assert.equal(result.by_category.adversarial.count, 20);
  assert.match(result.stress_fixture_sha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(r.stdout, /那个问题|简历|实验记录/u);
});
