#!/usr/bin/env node
/** Q06 advice-alias blind dual-review gate. Offline and fail-closed.
 * Generates synthetic packets; NEVER authenticates reviewers or signs a release.
 * Keep manifest.json in the coordinator's private directory, not with reviewers.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'startnow-q06-blind-review-v1';
const RUBRIC = 'q06-advice-alias-v1';
const FIXTURE_PATH = path.resolve(__dirname, '../tests/fixtures/q06-advice-alias.v1.json');
const FIXTURE_SHA = 'e9e021ccea10785841eaca9698360981f7c0c5688e9b5d11bdc0dfd92a7188df';
const RUNTIME_FILES = Object.freeze({
  'src/lib/adviceLine.ts': '0e92ecf88afcaa39b53796effa092aa7e944434171491c1a372cb24f3c986134',
  'src/lib/actions.ts': 'a1380a3a459ab20ecbf4b6e6f23c6f8cdc22455aa77f908d52a32f29be09b68e',
});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = msg => { throw new Error(msg); };
const exactKeys = (obj, keys) => Boolean(obj) && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join('|') === [...keys].sort().join('|');
const encode = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const jsonBytes = obj => JSON.stringify(obj, null, 2) + '\n';
const writeNew = (filename, data) => fs.writeFileSync(filename, data, { flag: 'wx', mode: 0o600 });

function parseOptions(argv) {
  const [command, ...args] = argv;
  if (!['prepare', 'check'].includes(command)) fail('Use prepare or check');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (i + 1 >= args.length || !['--out', '--run', '--a', '--b', '--report', '--manifest-sha256'].includes(args[i]) ||
        opts[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) fail('Invalid or repeated --option value');
    opts[args[i]] = args[i + 1];
  }
  if (command === 'prepare' &&
      (!opts['--out'] || Object.keys(opts).length !== 1)) fail('prepare requires --out <new-directory>');
  if (command === 'check' &&
      (!opts['--run'] || !opts['--a'] || !opts['--b'] || !opts['--manifest-sha256'] ||
       Object.keys(opts).some(k => !['--run','--a','--b','--report','--manifest-sha256'].includes(k)))) {
    fail('check requires --run <dir> --a <answers-a> --b <answers-b> --manifest-sha256 <trusted-digest> [--report <new-file>]');
  }
  return { command, opts };
}

function loadFrozen() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  if (hash(buf) !== FIXTURE_SHA) fail('Q06 source fixture SHA changed: rebaseline with human coordinator');
  for (const [filename, expected] of Object.entries(RUNTIME_FILES)) {
    if (hash(fs.readFileSync(path.resolve(__dirname, '..', filename))) !== expected) {
      fail(`Q06 runtime SHA changed: ${filename}; a new human review baseline is required`);
    }
  }
  const data = JSON.parse(buf.toString('utf8'));
  if (data.schema !== 'startnow-q06-alias-fixture-v1' || !Array.isArray(data.cases) ||
      data.cases.length !== 10) fail('Q06 frozen set must contain exactly 10 cases');
  const ids = new Set(); let accepted = 0; let rejected = 0;
  for (const row of data.cases) {
    if (!exactKeys(row, ['id','actionId','actionLabel','context','candidateLine','expected']) ||
        typeof row.id !== 'string' || !/^(?:AL0[1-8]|C04|C10)$/.test(row.id) || ids.has(row.id) ||
        !['accept','reject'].includes(row.expected) ||
        ![row.actionId,row.actionLabel,row.context,row.candidateLine].every(t => typeof t === 'string' && t.length > 0)) {
      fail('Invalid, duplicated or modified Q06 frozen case');
    }
    ids.add(row.id);
    if (row.expected === 'accept') accepted++; else rejected++;
  }
  if (accepted !== 9 || rejected !== 1 ||
      data.cases.find(r => r.id === 'C04')?.expected !== 'reject' ||
      data.cases.find(r => r.id === 'C10')?.expected !== 'accept') fail('C04/C10 or alias counts changed');
  return data.cases;
}
function shuffled(rows) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function prepare(out) {
  const cases = loadFrozen();
  const run = path.resolve(out);
  if (fs.existsSync(run)) fail('Review output already exists; refusing to overwrite');
  const runId = crypto.randomUUID();
  const tokens = new Set();
  const getToken = () => {
    let v; do { v = crypto.randomBytes(12).toString('hex'); } while (tokens.has(v));
    tokens.add(v); return v;
  };
  const manifest = {
    schema: SCHEMA, rubric_version: RUBRIC, run_id: runId, created_at: new Date().toISOString(),
    fixture_sha256: FIXTURE_SHA, runtime_sha256: RUNTIME_FILES,
    rows: cases.map(row => ({ ...row, tokens: { a: getToken(), b: getToken() } })),
  };
  fs.mkdirSync(run, { mode: 0o700 });
  writeNew(path.join(run, 'manifest.json'), jsonBytes(manifest));
  const manifestSha = hash(fs.readFileSync(path.join(run, 'manifest.json')));
  for (const slot of ['a', 'b']) {
    const header = {
      type: 'header', slot, run_id: runId, manifest_sha256: manifestSha,
      rubric_version: RUBRIC, reviewer_id: '', reviewed_at: '', independent_review: false,
    };
    const rows = shuffled(manifest.rows).map(row => ({
      type: 'case', token: row.tokens[slot], actionLabel: row.actionLabel,
      context: row.context, candidateLine: row.candidateLine, verdict: null, note: '',
    }));
    writeNew(path.join(run, `packet-${slot}.jsonl`), encode([header, ...rows]));
  }
  process.stdout.write('Q06: 2 independent packets, 10 synthetic cases each. NOT REVIEWED; RELEASE NO-GO.\nmanifest_sha256=${manifestSha} — retain this separately from the review folder; keep manifest private.\n');
}
function loadLines(filename) {
  const bytes = fs.readFileSync(filename);
  if (bytes.length > 1_000_000) fail('Q06 review file too large');
  const lines = bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length !== 11) fail('Q06 review requires exactly 1 header + 10 cases');
  return lines.map((line, i) => {
    try { return JSON.parse(line); } catch { fail(`Malformed Q06 JSONL line ${i+1}`); }
  });
}
function inspectPacket(filename, slot, manifest, manifestSha) {
  const [header, ...rows] = loadLines(filename);
  const headerKeys = ['type','slot','run_id','manifest_sha256','rubric_version','reviewer_id','reviewed_at','independent_review'];
  if (!exactKeys(header,headerKeys) || header.type !== 'header' || header.slot !== slot ||
      header.run_id !== manifest.run_id || header.manifest_sha256 !== manifestSha ||
      header.rubric_version !== RUBRIC || header.independent_review !== true ||
      typeof header.reviewer_id !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(header.reviewer_id) ||
      typeof header.reviewed_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(header.reviewed_at) ||
      !Number.isFinite(Date.parse(header.reviewed_at)) ||
      new Date(header.reviewed_at).toISOString() !== header.reviewed_at ||
      Date.parse(header.reviewed_at) < Date.parse(manifest.created_at) ||
      Date.parse(header.reviewed_at) > Date.now() + 300000) {
    fail(`Q06 invalid reviewer attestation/metadata: packet ${slot}`);
  }
  const allowed = new Map(manifest.rows.map(row => [row.tokens[slot], row]));
  const votes = new Map();
  for (const item of rows) {
    if (!exactKeys(item, ['type','token','actionLabel','context','candidateLine','verdict','note']) ||
        item.type !== 'case' || !allowed.has(item.token) || votes.has(item.token)) {
      fail(`Q06 tampered/duplicated case token: packet ${slot}`);
    }
    const source = allowed.get(item.token);
    if (item.actionLabel !== source.actionLabel || item.context !== source.context ||
        item.candidateLine !== source.candidateLine ||
        !['accept','reject','unsure',null].includes(item.verdict) ||
        typeof item.note !== 'string' || item.note.length > 300) {
      fail(`Q06 case changed or invalid verdict: packet ${slot}`);
    }
    votes.set(item.token, item.verdict);
  }
  if (votes.size !== manifest.rows.length) fail(`Q06 packet ${slot} incomplete`);
  return { header, votes, digest: hash(fs.readFileSync(filename)) };
}
function check(opts) {
  const cases = loadFrozen();
  const manifestBytes = fs.readFileSync(path.join(path.resolve(opts['--run']), 'manifest.json'));
  const manifestSha = hash(manifestBytes);
  if (!/^[0-9a-f]{64}$/.test(opts['--manifest-sha256'] || '') ||
      manifestSha !== opts['--manifest-sha256']) fail('Q06 manifest SHA differs from trusted prepare receipt');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!exactKeys(manifest, ['schema','rubric_version','run_id','created_at','fixture_sha256','runtime_sha256','rows']) ||
      manifest.schema !== SCHEMA || manifest.rubric_version !== RUBRIC ||
      manifest.fixture_sha256 !== FIXTURE_SHA ||
      JSON.stringify(manifest.runtime_sha256) !== JSON.stringify(RUNTIME_FILES) ||
      !Array.isArray(manifest.rows) || manifest.rows.length !== cases.length ||
      JSON.stringify(manifest.rows.map(({ tokens, ...row }) => row)) !== JSON.stringify(cases)) {
    fail('Q06 manifest does not match pinned source and runtime');
  }
  const allTokens = new Set();
  for (const row of manifest.rows) {
    if (!exactKeys(row.tokens, ['a','b'])) fail('Q06 invalid manifest tokens');
    for (const slot of ['a','b']) {
      const token = row.tokens[slot];
      if (typeof token !== 'string' || !/^[0-9a-f]{24}$/.test(token) || allTokens.has(token)) fail('Q06 duplicate/bad manifest token');
      allTokens.add(token);
    }
  }
  const a = inspectPacket(path.resolve(opts['--a']), 'a', manifest, manifestSha);
  const b = inspectPacket(path.resolve(opts['--b']), 'b', manifest, manifestSha);
  if (a.header.reviewer_id.toLowerCase() === b.header.reviewer_id.toLowerCase()) fail('Q06 reviewer IDs must differ');
  const stats = { total: 10, agreed: 0, pending: [], disagreed: [], label_conflicts: [] };
  for (const row of manifest.rows) {
    const av = a.votes.get(row.tokens.a), bv = b.votes.get(row.tokens.b);
    if (!av || !bv || av === 'unsure' || bv === 'unsure') stats.pending.push(row.id);
    else if (av !== bv) stats.disagreed.push(row.id);
    else {
      stats.agreed++;
      if (av !== row.expected) stats.label_conflicts.push(row.id);
    }
  }
  const ready = stats.agreed === 10 && stats.pending.length === 0 &&
    stats.disagreed.length === 0 && stats.label_conflicts.length === 0;
  const report = {
    schema: 'startnow-q06-blind-review-report-v1', run_id: manifest.run_id,
    rubric_version: RUBRIC, fixture_sha256: FIXTURE_SHA, manifest_sha256: manifestSha,
    reviewer_a: { id: a.header.reviewer_id, reviewed_at: a.header.reviewed_at, sha256: a.digest },
    reviewer_b: { id: b.header.reviewer_id, reviewed_at: b.header.reviewed_at, sha256: b.digest },
    ...stats, status: ready ? 'READY_FOR_EXTERNAL_SIGNOFF' : 'BLOCKED',
    release_go: false, score_locked: false,
    limitations: 'Only self-attested reviewer IDs. Cannot authenticate human identity/independence. Requires external signoff and separate Q01 approval.',
  };
  if (opts['--report']) writeNew(path.resolve(opts['--report']), jsonBytes(report));
  process.stdout.write(`Q06 check: ${stats.agreed}/10 agreed; pending=${stats.pending.length}; disagreed=${stats.disagreed.length}; label_conflicts=${stats.label_conflicts.length}; ${report.status}; RELEASE NO-GO.\n`);
  if (!ready) process.exitCode = 1;
  return report;
}
function main(args) {
  const { command, opts } = parseOptions(args);
  if (command === 'prepare') prepare(opts['--out']);
  else check(opts);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (err) { process.stderr.write(`Q06 review gate: ${err instanceof Error ? err.message : 'invalid input'}\n`); process.exitCode = 2; }
}
module.exports = { main, loadFrozen, inspectPacket, check, parseOptions, FIXTURE_SHA, RUNTIME_FILES };
