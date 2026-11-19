#!/usr/bin/env node
// Real-API D4 gate: ONLY metadata. Never save screenshots, OCR, prompts, API keys or replies.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'fixtures/tech-material-cases.json'),'utf8'));
const list=new Map(fixture.map(x=>[x.id,x]));
const input=process.argv[2];
if(!input){console.error('用法：node scripts/verify-material-d4.mjs acceptance/real-d4.jsonl');process.exit(2);}
const text=fs.readFileSync(input,'utf8');
const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
let failures=[];
let records=[];
for(let i=0;i<lines.length;i++){
  try{
    const r=JSON.parse(lines[i]);
    const allowed=['id','source','anchored','actionable5m','latencyMs','costUsd','fallback','requestCount'];
    const extra=Object.keys(r).filter(k=>!allowed.includes(k));
    if(extra.length)failures.push(`第 ${i+1} 行包含未经允许的字段 ${extra.join(',')}`);
    if(r.source!=='real-api')failures.push(`${r.id||i}: 非真实 API 来源`);
    if(!list.has(r.id))failures.push(`未登记的样例 ${r.id}`);
    if(typeof r.anchored!=='boolean'||typeof r.actionable5m!=='boolean'||typeof r.fallback!=='boolean' ||
      !Number.isFinite(r.latencyMs)||r.latencyMs<0||!Number.isFinite(r.costUsd)||r.costUsd<0 ||
      !Number.isInteger(r.requestCount)||r.requestCount<1||r.requestCount>4)
      failures.push(`${r.id||i}: 缺少真实核对或调用测量`);
    records.push(r);
  }catch{failures.push(`第 ${i+1} 行不是合法 JSON`);}
}
const counts=new Map();
for(const r of records)counts.set(r.id,(counts.get(r.id)||0)+1);
if(records.length!==25)failures.push(`需要25条真实记录，现有${records.length}条`);
for(const {id} of fixture)if(counts.get(id)!==1)failures.push(`${id} 应有且仅有一条真实记录`);
const safe=records.filter(r=>list.has(r.id) && Number.isFinite(r.latencyMs) && Number.isFinite(r.costUsd));
const sort=safe.map(r=>r.latencyMs).sort((a,b)=>a-b);
const p95=sort.length?sort[Math.ceil(sort.length*.95)-1]:NaN;
const anchored=records.filter(r=>r.anchored===true).length;
const actionable=records.filter(r=>r.actionable5m===true).length;
const fallback=records.filter(r=>r.fallback===true).length;
const maxCost=Math.max(...safe.map(r=>r.costUsd),0);
if(anchored<20)failures.push(`锚定率 ${anchored}/25 < 20/25`);
if(actionable<20)failures.push(`5分钟内可执行 ${actionable}/25 < 20/25`);
if(!(p95<=15000))failures.push(`P95=${p95}ms 超过15000ms 或缺失`);
if(!(maxCost<=.01))failures.push(`单次成本最大 $${maxCost} 超过 $0.01`);
if(fallback>5)failures.push(`回退 ${fallback}/25 > 5/25`);
const result={status:failures.length?'FAIL_OR_UNVERIFIED':'PASS',total:records.length,
  metrics:{anchored,actionable5m:actionable,p95Ms:p95,maxCostUsd:maxCost,fallback},
  issues:failures.slice(0,55)};
console.log(JSON.stringify(result,null,2));
process.exit(failures.length?1:0);
