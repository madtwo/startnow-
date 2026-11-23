#!/usr/bin/env node
/**
 * Human-friendly bridge for the synthetic anchor review.
 * Teammates fill Chinese CSV columns; this maps them back to the strict
 * source-locked reviewer format. No API calls or storage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readSamples, renderCsv, evaluateReviewSheetsAgainstSource, reportMarkdown,
} from './advice-anchor-review.mjs';

const FRIENDLY_FIELDS = [
  '编号', '卡片', '要做的事', 'AI建议',
  '还在做这件事?', '用上卡片细节?', '只让做一件小事?', '安全吗?',
  '备注', '评审人', '独立确认',
];
const stripBom = (text) => typeof text === 'string' && text.charCodeAt(0) === 0xfeff
  ? text.slice(1) : text;
const invalid = (message) => { throw new Error(message); };
const csvEscape = (raw) => {
  let text = String(raw ?? '');
  if (/^[\s]*[=+\-@\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
const renderFriendly = (rows) => [FRIENDLY_FIELDS.join(','),
  ...rows.map((row) => FRIENDLY_FIELDS.map((field) => csvEscape(row[field])).join(','))].join('\n') + '\n';

export function parseFriendlyCsv(text) {
  text = stripBom(text);
  if (text.length > 2_000_000) invalid('评审表过大');
  const data = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else field += ch;
    } else if (ch === '"') {
      if (field || closed) invalid('CSV 引号格式不正确');
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = ''; closed = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; closed = false;
      if (row.some((value) => value !== '')) data.push(row);
      row = [];
    } else {
      if (closed) invalid('CSV 引号后出现多余字符');
      field += ch;
    }
  }
  if (quoted) invalid('CSV 引号未闭合');
  if (field || row.length || closed) { row.push(field); data.push(row); }
  const headers = data.shift();
  if (!headers || headers.join('|') !== FRIENDLY_FIELDS.join('|')) invalid('评审表列名不符');
  return data.map((fields) => {
    if (fields.length !== FRIENDLY_FIELDS.length) invalid('评审表列数不符');
    return Object.fromEntries(FRIENDLY_FIELDS.map((key, i) => [key, fields[i]]));
  });
}

const readYn = (value, field, rowNo) => {
  const text = String(value ?? '').trim();
  if (/^(?:y|yes|t|true|是|对|✓)$/iu.test(text)) return 'Y';
  if (/^(?:n|no|f|false|否|不对|×)$/iu.test(text)) return 'N';
  invalid(`第 ${rowNo} 行「${field}」只能填 Y/N`);
};

export function prepareFriendlyCsv(sourceText) {
  const samples = readSamples(sourceText);
  const rows = samples.map((sample, index) => ({
    '编号': `C${String(index + 1).padStart(2, '0')}`,
    '卡片': sample.card,
    '要做的事': sample.actionLabel,
    'AI建议': sample.rejectedLine,
    '还在做这件事?': '', '用上卡片细节?': '', '只让做一件小事?': '', '安全吗?': '',
    '备注': '', '评审人': '', '独立确认': '',
  }));
  return '\uFEFF' + renderFriendly(rows);
}

export function buildStandardCsv(sourceText, friendlyText) {
  const samples = readSamples(sourceText);
  const rows = parseFriendlyCsv(friendlyText);
  if (rows.length !== samples.length) invalid('评审行数与源文件不一致');
  const seen = new Set();
  const standard = rows.map((row, rowIndex) => {
    const rowNo = rowIndex + 1;
    const match = /^C(\d{2})$/u.exec(String(row['编号']).trim());
    if (!match) invalid(`第 ${rowNo} 行编号必须形如 C01`);
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= samples.length || seen.has(index)) invalid(`第 ${rowNo} 行编号重复或越界`);
    seen.add(index);
    const sample = samples[index];
    if (row['卡片'] !== sample.card || row['要做的事'] !== sample.actionLabel ||
        row['AI建议'] !== sample.rejectedLine) {
      invalid(`第 ${rowNo} 行题目被修改；不要改前四列`);
    }
    const reviewer = String(row['评审人'] ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{2,40}$/u.test(reviewer)) {
      invalid(`第 ${rowNo} 行「评审人」请用英文/拼音/编号，2-40 字符`);
    }
    const confirmed = String(row['独立确认'] ?? '').trim();
    if (!/^(?:y|yes|t|true|是|对|✓)$/iu.test(confirmed)) {
      invalid(`第 ${rowNo} 行「独立确认」必须填 是/Y`);
    }
    const notes = String(row['备注'] ?? '').trim();
    if (!notes || Array.from(notes).length > 240) {
      invalid(`第 ${rowNo} 行「备注」必填，最多 240 字`);
    }
    return {
      ...sample,
      reviewer_id: reviewer,
      independent_confirmed: 'Y',
      same_action: readYn(row['还在做这件事?'], '还在做这件事?', rowNo),
      grounded: readYn(row['用上卡片细节?'], '用上卡片细节?', rowNo),
      one_step: readYn(row['只让做一件小事?'], '只让做一件小事?', rowNo),
      safety: readYn(row['安全吗?'], '安全吗?', rowNo),
      notes,
    };
  });
  if (seen.size !== samples.length) invalid('评审表缺少行');
  return renderCsv(standard);
}

export function scoreFriendly(sourceText, aText, bText, expectedSha256) {
  const a = buildStandardCsv(sourceText, aText);
  const b = buildStandardCsv(sourceText, bText);
  return evaluateReviewSheetsAgainstSource(sourceText, a, b, expectedSha256);
}

export function runCli(args) {
  const [command, first, second, third, fourth, fifth] = args;
  if (command === 'prepare' && first && second && !third) {
    const folder = path.resolve(second);
    fs.mkdirSync(folder, { recursive: true });
    const content = prepareFriendlyCsv(fs.readFileSync(first, 'utf8'));
    const names = ['human-A.csv', 'human-B.csv', 'human-C.csv', 'ai-A.csv', 'ai-B.csv'];
    for (const name of names) {
      const target = path.join(folder, name);
      if (fs.existsSync(target)) invalid(`文件已存在，先移走：${target}`);
      fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
    }
    return '已生成 5 份：human-A/B/C（人工）和 ai-A/B（其他 AI），均带 BOM。';
  }
  if (command === 'score' && args.length === 6) {
    const [, sourcePath, aPath, bPath, reportPath, sha] = args;
    const sourceText = fs.readFileSync(sourcePath, 'utf8');
    const result = scoreFriendly(
      sourceText, fs.readFileSync(aPath, 'utf8'), fs.readFileSync(bPath, 'utf8'), sha,
    );
    fs.writeFileSync(reportPath, reportMarkdown(result) +
      `\nOriginal source SHA256: ${result.source_sha256}\nSource: VERIFIED against supplied digest.\n`);
    return `已评分 ${result.reviewed} 条；validator 未改变。`;
  }
  invalid('用法：prepare <源.jsonl> <目录> 或 score <源.jsonl> <A.csv> <B.csv> <report.md> <源SHA256>');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(runCli(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.message : '评审工具失败'); process.exitCode = 1; }
}
