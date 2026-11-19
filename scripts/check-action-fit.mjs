#!/usr/bin/env node
/** 60 annotated user-style cards; objective routing only, NOT an AI quality blind review.
 * Run with Node >=22.6: node --experimental-strip-types scripts/check-action-fit.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(readFileSync(resolve(root, 'fixtures/action-fit.json'), 'utf8'));
const { matchActionIntent, pickActions } = await import(pathToFileURL(resolve(root, 'src/lib/actions.ts')).href);
assert.equal(cases.length, 60, 'exactly 60 labeled cases are required');
let matches = 0, withAdvice = 0, explicitlyClarified = 0, bad = 0;
const output = [];
for (const row of cases) {
  const intent = matchActionIntent(row.text);
  const actions = pickActions(12, 3, undefined, row.text);
  const matched = intent?.theme === row.expectedTheme;
  if (matched) matches++;
  if (actions.length) withAdvice++;
  else explicitlyClarified++;
  const forbidden = row.forbiddenThemes.includes(intent?.theme);
  const wordsOk = actions.length === 0 || actions.every((a) =>
    row.mustMentionAny.some((word) => (a.line + a.label).includes(word)));
  const explicitAbstain = actions.length > 0 || row.allowClarification === true;
  const ok = matched && !forbidden && wordsOk && explicitAbstain;
  if (!ok) bad++;
  output.push({id:row.id, theme:row.expectedTheme, detected:intent?.theme || null,
    actionIds:actions.map((a) => a.id), actionLine:actions[0]?.line ?? '澄清：先问具体卡点',
    pass:ok});
}
const report = {cases:cases.length, themeMatches:matches, withAdvice, clarified:explicitlyClarified,
  coverage:withAdvice / cases.length, failures:bad, target:{matchesAtLeast:55, coverageAtLeast:0.70}};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--export-review')) {
  // Raters must see actual actions, not the expected theme or automated result.
  const seed = 20261119;
  const rank = (id) => [...id].reduce((n, c) => ((n * 33) + c.charCodeAt(0)) >>> 0, seed);
  const selected = [...output].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 24);
  const csv = (v) => `"${String(v ?? '').replaceAll('"','""')}"`;
  writeFileSync(resolve(root,'fixtures/action-fit-blind-review.csv'),
    ['id','card','suggestion','manualWrong_0_or_1','reviewerNote'].join(',')+'\n'+
    selected.map((item) => [item.id,cases.find((row) => row.id === item.id).text,
      item.actionLine,'',''].map(csv).join(',')).join('\n')+'\n','utf8');
}
if (matches < 55 || withAdvice / cases.length < 0.70 || bad) process.exitCode = 1;
