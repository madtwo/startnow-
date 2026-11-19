#!/usr/bin/env node
// D4 final gate. Metadata only: NEVER persist images, OCR, raw prompts, answers or API keys.
// A human reviewer must explicitly attest real-image provenance and actionability.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/tech-material-cases.json'),'utf8'));
const syntheticHashes=new Set(JSON.parse(fs.readFileSync(path.join(root,'fixtures/d4-synthetic-sha256.json'),'utf8')));
const known=new Set(fixtures.map(x=>x.id));
const file=process.argv[2];
const requestedMode=process.argv.find(arg=>arg.startsWith('--mode='))?.slice('--mode='.length) || 'single';
const MODES=new Set(['single','two-step','vision-template']);
if (!MODES.has(requestedMode)) {console.error('模式必须为 single、two-step 或 vision-template');process.exit(2);}
if (!file) {console.error('用法：node scripts/verify-material-d4.mjs acceptance/real-d4.jsonl [--mode=vision-template|two-step|single]');process.exit(2);}
let lines;
try {lines=fs.readFileSync(file,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
catch {console.error('无法读取D4元数据文件');process.exit(2);}
const allowed=new Set(['id','source','imageOrigin','imageSha256','sourceSha256','humanReviewed','reviewerId','modelName','captureMode','stepSource',
  'anchored','actionable5m','latencyMs','costUsd','fallback','requestCount']);
const failures=[];const rows=[];
for (let i=0;i<lines.length;i++) {
  try {
    const r=JSON.parse(lines[i]);
    if (!r || typeof r!=='object' || Array.isArray(r)) throw Error('invalid');
    const extra=Object.keys(r).filter(k=>!allowed.has(k));
    if(extra.length) failures.push(`第${i+1}行含有原文/未允许的字段：${extra.join(',')}`);
    if(!known.has(r.id)) failures.push(`第${i+1}行：未登记的测试类型ID`);
    if(r.source!=='real-api') failures.push(`${r.id??i}: 不是实际 API 记录`);
    if(!['real-camera','real-screenshot'].includes(r.imageOrigin)) failures.push(`${r.id??i}: 未证明真实手机拍摄或截图来源`);
    const sourceHash=r.sourceSha256??r.imageSha256;
    if(!/^[0-9a-f]{64}$/i.test(sourceHash||'')) failures.push(`${r.id??i}: 缺少原图 SHA256（sourceSha256/imageSha256）`);
    if (r.sourceSha256 && r.imageSha256 && r.sourceSha256.toLowerCase()!==r.imageSha256.toLowerCase())
      failures.push(`${r.id??i}: 两个原图哈希字段不一致`);
    if(syntheticHashes.has(String(sourceHash).toLowerCase())) failures.push(`${r.id??i}: 使用了已知合成测试图`);
    if(requestedMode==='vision-template' && !r.sourceSha256)
      failures.push(`${r.id??i}: 模板模式需要 sourceSha256 证明源文件标识`);
    if(r.humanReviewed!==true || !/^[a-zA-Z0-9_-]{2,32}$/.test(r.reviewerId||''))
      failures.push(`${r.id??i}: 缺少人工逐张审查声明/匿名评审编号`);
    if(!/^[a-zA-Z0-9._:/+-]{2,120}$/.test(r.modelName||'')) failures.push(`${r.id??i}: 缺少模型版本`);
    if(r.captureMode!==requestedMode) failures.push(`${r.id??i}: 当前门禁仅接受 captureMode=${requestedMode}`);
    if (requestedMode==='vision-template' && r.stepSource!=='template')
      failures.push(`${r.id??i}: 模板模式必须报告已校验的本地模板动作来源`);
    if (r.stepSource!=null && !['model','template'].includes(r.stepSource))
      failures.push(`${r.id??i}: 非法动作来源`);
    if(typeof r.anchored!=='boolean' || typeof r.actionable5m!=='boolean' || typeof r.fallback!=='boolean' ||
      !Number.isFinite(r.latencyMs)||r.latencyMs<0||!Number.isFinite(r.costUsd)||r.costUsd<0 ||
      !Number.isInteger(r.requestCount)||r.requestCount<1||r.requestCount>(requestedMode==='vision-template'?1:requestedMode==='single'?2:4))
      failures.push(`${r.id??i}: 缺少人工判断、实测数据或调用次数与模式不匹配`);
    rows.push(r);
  }catch{failures.push(`第${i+1}行不是有效元数据JSON`);}
}
const count=new Map(), hashCount=new Map(), models=new Set();
for(const r of rows){count.set(r.id,(count.get(r.id)||0)+1);
  if(typeof (r.sourceSha256??r.imageSha256)==='string') {const h=(r.sourceSha256??r.imageSha256).toLowerCase();hashCount.set(h,(hashCount.get(h)||0)+1);}
  if(typeof r.modelName==='string')models.add(r.modelName);
}
if(rows.length!==25)failures.push(`须有25条记录，实际${rows.length}条`);
for(const {id} of fixtures)if(count.get(id)!==1)failures.push(`${id}: 须恰好1条`);
for(const [,total] of hashCount)if(total>1)failures.push('不同ID复用了同一张图片的SHA256');
if(models.size!==1)failures.push('25条记录必须使用同一模型版本');
// Human review and real image provenance cannot be established from metadata alone.
// A PASS is conditional on truthful, independent attestations.
const valid=rows.filter(r=>Number.isFinite(r.latencyMs)&&r.latencyMs>=0&&Number.isFinite(r.costUsd)&&r.costUsd>=0);
const latency=valid.map(x=>x.latencyMs).sort((a,b)=>a-b);
const p95=latency.length?latency[Math.ceil(latency.length*.95)-1]:null;
const anchored=rows.filter(x=>x.anchored===true).length;
const actionable5m=rows.filter(x=>x.actionable5m===true).length;
const fallback=rows.filter(x=>x.fallback===true).length;
const maxCost=valid.length?Math.max(...valid.map(x=>x.costUsd)):null;
if(anchored<20)failures.push(`锚定${anchored}/25，需至少20`);
if(actionable5m<20)failures.push(`人工确认可执行${actionable5m}/25，需至少20`);
if(p95===null || p95>15_000)failures.push(`P95=${p95}ms，门限15,000ms`);
if(maxCost===null || maxCost>.01)failures.push(`单图最大总成本$${maxCost}，门限$0.01`);
if(fallback>5)failures.push(`回退${fallback}/25，最多5`);
console.log(JSON.stringify({status:failures.length?'FAIL_OR_UNVERIFIED':'PASS',captureMode:requestedMode,total:rows.length,
  metrics:{anchored,actionable5m,p95Ms:p95,maxCostUsd:maxCost,fallback},
  issues:failures.slice(0,50)},null,2));
process.exit(failures.length?1:0);
