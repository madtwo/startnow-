#!/usr/bin/env node
/** Q01 blinded, independently reviewed, fail-closed label gate (candidate v1.9).
 * No runtime change; no network, external packages, automatic label creation,
 * or claims that a reviewer identity was authenticated.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'startnow-q01-blind-review-v1';
const RUBRIC = 'q01-actor-v1';
const RUNTIME_SHA = '21db764e500e077a486e310450c5bc146ee54b0171e4636bf45e9f2710d6e7f8';
const FIXTURES = [
  ['completion-attribution-q01.synthetic.json', '308e78639dc794747c935a51a9cbf09ea206bfb03404683282498810daf8e3d1', 20],
  ['completion-attribution-q01.adversarial.json', 'ef2303096e1f6aa4355d89d7b457cf55a77b09898095d4d8f9242665298e4bc4', 20],
  ['completion-attribution-q01.extension-candidate.json', '24924f912b9a6ad5a343eff069175757fafebb4403e8f510eb66277d2c481b9b', 58],
];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
// These three Q01 pins were created from CRLF fixture snapshots.
// Normalize only line endings before comparing against those unchanged pins;
// this is not permission to alter a label, text, whitespace or the runtime SHA.
const pinnedFixtureSha = bytes => sha(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8'));
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const die = msg => { throw new Error(msg); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function argsOf(argv) {
  const [command, ...tail] = argv;
  if (!['prepare', 'check'].includes(command)) die('Use prepare or check');
  const opts = {};
  for (let i = 0; i < tail.length; i += 2) {
    const opt = tail[i];
    if (!opt?.startsWith('--') || !tail[i + 1] || tail[i + 1].startsWith('--')) die('Expected --option value pairs');
    if (!['--fixtures-dir', '--out', '--run', '--a', '--b', '--report'].includes(opt) || opts[opt]) die(`Invalid/repeated option ${opt}`);
    opts[opt] = tail[i + 1];
  }
  if (command === 'prepare' && (!opts['--out'] || opts['--run'] || opts['--a'] || opts['--b'] || opts['--report'])) die('prepare requires --out only');
  if (command === 'check' && (!opts['--run'] || !opts['--a'] || !opts['--b'] || opts['--out'])) die('check requires --run --a --b');
  return { command, opts };
}
function loadFixtures(dir) {
  const all = [];
  const hashes = {};
  const seen = new Set();
  for (const [filename, expectedSha, expectedCount] of FIXTURES) {
    const bytes = fs.readFileSync(path.join(dir, filename));
    const digest = pinnedFixtureSha(bytes);
    if (digest !== expectedSha) die(`Fixture SHA mismatch: ${filename}`);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(parsed.cases) || parsed.cases.length !== expectedCount) die(`Fixture count mismatch: ${filename}`);
    hashes[filename] = digest;
    for (const row of parsed.cases) {
      if (typeof row.id !== 'string' || !/^[A-Z][0-9]{2}$/.test(row.id) || seen.has(row.id) ||
          typeof row.anchor !== 'string' || typeof row.text !== 'string' || typeof row.expected !== 'boolean') {
        die(`Invalid fixture row in ${filename}`);
      }
      seen.add(row.id);
      all.push({ id: row.id, anchor: row.anchor, text: row.text, expected: row.expected });
    }
  }
  if (all.length !== 98) die('Q01 fixture cardinality mismatch');
  return { all, hashes };
}
function verifyRuntime() {
  const source = fs.readFileSync(path.resolve('src/lib/completionReaction.ts'));
  const actual = sha(source);
  if (actual !== RUNTIME_SHA) die('Runtime SHA mismatch: v1.8 candidate changed, re-baseline review first');
  return actual;
}
function shuffle(input) {
  const rows = [...input];
  for (let i = rows.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}
function writeNew(p, bytes) { fs.writeFileSync(p, bytes, { flag: 'wx', mode: 0o600 }); }
function encodeLines(rows) { return Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }

function prepare(opts) {
  const fixturesDir = path.resolve(opts['--fixtures-dir'] || 'tests/fixtures');
  const out = path.resolve(opts['--out']);
  if (fs.existsSync(out)) die('Output already exists; refusing to overwrite a review run');
  const { all, hashes } = loadFixtures(fixturesDir);
  const runtimeSha = verifyRuntime();
  const runId = crypto.randomUUID();
  const tokens = new Set();
  const nextToken = () => {
    let token;
    do { token = crypto.randomBytes(12).toString('hex'); } while (tokens.has(token));
    tokens.add(token);
    return token;
  };
  const manifest = {
    schema: SCHEMA, rubric_version: RUBRIC, run_id: runId,
    created_at: new Date().toISOString(), runtime_sha256: runtimeSha, fixture_sha256: hashes,
    rows: all.map(row => ({ ...row, tokens: { a: nextToken(), b: nextToken() } })),
  };
  // Coordinator-only: includes source labels and IDs; never distribute this file to annotators.
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  writeNew(path.join(out, 'manifest.json'), jsonBytes(manifest));
  const manifestSha = sha(fs.readFileSync(path.join(out, 'manifest.json')));
  for (const slot of ['a', 'b']) {
    const header = {
      type: 'header', slot, run_id: runId, manifest_sha256: manifestSha,
      rubric_version: RUBRIC, reviewer_id: '', reviewed_at: '', independent_review: false,
    };
    // No expected, kind, P/N/A/E ID or runtime output in the blinded packets.
    const cases = shuffle(manifest.rows).map(row => ({
      type: 'case', token: row.tokens[slot], anchor: row.anchor,
      text: row.text, verdict: null, note: '',
    }));
    writeNew(path.join(out, `packet-${slot}.jsonl`), encodeLines([header, ...cases]));
  }
  process.stdout.write(`Q01 review packets ready: 98 cases each; manifest SHA256 ${manifestSha}; NOT approved.\n`);
}
function loadJsonl(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length !== 99) die(`Review row count mismatch in ${path.basename(p)}`);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch { die(`Malformed JSONL at line ${i + 1} in ${path.basename(p)}`); }
  });
}
function inspectPacket(p, slot, manifest, manifestSha) {
  const [header, ...cases] = loadJsonl(p);
  if (header.type !== 'header' || header.slot !== slot || header.run_id !== manifest.run_id ||
      header.manifest_sha256 !== manifestSha || header.rubric_version !== RUBRIC ||
      header.independent_review !== true ||
      typeof header.reviewer_id !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(header.reviewer_id) ||
      typeof header.reviewed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(header.reviewed_at) ||
      !Number.isFinite(Date.parse(header.reviewed_at))) {
    die(`Invalid reviewer metadata, missing attestation or stale packet ${slot}`);
  }
  const allowed = new Map(manifest.rows.map(row => [row.tokens[slot], row]));
  const votes = new Map();
  for (const item of cases) {
    if (item.type !== 'case' || typeof item.token !== 'string' || !allowed.has(item.token) || votes.has(item.token)) {
      die(`Duplicate/unrecognized case token in packet ${slot}`);
    }
    const row = allowed.get(item.token);
    if (item.anchor !== row.anchor || item.text !== row.text ||
        (item.verdict !== 'player' && item.verdict !== 'not_player' && item.verdict !== 'unsure' && item.verdict !== null) ||
        typeof item.note !== 'string' || item.note.length > 500) {
      die(`Tampered sample, invalid verdict or note in packet ${slot}`);
    }
    votes.set(item.token, item.verdict);
  }
  if (votes.size !== manifest.rows.length) die(`Incomplete packet ${slot}`);
  return { header, votes, digest: sha(fs.readFileSync(p)) };
}
function check(opts) {
  const fixturesDir = path.resolve(opts['--fixtures-dir'] || 'tests/fixtures');
  const run = path.resolve(opts['--run']);
  const manifestBytes = fs.readFileSync(path.join(run, 'manifest.json'));
  const manifestSha = sha(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { all, hashes } = loadFixtures(fixturesDir);
  const runtimeSha = verifyRuntime();
  if (manifest.schema !== SCHEMA || manifest.rubric_version !== RUBRIC ||
      manifest.runtime_sha256 !== runtimeSha ||
      !equal(manifest.fixture_sha256, hashes) || !Array.isArray(manifest.rows) ||
      manifest.rows.length !== 98 || !equal(manifest.rows.map(({ tokens, ...rest }) => rest), all)) {
    die('Manifest does not match the pinned Q01 fixture snapshot');
  }
  const tokenSet = new Set();
  for (const row of manifest.rows) {
    if (!row.tokens || !/^[a-f0-9]{24}$/.test(row.tokens.a || '') ||
        !/^[a-f0-9]{24}$/.test(row.tokens.b || '') ||
        tokenSet.has(row.tokens.a) || tokenSet.has(row.tokens.b)) die('Invalid/colliding manifest token');
    tokenSet.add(row.tokens.a); tokenSet.add(row.tokens.b);
  }
  const a = inspectPacket(path.resolve(opts['--a']), 'a', manifest, manifestSha);
  const b = inspectPacket(path.resolve(opts['--b']), 'b', manifest, manifestSha);
  if (a.header.reviewer_id.toLowerCase() === b.header.reviewer_id.toLowerCase()) die('Reviewer IDs must differ');
  const summary = { total: 98, agreed: 0, pending: [], disagreed: [], label_conflicts: [] };
  for (const row of manifest.rows) {
    const va = a.votes.get(row.tokens.a);
    const vb = b.votes.get(row.tokens.b);
    if (!va || !vb || va === 'unsure' || vb === 'unsure') summary.pending.push(row.id);
    else if (va !== vb) summary.disagreed.push(row.id);
    else {
      summary.agreed++;
      if ((va === 'player') !== row.expected) summary.label_conflicts.push(row.id);
    }
  }
  const ready = summary.agreed === 98 && summary.label_conflicts.length === 0;
  const report = {
    schema: 'startnow-q01-blind-review-report-v1', run_id: manifest.run_id,
    rubric_version: RUBRIC, manifest_sha256: manifestSha, runtime_sha256: runtimeSha, fixture_sha256: hashes,
    reviewer_a: { id: a.header.reviewer_id, reviewed_at: a.header.reviewed_at, sha256: a.digest },
    reviewer_b: { id: b.header.reviewer_id, reviewed_at: b.header.reviewed_at, sha256: b.digest },
    ...summary, status: ready ? 'READY_FOR_EXTERNAL_SIGNOFF' : 'BLOCKED',
    release_go: false, score_locked: false,
    limitations: 'Reviewers self-attested; tool cannot authenticate human identity or independence; Q06 gate and real model/browser checks remain separate.',
  };
  if (opts['--report']) {
    const reportPath = path.resolve(opts['--report']);
    writeNew(reportPath, jsonBytes(report));
  }
  process.stdout.write(`Q01 review check: ${summary.agreed}/98 agreed; pending=${summary.pending.length}; disagreed=${summary.disagreed.length}; label_conflicts=${summary.label_conflicts.length}; ${report.status}; RELEASE NO-GO.\n`);
  if (!ready) process.exitCode = 1;
}
function main(argv) {
  const { command, opts } = argsOf(argv);
  if (command === 'prepare') prepare(opts);
  else check(opts);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`Q01 review gate: ${e.message}\n`); process.exitCode = 2; }
}
module.exports = { main, loadFixtures, inspectPacket, FIXTURES, pinnedFixtureSha };
