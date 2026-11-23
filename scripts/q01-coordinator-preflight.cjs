#!/usr/bin/env node
/**
 * Read-only Q01 freeze-drift preflight for the CONTROLLED COORDINATOR.
 * This deliberately cannot re-pin the runtime, issue blind packets, accept
 * votes, authenticate humans, or approve release. No network or API keys.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const gate = require('./q01-human-review-gate.cjs');

const ROOT = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function classifyRuntimeDigest(actual, expected) {
  const same = actual === expected;
  return {
    runtime_pin_matches: same,
    status: same ? 'AWAITING_INDEPENDENT_HUMAN_Q01_REVIEW' : 'BLOCKED_RUNTIME_BASELINE_DRIFT',
    may_prepare_Q01_blind_packets: same,
    // Even successful preparation and reviewer agreement cannot by itself
    // authorize a public release; two real reviewers + signoff are required.
    release_go: false,
    human_double_review_complete: false,
  };
}

function buildReport(root = ROOT) {
  const sourcePath = path.join(root, 'src', 'lib', 'completionReaction.ts');
  const fixtureDir = path.join(root, 'tests', 'fixtures');
  const actual = hash(fs.readFileSync(sourcePath));
  // The existing gate verifies all three original frozen fixture hashes, not
  // just counts. A changed label or sentence throws before any report exists.
  const { all, hashes } = gate.loadFixtures(fixtureDir);
  const result = classifyRuntimeDigest(actual, gate.RUNTIME_SHA);
  return {
    schema: 'startnow-q01-coordinator-preflight-v1',
    scope: 'read-only artifact and source verification; not a review',
    pinned_runtime_sha256: gate.RUNTIME_SHA,
    current_runtime_sha256: actual,
    frozen_fixture_count: all.length,
    frozen_fixture_sha256: hashes,
    fixture_integrity: 'MATCHED_ORIGINAL_PINS',
    ...result,
    q06_review_status: 'NOT_ASSESSED',
    next_action: result.runtime_pin_matches
      ? 'The controlled coordinator may use the existing Q01 prepare gate; obtain two independent human judgments, adjudicate, and sign off separately.'
      : 'Keep the Q01 gate blocked. The controlled coordinator must retrieve the v1.8 frozen runtime, compare the candidate changes, document a new version and SHA pin by an authorized review process, then restart two independent human reviews.',
    note: 'No labels, case text, identity evidence, API keys, simulated judgments, or live-call results are included.',
  };
}

function parseArgs(argv) {
  if (!argv.length) return {};
  if (argv.length === 2 && argv[0] === '--out' && argv[1] && !argv[1].startsWith('--')) {
    return { out: argv[1] };
  }
  throw Error('Usage: node scripts/q01-coordinator-preflight.cjs [--out NEW-REPORT.json]');
}

function main(argv) {
  const { out } = parseArgs(argv);
  const report = buildReport();
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (out) {
    // Preserve earlier coordination evidence, never overwrite it in place.
    fs.writeFileSync(path.resolve(out), serialized, { flag: 'wx', mode: 0o600 });
  }
  process.stdout.write(serialized);
  // Expected drift is an actionable blocker, not a successful gate pass.
  if (!report.runtime_pin_matches) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`Q01 preflight: ${e.message}\n`); process.exitCode = 2; }
}
module.exports = { classifyRuntimeDigest, buildReport, parseArgs, main };
