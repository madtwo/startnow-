#!/usr/bin/env node
/** Offline, synthetic-only review sheets. No API calls or automatic telemetry. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FIELDS = [
  'case_id', 'source', 'provenance', 'topic', 'card', 'actionId', 'actionLabel',
  'rejectedLine', 'reason', 'model', 'seed', 'reviewer_id', 'independent_confirmed',
  'same_action', 'grounded', 'one_step', 'safety', 'notes',
];
const stripBom = (text) => typeof text === 'string' && text.charCodeAt(0) === 0xfeff
  ? text.slice(1) : text;
const FACT_FIELDS = FIELDS.slice(0, 11);
const TOPICS = new Set(['study', 'people', 'love', 'family', 'self', 'future']);
const SAFE_CASE = /^eval-synth-[a-z0-9-]{1,48}$/u;
const SAFE_ID = /^[a-z0-9-]{2,80}$/u;
const SAFE_MODEL = /^[a-z0-9._:/-]{1,80}$/iu;
const SENSITIVE = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|(?:\+?86[-\s]?)?1[3-9]\d{9}|\b\d{17}[\dxX]\b|\b\d{12,19}\b|(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)[2-9]\d{2}[-.\s]?\d{4}|\b(?:\d{4}[- ]?){3}\d{4}\b|(?:19|20)\d{2}[-/.\u5e74]\d{1,2}|\b(?:sk|ghp|gho|github_pat|AIza)[-_a-z0-9]{12,}\b|\b(?:api[-_ ]?key|bearer|password|token)\s*[:=]|(?:\u5fae\u4fe1\u53f7|\u624b\u673a\u53f7|\u8eab\u4efd\u8bc1|\u8be6\u7ec6\u5730\u5740|\u94f6\u884c\u5361|\u5bc6\u7801|\u5b66\u53f7|\u5de5\u53f7)|@[a-z0-9_]{3,}|\u5927\u5b66|\u5b66\u9662|\u9644\u5c5e\u533b\u9662|\u5e02\d{1,4}\u53f7)/iu;

const safeText = (v, max) => typeof v === 'string' && v.length > 0 &&
  Array.from(v).length <= max && !/[\r\n\x00-\x1f\x7f]/u.test(v) && !SENSITIVE.test(v);
const invalid = (message) => { throw new Error(message); };

export function checkSample(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
      !SAFE_CASE.test(row.case_id) || !['rejected','negative'].includes(row.source) ||
      row.provenance !== 'synthetic_fixture' || !TOPICS.has(row.topic) ||
      !safeText(row.card, 240) || !SAFE_ID.test(row.actionId) ||
      !safeText(row.actionLabel, 100) || !safeText(row.rejectedLine, 90) ||
      row.reason !== 'no_anchor' || !SAFE_MODEL.test(row.model) || SENSITIVE.test(row.model) ||
      !(row.seed === null || Number.isSafeInteger(row.seed) && row.seed >= 0 && row.seed <= 2147483647)) {
    invalid('Invalid synthetic sample or sensitive-looking text; no sample content printed.');
  }
  return Object.fromEntries(FACT_FIELDS.map((field) => [field, row[field] === null ? '' : String(row[field])]));
}

function csvEscape(raw) {
  let text = String(raw);
  // Prevent CSV formula execution if a reviewer opens this in a spreadsheet.
  if (/^[\s]*[=+\-@\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
export const renderCsv = (rows) => [FIELDS.join(','),
  ...rows.map((row) => FIELDS.map((field) => csvEscape(row[field] ?? '')).join(','))].join('\n') + '\n';

/** RFC4180-style quoted parser, rejects malformed or duplicate headers. */
export function parseCsv(text) {
  text = stripBom(text);
  if (text.length > 5_000_000) invalid('Review CSV too large');
  const data = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === '"') {
      if (field || closed) invalid('Malformed CSV quote');
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = ''; closed = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; closed = false;
      if (row.some((v) => v !== '')) data.push(row);
      row = [];
    } else {
      if (closed) invalid('Malformed CSV after quote');
      field += ch;
    }
  }
  if (quoted) invalid('Unterminated CSV quote');
  if (field || row.length || closed) { row.push(field); data.push(row); }
  const headers = data.shift();
  if (!headers || headers.join('|') !== FIELDS.join('|')) invalid('Unexpected review columns');
  return data.map((fields) => {
    if (fields.length !== FIELDS.length) invalid('Invalid review column count');
    return Object.fromEntries(FIELDS.map((key,i) => [key, fields[i]]));
  });
}

