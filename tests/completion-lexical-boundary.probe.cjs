/**
 * v1.5 review-only probe. This file does NOT belong in the release test gate
 * until an independently reviewed fix has been implemented.
 *
 *   node tests/completion-lexical-boundary.probe.cjs --inspect
 *   node tests/completion-lexical-boundary.probe.cjs --run
 *
 * All fixture cases are synthetic; the script never reads player content,
 * persists output, invokes a model, or makes network calls.
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');

const fixturesPath = path.join(__dirname, 'fixtures', 'completion-lexical-boundary-probe.json');
const mode = process.argv.includes('--run') ? 'run' : 'inspect';

function getCases() {
  const rows = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  if (!Array.isArray(rows) || rows.length < 10) throw Error('At least 10 synthetic cases required');
  const ids = new Set();
  let positive = 0; let negative = 0;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !/^(pos|neg)-[a-z0-9-]+$/.test(row.id) || ids.has(row.id))
      throw Error('Duplicate or invalid case id');
    if (typeof row.anchor !== 'string' || !row.anchor || typeof row.text !== 'string' || !row.text ||
      typeof row.expected !== 'boolean' || typeof row.why !== 'string' || !row.why)
      throw Error(`Malformed case ${row.id}`);
    if ((row.id.startsWith('pos-')) !== row.expected) throw Error(`Case label mismatch: ${row.id}`);
    ids.add(row.id);
    if (row.expected) positive++; else negative++;
  }
  if (positive < 5 || negative < 5) throw Error('Not enough positive/negative controls');
  return {rows, positive, negative};
}

function run() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Use --inspect to verify synthetic fixtures (default), --run to check the real completionReaction validator.\n');
    return;
  }
  const {rows, positive, negative} = getCases();
  if (mode === 'inspect') {
    process.stdout.write(`Fixture verified: ${rows.length} synthetic cases (${positive} positives / ${negative} negatives). No production code run.\n`);
    return;
  }
  // Use the same TypeScript loader as the existing full-repo test suite.
  const loader = path.join(__dirname, '_ts-loader.cjs');
  const src = path.join(__dirname, '..', 'src', 'lib', 'completionReaction.ts');
  if (!fs.existsSync(loader) || !fs.existsSync(src)) {
    process.stderr.write('Cannot execute against production validator: require full repository tests/_ts-loader.cjs and src/lib/completionReaction.ts.\n');
    process.exitCode = 2;
    return;
  }
  require(loader);
  const {isGroundedCompletionReaction} = require(src);
  if (typeof isGroundedCompletionReaction !== 'function') throw Error('Validator export not found');
  let passes = 0;
  for (const row of rows) {
    const actual = Boolean(isGroundedCompletionReaction(row.text, row.anchor));
    if (actual === row.expected) {passes++; continue;}
    // Do not include source text in console output: only case IDs, labels and outcomes.
    process.stdout.write(`MISMATCH id=${row.id} expected=${row.expected} observed=${actual}\n`);
  }
  process.stdout.write(`Result: ${passes}/${rows.length} synthetic cases matched current validator.\n`);
  if (passes !== rows.length) process.exitCode = 1;
}
try { run(); } catch (error) {
  process.stderr.write(`Probe error: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exitCode = 2;
}
