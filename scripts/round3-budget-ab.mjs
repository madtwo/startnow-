#!/usr/bin/env node
/**
 * R5 evidence-based budget A/B calculator.
 * This command refuses to call the comparison 'passed' if a required
 * metric cannot be read from *real* per-call JSONL data.
 *
 * Example: node scripts/round3-budget-ab.mjs old-calls.jsonl new-calls.jsonl field-map.json BUDGET-AB.md
 * `field-map.json` explicitly maps your harness' real JSONL columns:
 * {
 *   "chainId": "chainId", "seed": "seed", "costUsd": "costUsd",
 *   "chainDurationMs": "chainDurationMs", "visibleChars": "visibleChars",
 *   "isNonFault": "isNonFault", "emptyBody": "emptyBody",
 *   "completionEligible": "completionEligible", "completionAccepted": "completionAccepted"
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const getField = (record, key) => {
  if (!key) return undefined;
  return key.split('.').reduce((object, part) => object?.[part], record);
};
const numeric = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
const bool = (v) => v===true || v===1 || v==='true' ? true : v===false || v===0 || v==='false' ? false : null;
const quantile = (data,p) => {
  const ordered=[...data].sort((a,b)=>a-b);
  if (!ordered.length) return null;
  const x=(ordered.length-1)*p;
  return ordered[Math.floor(x)]*(1-(x%1))+ordered[Math.ceil(x)]*(x%1);
};
const mean = (a) => a?.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
const fmt=(n,digits=3)=>n===null||n===undefined ? '未验证（数据缺失）' : n.toFixed(digits);

export function parseCalls(text) {
  const parsed=[];
  text.split(/\r?\n/).forEach((line,i)=>{
    if (!line.trim()) return;
    let entry;
    try{entry=JSON.parse(line);}catch{throw Error(`JSONL 第 ${i+1} 行不是合法 JSON`);}
    if (!entry || typeof entry!=='object' || Array.isArray(entry)) throw Error(`JSONL 第 ${i+1} 行必须是对象`);
    parsed.push(entry);
  });
  if (!parsed.length) throw Error('真实调用日志为空');
  return parsed;
}

export function summarizeCalls(records, map) {
  const groups=new Map(), seeds=new Set(), errors=[];
  const nonfault=[], completions=[], chars=[];
  let nonFaultComplete=true, completionComplete=true, seedComplete=true;
  for(const [i,rec] of records.entries()) {
    const chainId=getField(rec,map.chainId);
    if (chainId===undefined || chainId===null || String(chainId).trim()==='') {
      errors.push(`第 ${i+1} 条缺少 chainId`); continue;
    }
    const key=String(chainId);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(rec);
    const seed=getField(rec,map.seed);
    if(seed!==undefined && seed!==null && String(seed).trim()!=='') seeds.add(String(seed));
    else seedComplete=false;
    const nonFault=bool(getField(rec,map.isNonFault)), emptyBody=bool(getField(rec,map.emptyBody));
    if (nonFault===true && emptyBody!==null) nonfault.push(emptyBody);
    if (nonFault===null || (nonFault===true && emptyBody===null)) nonFaultComplete=false;
    const eligible=bool(getField(rec,map.completionEligible)), accepted=bool(getField(rec,map.completionAccepted));
    if (eligible===true && accepted!==null) completions.push(accepted);
    if (eligible===null || (eligible===true && accepted===null)) completionComplete=false;
    const visibleChars=numeric(getField(rec,map.visibleChars));
    if(visibleChars!==null) chars.push(visibleChars);
  }
  const costs=[],durations=[];
  let allCosts=true, allDurations=true;
  for(const chain of groups.values()) {
    const parsedCosts=chain.map((r)=>numeric(getField(r,map.costUsd)));
    if (parsedCosts.some((x)=>x===null||x<0)) allCosts=false;
    else costs.push(parsedCosts.reduce((a,b)=>a+b,0));
    const observed=chain.map((r)=>numeric(getField(r,map.chainDurationMs))).filter((x)=>x!==null);
    // A chain duration is one overall latency measurement, not sum of call latencies.
    if (!observed.length || observed.some((x)=>x!==observed[0] || x<0)) allDurations=false;
    else durations.push(observed[0]);
  }
  if(seeds.size>1) errors.push('单轮日志混入了多个 seed');
  return {
    chains:groups.size, calls:records.length, seed:seedComplete&&seeds.size===1?[...seeds][0]:null,
    costPerChain:allCosts ? mean(costs) : null,
    p50ms:allDurations ? quantile(durations,.50) : null,
    p95ms:allDurations ? quantile(durations,.95) : null,
    nonFaultEmptyRate:nonFaultComplete&&nonfault.length ? nonfault.filter(Boolean).length/nonfault.length:null,
    completionAdoptionRate:completionComplete&&completions.length ? completions.filter(Boolean).length/completions.length:null,
    avgVisibleChars:chars.length===records.length ? mean(chars):null,
    errors,
  };
}

export function compareBudget(oldRun,newRun,oldReview=null,newReview=null) {
  const checks=[
    {label:'平均成本/链 ≤$0.004', metric:'costPerChain', triggered:newRun.costPerChain!==null && newRun.costPerChain>.004, known:newRun.costPerChain!==null},
    {label:'P95 ≤8s', metric:'p95ms', triggered:newRun.p95ms!==null && newRun.p95ms>8000, known:newRun.p95ms!==null},
    {label:'非故障空正文 ≤1%', metric:'nonFaultEmptyRate', triggered:newRun.nonFaultEmptyRate!==null && newRun.nonFaultEmptyRate>.01, known:newRun.nonFaultEmptyRate!==null},
    {label:'完成采纳下降 ≤5个百分点', metric:'completionAdoptionRate', triggered:newRun.completionAdoptionRate!==null && oldRun.completionAdoptionRate!==null && oldRun.completionAdoptionRate-newRun.completionAdoptionRate>.05, known:newRun.completionAdoptionRate!==null && oldRun.completionAdoptionRate!==null},
    {label:'独立盲评错配不升', metric:'blindReview', triggered:oldReview?.badCount!==undefined && newReview?.badCount!==undefined && newReview.badCount>oldReview.badCount, known:oldReview?.badCount!==undefined && newReview?.badCount!==undefined},
  ];
  const sameSeed=oldRun.seed!==null && newRun.seed!==null && oldRun.seed===newRun.seed;
  const enough=oldRun.chains>=20 && newRun.chains>=20;
  const allKnown=checks.every((x)=>x.known) && oldRun.p50ms!==null && newRun.p50ms!==null && oldRun.avgVisibleChars!==null && newRun.avgVisibleChars!==null;
  const anyRollback=checks.some((x)=>x.triggered);
  return {checks,sameSeed,enough,allKnown,anyRollback,
    status:anyRollback?'触发回滚阈值':sameSeed && enough && allKnown && !oldRun.errors.length && !newRun.errors.length?'指标门槛通过（仍需浏览器与盲评证据）':'证据不齐，不能判定通过'};
}

export function renderBudgetReport(oldRun,newRun,comparison,oldPath,newPath) {
  const row=(label,a,b,suffix='')=>`| ${label} | ${fmt(a)}${a!==null?suffix:''} | ${fmt(b)}${b!==null?suffix:''} |`;
  return `# 第三轮预算 A/B（脚本生成，实际运行才有数值）\n\n`+
  `数据来源（每调用 JSONL）：\n\n- 旧：\`${oldPath}\`\n- 新：\`${newPath}\`\n\n`+
  `同 seed：**${comparison.sameSeed?'是':'未证实'}**；至少 20 链/轮：**${comparison.enough?'是':'否'}**。\n\n`+
  `| 指标 | 旧预算 | 新预算 |\n|---|---:|---:|\n`+
  row('链数',oldRun.chains,newRun.chains)+ '\n'+
  row('调用数',oldRun.calls,newRun.calls)+'\n'+
  row('成本/链（USD）',oldRun.costPerChain,newRun.costPerChain)+'\n'+
  row('完整流 P50（ms）',oldRun.p50ms,newRun.p50ms)+'\n'+
  row('完整流 P95（ms）',oldRun.p95ms,newRun.p95ms)+'\n'+
  row('非故障空正文率',oldRun.nonFaultEmptyRate,newRun.nonFaultEmptyRate)+'\n'+
  row('完成采纳率',oldRun.completionAdoptionRate,newRun.completionAdoptionRate)+'\n'+
  row('平均可见字数',oldRun.avgVisibleChars,newRun.avgVisibleChars)+'\n\n'+
  `## 回滚阈值\n\n${comparison.checks.map((x)=>`- ${x.label}：${!x.known?'未验证':x.triggered?'**触发**':'未触发'}`).join('\n')}\n\n`+
  `**结论：${comparison.status}。**\n\n`+
  `说明：脚本不会从调用耗时推算完整链耗时，也不会用 AI 初评充当独立盲评。重复率与主题路由需要从论坛实际卡片/建议统计另附证据。\n`;
}

if(process.argv[1] && path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))) {
  const [oldFile,newFile,mapFile,outFile,oldReviewFile,newReviewFile]=process.argv.slice(2);
  if(!oldFile||!newFile||!mapFile||!outFile){console.error('Usage: node scripts/round3-budget-ab.mjs old-calls.jsonl new-calls.jsonl field-map.json BUDGET-AB.md [old-independent-review.json new-independent-review.json]');process.exitCode=2;}
  else try{
    const map=JSON.parse(fs.readFileSync(mapFile,'utf8'));
    const oldRun=summarizeCalls(parseCalls(fs.readFileSync(oldFile,'utf8')),map);
    const newRun=summarizeCalls(parseCalls(fs.readFileSync(newFile,'utf8')),map);
    const loadReview = (filename) => {
      if (!filename) return null;
      const report=JSON.parse(fs.readFileSync(filename,'utf8'));
      if (report.cases!==24 || !Array.isArray(report.independentReviewers) ||
          !report.independentReviewers.length || !Number.isInteger(report.badCount) ||
          report.badCount<0 || report.badCount>24) throw new Error(`独立盲评报告无效：${filename}`);
      return report;
    };
    const comparison=compareBudget(oldRun,newRun,loadReview(oldReviewFile),loadReview(newReviewFile));
    fs.writeFileSync(outFile,renderBudgetReport(oldRun,newRun,comparison,oldFile,newFile));
    console.log(`${comparison.status}；报告：${outFile}`);
    if(comparison.anyRollback)process.exitCode=3;
    else if(!comparison.sameSeed||!comparison.enough||!comparison.allKnown||oldRun.errors.length||newRun.errors.length)process.exitCode=4;
  }catch(err){console.error(`失败：${err.message}`);process.exitCode=2;}
}
