import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSamples, parseCsv } from '../scripts/advice-anchor-review.mjs';
import {
  prepareFriendlyCsv, parseFriendlyCsv, buildStandardCsv, scoreFriendly, runCli,
} from '../scripts/advice-anchor-friendly-csv.mjs';

const sourcePath = new URL('./fixtures/advice-anchor-v12-report.jsonl', import.meta.url);
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const samples = readSamples(sourceText);
const sha = createHash('sha256').update(sourceText, 'utf8').digest('hex');

const fill = (reviewer, index) => samples.map((sample, i) => ({
  '编号': `C${String(i + 1).padStart(2, '0')}`,
  '卡片': sample.card,
  '要做的事': sample.actionLabel,
  'AI建议': sample.rejectedLine,
  '还在做这件事?': sample.source === 'rejected' ? '是' : '否',
  '用上卡片细节?': '是',
  '只让做一件小事?': '是',
  '安全吗?': '是',
  '备注': index === 0 ? '人工核对：动作和场景都一致' : `人工核对第 ${i + 1} 条`,
  '评审人': reviewer,
  '独立确认': '是',
}));

test('friendly CSV is five-column context + seven fill columns with BOM', () => {
  const csv = prepareFriendlyCsv(sourceText);
  assert.ok(csv.startsWith('\uFEFF'));
  const rows = parseFriendlyCsv(csv);
  assert.equal(rows.length, 6);
  assert.deepEqual(Object.keys(rows[0]), [
    '编号', '卡片', '要做的事', 'AI建议', '还在做这件事?', '用上卡片细节?', '只让做一件小事?', '安全吗?', '备注', '评审人', '独立确认',
  ]);
  assert.equal(rows[0]['卡片'], samples[0].card);
});

test('prepare creates five independent blank copies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friendly-prepare-'));
  try {
    const folder = path.join(dir, 'forms');
    const message = runCli(['prepare', fileURLToPath(sourcePath), folder]);
    assert.match(message, /5 份/u);
    for (const name of ['human-A.csv', 'human-B.csv', 'human-C.csv', 'ai-A.csv', 'ai-B.csv']) {
      const bytes = fs.readFileSync(path.join(folder, name));
      assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), name);
      assert.equal(parseFriendlyCsv(bytes.toString('utf8')).length, 6);
    }
    assert.throws(() => runCli(['prepare', fileURLToPath(sourcePath), folder]), /已存在/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('friendly answers map back to the strict source-locked rows', () => {
  const a = fill('human_A', 0);
  const b = fill('human_B', 1);
  const standard = buildStandardCsv(sourceText, renderFriendlyForTest(a));
  assert.equal(parseCsv(standard).length, samples.length);
  const result = scoreFriendly(
    sourceText,
    renderFriendlyForTest(a),
    renderFriendlyForTest(b),
    sha,
  );
  assert.equal(result.reviewed, samples.length);
  assert.equal(result.rejected, 2);
  assert.equal(result.negativeTotal, 4);
  assert.equal(result.negativeEscapes, 0);
  assert.equal(result.disagreements, 0);
  assert.equal(result.ready_for_consideration, false);
  assert.equal(result.change_validator_automatically, false);
});

test('T/F is accepted like Y/N', () => {
  const rows = fill('human_A', 0).map((row) => ({ ...row, '还在做这件事?': 'T', '用上卡片细节?': 'T', '只让做一件小事?': 'T', '安全吗?': 'T', '独立确认': 'T' }));
  const standard = buildStandardCsv(sourceText, renderFriendlyForTest(rows));
  assert.equal(parseCsv(standard).length, samples.length);
  assert.equal(parseCsv(standard)[0].same_action, 'Y');
});

test('modified context, blank notes, and invalid reviewer fail closed', () => {
  const template = prepareFriendlyCsv(sourceText);
  const rows = parseFriendlyCsv(template);
  rows[0]['卡片'] = '被改过的题目';
  assert.throws(() => buildStandardCsv(sourceText, renderFriendlyForTest(rows)), /前四列|题目/u);
  const blank = fill('human_A', 0);
  blank[0]['备注'] = '';
  assert.throws(() => buildStandardCsv(sourceText, renderFriendlyForTest(blank)), /备注/u);
  const bad = fill('human_A', 0);
  bad[0]['评审人'] = '队友甲';
  assert.throws(() => buildStandardCsv(sourceText, renderFriendlyForTest(bad)), /评审人/u);
});

// Test-only writer: mirrors the friendly columns without exporting another
// mutation surface from the CLI.
function renderFriendlyForTest(rows) {
  const fields = ['编号','卡片','要做的事','AI建议','还在做这件事?','用上卡片细节?','只让做一件小事?','安全吗?','备注','评审人','独立确认'];
  const esc = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return '\uFEFF' + [fields.join(','), ...rows.map((row) => fields.map((field) => esc(row[field])).join(','))].join('\n') + '\n';
}
