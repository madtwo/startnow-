#!/usr/bin/env node
/**
 * Q01 characterization only: no production edit, network call, or player content.
 * --gate deliberately fails on known gaps. Keep it OUT of the release baseline
 * until ownership decisions and regressions have been reviewed.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const flagSet = new Set(process.argv.slice(2));
const validFlags = new Set(['--json', '--gate', '--stress']);
if ([...flagSet].some((f) => !validFlags.has(f)) || flagSet.size !== process.argv.length - 2) {
  console.error('Usage: node scripts/audit-completion-attribution-q01.cjs [--json] [--gate] [--stress]');
  process.exit(2);
}

const fixturePath = path.resolve(__dirname, '../tests/fixtures/completion-attribution-q01.synthetic.json');
const sourcePath = path.resolve(__dirname, '../src/lib/completionReaction.ts');
const fixtureBytes = fs.readFileSync(fixturePath);
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const sourceSha256 = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
let fixture;
try {
  fixture = JSON.parse(fixtureBytes.toString('utf8'));
} catch {
  console.error('Q01 audit aborted (invalid_json).');
  process.exit(2);
}
const categories = ['explicit_player', 'implicit_player', 'third_party', 'persona_self'];
function assertFixture(data) {
  if (data.version !== 'q01-synthetic-20-v1' ||
      data.provenance !== 'assistant-authored-synthetic-no-player-content' ||
      data.status !== 'characterization-only-not-human-review' ||
      !Array.isArray(data.cases) || data.cases.length !== 20) {
    throw new Error('Q01 fixture must be the versioned synthetic 20-case set');
  }
  const ids = new Set();
  const totals = Object.fromEntries(categories.map((c) => [c, 0]));
  for (const x of data.cases) {
    if (typeof x.id !== 'string' || !/^[PN][0-9]{2}$/u.test(x.id) || ids.has(x.id) ||
        !categories.includes(x.kind) || typeof x.anchor !== 'string' ||
        typeof x.text !== 'string' || typeof x.expected !== 'boolean' ||
        x.anchor.length < 2 || x.text.length < 6 || x.text.length > 100) {
      throw new Error('Malformed, duplicate or non-synthetic Q01 case');
    }
    ids.add(x.id);
    totals[x.kind]++;
  }
  if (categories.some((c) => totals[c] === 0)) throw new Error('Missing attribution category');
  return totals;
}

try {
  const totals = assertFixture(fixture);
  let stressSha256;
  let cases = fixture.cases;
  if (flagSet.has('--stress')) {
    const stressPath = path.resolve(__dirname, '../tests/fixtures/completion-attribution-q01.adversarial.json');
    const bytes = fs.readFileSync(stressPath);
    stressSha256 = createHash('sha256').update(bytes).digest('hex');
    const stress = JSON.parse(bytes.toString('utf8'));
    if (stress.version !== 'q01-adversarial-20-v1' ||
        stress.provenance !== fixture.provenance || stress.status !== fixture.status ||
        !Array.isArray(stress.cases) || stress.cases.length !== 20) {
      throw new Error('Malformed Q01 adversarial fixture');
    }
    const allIds = new Set(cases.map((c) => c.id));
    for (const x of stress.cases) {
      if (typeof x.id !== 'string' || !/^A[0-9]{2}$/u.test(x.id) || allIds.has(x.id) ||
          x.kind !== 'adversarial' || typeof x.anchor !== 'string' ||
          typeof x.text !== 'string' || typeof x.expected !== 'boolean' ||
          x.anchor.length < 2 || x.text.length < 6 || x.text.length > 100) {
        throw new Error('Malformed adversarial case');
      }
      allIds.add(x.id);
    }
    cases = [...cases, ...stress.cases];
    totals.adversarial = 20;
  }
  // Use the project's own TypeScript test loader. No stub or dependency injection
  // runs in the real project: the production module is imported as-is.
  require('../tests/_ts-loader.cjs');
  const { isGroundedCompletionReaction } = require(sourcePath);
  if (typeof isGroundedCompletionReaction !== 'function') throw new Error('Completion validator missing');
  const rows = cases.map(({ id, kind, anchor, text, expected }) => {
    const actual = Boolean(isGroundedCompletionReaction(text, anchor));
    return { id, kind, expected, actual, matches: expected === actual };
  });
  const mismatches = rows.filter((r) => !r.matches);
  const byCategory = Object.fromEntries(Object.keys(totals).map((kind) => {
    const group = rows.filter((r) => r.kind === kind);
    return [kind, { count: group.length, matches: group.filter((r) => r.matches).length, mismatches: group.filter((r) => !r.matches).length }];
  }));
  const summary = {
    status: 'synthetic-characterization-only',
    fixture_sha256: fixtureSha256,
    source_sha256: sourceSha256,
    count: cases.length,
    matches: rows.length - mismatches.length,
    mismatches: mismatches.length,
    by_category: byCategory,
    ...(stressSha256 ? { stress_fixture_sha256: stressSha256 } : {}),
    // IDs are synthetic. Never emit the text/anchor or user content.
    mismatch_ids: mismatches.map((r) => r.id),
  };
  if (flagSet.has('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Q01 synthetic characterization: ${summary.matches}/${summary.count} expected labels matched`);
    for (const [category, row] of Object.entries(byCategory)) {
      console.log(`  ${category}: ${row.matches}/${row.count}; mismatches=${row.mismatches}`);
    }
    console.log(`  mismatched case IDs: ${summary.mismatch_ids.join(', ') || '(none)'}`);
    console.log(`  fixture SHA256: ${fixtureSha256}`);
    console.log(`  source SHA256: ${sourceSha256}`);
    if (stressSha256) console.log(`  stress fixture SHA256: ${stressSha256}`);
    console.log('  Gate: not an approval; independent human review is still required.');
  }
  if (flagSet.has('--gate') && mismatches.length) process.exitCode = 1;
} catch (error) {
  // Do not echo raw text from failed cases or arbitrary exception content.
  console.error(`Q01 audit aborted (${error instanceof SyntaxError ? 'invalid_json' : 'invalid_fixture_or_environment'}).`);
  process.exitCode = 2;
}