export function readSamples(text) {
  text = stripBom(text);
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length === 0 || lines.length > 200) invalid('Need 1-200 synthetic JSONL samples');
  const keys = new Set();
  return lines.map((line) => {
    if (line.length > 7000) invalid('Sample record too large');
    let value;
    try { value = JSON.parse(line); } catch { invalid('Malformed synthetic JSONL'); }
    const checked = checkSample(value);
    if (keys.has(checked.case_id)) invalid('Duplicate synthetic case ID');
    keys.add(checked.case_id);
    return checked;
  });
}

export function evaluateReviewSheets(aText, bText) {
  const a = parseCsv(aText), b = parseCsv(bText);
  if (!a.length || a.length > 200 || a.length !== b.length) invalid('Review case counts mismatch');
  const IDs = new Set();
  const reviews = [a,b];
  const reviewers = [];
  for (const sheet of reviews) {
    const names = new Set();
    for (const row of sheet) {
      if (!SAFE_CASE.test(row.case_id) || !['rejected','negative'].includes(row.source) ||
          row.provenance !== 'synthetic_fixture' || !TOPICS.has(row.topic) ||
          !safeText(row.card,240) || !SAFE_ID.test(row.actionId) ||
          !safeText(row.actionLabel,100) || !safeText(row.rejectedLine,90) ||
          row.reason !== 'no_anchor' || !SAFE_MODEL.test(row.model) || SENSITIVE.test(row.model) ||
          !(row.seed === '' || /^\d{1,10}$/u.test(row.seed)) ||
          !/^[a-zA-Z0-9_-]{2,40}$/u.test(row.reviewer_id) ||
          row.independent_confirmed !== 'Y' ||
          !['same_action','grounded','one_step','safety'].every((field) => ['Y','N'].includes(row[field])) ||
          !safeText(row.notes,240)) invalid('Missing/invalid independent reviewer declaration, score, or note');
      names.add(row.reviewer_id);
    }
    if (names.size !== 1) invalid('Each sheet must be from one independent reviewer');
    reviewers.push([...names][0]);
  }
  if (reviewers[0] === reviewers[1]) invalid('The two reviewer identities must differ');
  const sameFacts = (one,two) => FACT_FIELDS.every((field) => one[field] === two[field]);
  let candidate = 0, disagreements = 0, negativeEscapes = 0, negativeTotal = 0, rejected = 0;
  let safeDisagreements = 0;
  const detail = [];
  for (let i = 0; i < a.length; i++) {
    const one = a[i], two = b[i];
    if (!sameFacts(one,two) || IDs.has(one.case_id)) invalid('Review sheets differ or contain duplicate IDs');
    IDs.add(one.case_id);
    const bothAllYes = [one,two].every((r) => ['same_action','grounded','one_step','safety'].every((field) => r[field] === 'Y'));
    const conflict = ['same_action','grounded','one_step','safety'].some((field) => one[field] !== two[field]);
    if (conflict) disagreements++;
    if (one.safety !== two.safety) safeDisagreements++;
    if (one.source === 'negative') {
      negativeTotal++;
      if (bothAllYes) negativeEscapes++;
    } else {
      rejected++;
      if (bothAllYes) candidate++;
    }
    detail.push({ case_id: one.case_id, source: one.source,
      verdict: bothAllYes ? 'unanimous_candidate' : conflict ? 'disagreement' : 'keep_rejected' });
  }
  const ready = rejected >= 10 && negativeTotal >= 2 &&
    negativeEscapes === 0 && safeDisagreements === 0 && disagreements === 0;
  const summary = { reviewed: a.length, rejected, negativeTotal, candidate,
    disagreements, safeDisagreements, negativeEscapes, ready_for_consideration: ready,
    // Deliberately not a rollout/quality gate. A human must approve each alias.
    change_validator_automatically: false, detail };
  return summary;
}

/** Pin both reviewer sheets to an independently retained source JSONL.
 * The source digest must be copied from the original receipt, not computed from
 * the possibly edited review folder. This does NOT prove reviewer independence.
 */
