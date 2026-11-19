#!/usr/bin/env node
/**
 * R3 blind-review workflow; intentionally does NOT ask an AI to mark answers.
 * Usage:
 *   node scripts/round3-blind-review.mjs prepare review-extract.csv review-blind.csv
 *   node scripts/round3-blind-review.mjs validate review-scored.csv report.json
 *
 * Preparation always strips expectedTheme/topic/action-route columns. The
 * case-ID mapping is written to <blind.csv>.mapping.csv for the organizer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function csvParse(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') {
      if (cell !== '') throw new Error(`CSV 引号位置非法：字符 ${i}`);
      quoted = true;
    } else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
      row = []; cell = '';
      if (c === '\r' && text[i+1] === '\n') i++;
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 存在未闭合引号');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (!rows.length) throw new Error('CSV 为空');
  const header = rows.shift().map((v) => v.trim());
  if (!header.every(Boolean) || new Set(header).size !== header.length) throw new Error('CSV 列名不合法/重复');
  return rows.map((cols, i) => {
    if (cols.length !== header.length) throw new Error(`CSV 第 ${i+2} 行列数不一致：${cols.length} != ${header.length}`);
    return Object.fromEntries(header.map((key, j) => [key, cols[j]]));
  });
}
export function csvDump(rows, headers) {
  const enc = (s) => {
    s = String(s ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))].map((cols) => cols.map(enc).join(',')).join('\r\n') + '\r\n';
}
const first = (row, candidates) => {
  for (const column of candidates) if (row[column] != null && row[column].trim()) return row[column];
  return '';
};
const cardColumns = ['card','card_text','cardText','card_body','cardBody','卡面','帖子正文','post_text'];
const adviceColumns = ['advice','advice_text','suggestion','displayed_advice','displayed_suggestion','recommendation','建议','实际建议'];
const idColumns = ['case_id','caseId','id','cardId','card_id','sample_id'];

export function prepareReview(input) {
  const data = csvParse(input);
  if (data.length !== 24) throw new Error(`需要从同一次真实运行抽取 24 条，现有 ${data.length} 条`);
  const mapping = [], blind = [];
  const ids = new Set();
  data.forEach((item, i) => {
    const card = first(item, cardColumns), advice = first(item, adviceColumns);
    if (!card || !advice) throw new Error(`第 ${i+1} 条缺少卡面或实际显示建议；CSV 列名需可识别`);
    const originalId = first(item, idColumns) || `source-row-${i+1}`;
    if (ids.has(originalId)) throw new Error(`重复样本 ID：${originalId}`);
    ids.add(originalId);
    const case_id = String(i+1).padStart(2, '0');
    mapping.push({ case_id, original_id: originalId });
    blind.push({ case_id, card, advice, score_0_or_1:'', reason:'', reviewer_id:'', independent:'', disagree:'' });
  });
  return { blind, mapping };
}

export function validateReview(input) {
  const data = csvParse(input);
  const byCase = new Map(), reviewerCoverage = new Map(), findings = [];
  for (const [i, row] of data.entries()) {
    const caseId=row.case_id?.trim(), score=row.score_0_or_1?.trim(), reviewer=row.reviewer_id?.trim();
    if (!/^\d{2}$/.test(caseId ?? '') || Number(caseId)<1 || Number(caseId)>24) throw new Error(`第 ${i+1} 条缺少 01–24 case_id`);
    if (!row.card?.trim() || !row.advice?.trim()) throw new Error(`${caseId} 无卡面/建议`);
    if (score !== '0' && score !== '1') throw new Error(`${caseId} 缺少真实的 0/1 评分`);
    if (!row.reason?.trim()) throw new Error(`${caseId} 缺少评分理由`);
    if (!reviewer) throw new Error(`${caseId} 缺少 reviewer_id`);
    if (!['yes','no'].includes(row.independent?.trim())) throw new Error(`${caseId} independent 必须是 yes/no`);
    const entry={caseId,score:Number(score),reviewer,independent:row.independent.trim()==='yes',disagree:row.disagree?.trim()==='yes'};
    if (!byCase.has(caseId)) byCase.set(caseId,[]);
    const candidates=byCase.get(caseId);
    if (candidates.some((x)=>x.reviewer===reviewer)) throw new Error(`${caseId} 同评审者重复评分`);
    if (candidates.length && (candidates[0].card!==row.card || candidates[0].advice!==row.advice))
      throw new Error(`${caseId} 不同评审看到的卡面/建议不一致`);
    candidates.push({...entry,card:row.card,advice:row.advice});
    if (entry.independent) {
      if (!reviewerCoverage.has(reviewer)) reviewerCoverage.set(reviewer,new Set());
      reviewerCoverage.get(reviewer).add(caseId);
    }
  }
  if (byCase.size!==24 || [...Array(24)].some((_,i)=>!byCase.has(String(i+1).padStart(2,'0'))))
    throw new Error(`需要 24 个唯一案例；当前 ${byCase.size}`);
  const independentReviewers=[...reviewerCoverage].filter(([,ids])=>ids.size===24).map(([name])=>name);
  if (!independentReviewers.length) throw new Error('必须至少有 1 名声明未参与实现的评审完成全部 24 条');
  for (const [caseId, rows] of byCase) {
    const scoreSet=new Set(rows.map((r)=>r.score));
    if (scoreSet.size>1 && !rows.some((r)=>r.disagree)) throw new Error(`${caseId} 存在分歧但未标 disagree=yes`);
    if (rows.some((r)=>r.score===1)) findings.push(caseId);
  }
  return {
    cases:24,
    ratings:data.length,
    independentReviewers,
    badCases:findings,
    badCount:findings.length,
    disagreeCases:[...byCase].filter(([,r])=>new Set(r.map((x)=>x.score)).size>1).map(([id])=>id),
    pass: findings.length <= 1,
    note:'独立性来自评审者声明，需由项目负责人核实；本工具不执行 AI 评审。',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [command,inputFile,outputFile] = process.argv.slice(2);
  try {
    if (!inputFile || !outputFile || !['prepare','validate'].includes(command)) {
      console.error('Usage: node scripts/round3-blind-review.mjs prepare <extract.csv> <blind.csv>\n       node scripts/round3-blind-review.mjs validate <scored.csv> <report.json>');
      process.exitCode=2;
    } else if (command==='prepare') {
      const {blind,mapping}=prepareReview(fs.readFileSync(inputFile,'utf8'));
      fs.writeFileSync(outputFile,csvDump(blind,['case_id','card','advice','score_0_or_1','reason','reviewer_id','independent','disagree']));
      fs.writeFileSync(`${outputFile}.mapping.csv`,csvDump(mapping,['case_id','original_id']));
      console.log(`已生成 24 条盲评表：${outputFile}\n映射表：${outputFile}.mapping.csv（仅组织者保管）`);
    } else {
      const report=validateReview(fs.readFileSync(inputFile,'utf8'));
      fs.writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n');
      console.log(`独立盲评 ${report.badCount}/24 不贴合；验收 ${report.pass?'达到数量门槛':'不通过，需要按卡面→动作族归因并重跑'}`);
      if (!report.pass) process.exitCode=3;
    }
  } catch (err) { console.error(`失败：${err.message}`); process.exitCode=2; }
}