export function evaluateReviewSheetsAgainstSource(
  sampleText, aText, bText, expectedSha256,
) {
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    invalid('A trusted SHA256 of the original synthetic JSONL is mandatory');
  }
  const digest = createHash('sha256').update(sampleText, 'utf8').digest('hex');
  if (digest !== expectedSha256) invalid('Original synthetic source SHA256 does not match');
  const samples = readSamples(sampleText);
  const a = parseCsv(aText), b = parseCsv(bText);
  if (a.length !== samples.length || b.length !== samples.length) {
    invalid('Review sheet case counts do not match the original synthetic source');
  }
  const matches = (row, expected) => FACT_FIELDS.every((field) => row[field] === expected[field]);
  for (let i = 0; i < samples.length; i++) {
    if (!matches(a[i], samples[i]) || !matches(b[i], samples[i])) {
      invalid('Review sheet facts differ from original synthetic source or case order');
    }
  }
  return { ...evaluateReviewSheets(aText, bText), source_sha256: digest };
}

export function reportMarkdown(result) {
  const { reviewed,rejected,negativeTotal,candidate,disagreements,safeDisagreements,negativeEscapes } = result;
  const stats = [
    '# Synthetic advice anchor review (local only)', '',
    `- Total synthetic cases: ${reviewed}`,
    `- Rejected-model cases: ${rejected}`,
    `- Negative controls: ${negativeTotal}`,
    `- Unanimous potential false rejections: ${candidate}`,
    `- Review disagreements: ${disagreements}`,
    `- Safety disagreements: ${safeDisagreements}`,
    `- Negative controls incorrectly accepted by both: ${negativeEscapes}`,
    `- Evidence status: ${result.ready_for_consideration ? 'READY FOR HUMAN CONSIDERATION' : 'INSUFFICIENT / DISAGREED'}`,
    '- Automatic acceptance or online threshold change: NEVER', '',
    '| Synthetic case | Source | Consensus |', '| --- | --- | --- |',
    ...result.detail.map((row) => `| ${row.case_id} | ${row.source} | ${row.verdict} |`),
    '', 'No raw rejected lines are reproduced in this report.', '',
  ];
  return stats.join('\n');
}

function writeNewFile(filename, contents) {
  fs.writeFileSync(filename, contents, {flag:'wx',mode:0o600});
}
export function runCli(args) {
  const [command, first, second, third] = args;
  if (command === 'prepare' && first && second && !third) {
    const samples = readSamples(fs.readFileSync(first, 'utf8'));
    const folder = path.resolve(second);
    fs.mkdirSync(folder,{recursive:true});
    const rows = samples.map((x) => ({...x,reviewer_id:'',independent_confirmed:'',
      same_action:'',grounded:'',one_step:'',safety:'',notes:''}));
    const prepared = renderCsv(rows);
    // Exclusive mode: never silently overwrite reviewer edits.
    for (const target of ['reviewer-a.csv','reviewer-b.csv']) {
      if (fs.existsSync(path.join(folder,target))) invalid('Review template already exists');
    }
    writeNewFile(path.join(folder,'reviewer-a.csv'),'\uFEFF'+prepared);
    writeNewFile(path.join(folder,'reviewer-b.csv'),'\uFEFF'+prepared);
    return 'Two independent review templates created; fill both and run score.';
  }
  if (command === 'score-locked' && args.length === 6 && args.slice(1).every(Boolean)) {
    const [, samplePath, sheetA, sheetB, reportPath, expectedSha256] = args;
    const result = evaluateReviewSheetsAgainstSource(
      fs.readFileSync(samplePath, 'utf8'), fs.readFileSync(sheetA, 'utf8'),
      fs.readFileSync(sheetB, 'utf8'), expectedSha256,
    );
    writeNewFile(reportPath, reportMarkdown(result) +
      `\nOriginal source SHA256: ${result.source_sha256}\nSource: VERIFIED against supplied digest.\n`);
    return `Source-locked review: ${result.reviewed} synthetic cases; validator unchanged.`;
  }
  if (command === 'score' && first && second && third && args.length === 4) {
    const report = evaluateReviewSheets(fs.readFileSync(first,'utf8'),fs.readFileSync(second,'utf8'));
    writeNewFile(third, reportMarkdown(report) + '\nSource: NOT VERIFIED. Use score-locked before release review.\n');
    return `Reviewed ${report.reviewed} synthetic cases; WARNING: unpinned source, use score-locked.`;
  }
  invalid('Usage: prepare <samples.jsonl> <folder> OR score-locked <samples.jsonl> <reviewer-a.csv> <reviewer-b.csv> <report.md> <trusted-sha256> (legacy: score <a.csv> <b.csv> <report.md> is unverified)');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(runCli(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Review tool failed'); process.exitCode = 1; }
}
