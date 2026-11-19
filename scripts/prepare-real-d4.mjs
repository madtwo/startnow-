#!/usr/bin/env node
/** Generates a metadata-only incomplete D4 review template from LOCAL real photos.
 * It never copies or prints image bytes. The imageOrigin and humanReview fields
 * are intentionally unset; users must verify provenance and manually score. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/tech-material-cases.json'),'utf8'));
const knownSynthetic=new Set(JSON.parse(fs.readFileSync(path.join(root,'fixtures/d4-synthetic-sha256.json'),'utf8')));
const folder=process.argv[2];
const mode=process.argv.find(arg=>arg.startsWith('--mode='))?.slice('--mode='.length) || 'two-step';
if(!['two-step','vision-template','single'].includes(mode)){
  console.error('模式必须为 two-step、vision-template、single');process.exit(2);
}
if(!folder){console.error('用法：node scripts/prepare-real-d4.mjs <实际原图目录> > acceptance/real-d4.template.jsonl');process.exit(2);}
let files;try{files=fs.readdirSync(folder);}catch{console.error('原图目录不可读取');process.exit(2);}
const hashes=new Set();const out=[];const issues=[];
for(const row of fixtures){
  const candidates=files.filter(n=>new RegExp(`^${row.id}\\.(png|jpe?g|webp)$`,'i').test(n));
  if(candidates.length!==1){issues.push(`${row.id}: 应有恰好一张 jpg/png/webp`);continue;}
  const bytes=fs.readFileSync(path.join(folder,candidates[0]));
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  if(hashes.has(digest) || knownSynthetic.has(digest)){issues.push(`${row.id}: 重复图片或与合成测试图相同`);continue;}
  hashes.add(digest);
  out.push({id:row.id,source:'unverified',imageOrigin:'unverified',imageSha256:digest,sourceSha256:digest,
    humanReviewed:false,reviewerId:'',modelName:'',captureMode:mode,stepSource:mode==='vision-template'?'template':null,
    anchored:null,actionable5m:null,latencyMs:null,costUsd:null,fallback:null,requestCount:null});
}
if(issues.length){console.error(issues.join('\n'));process.exit(1);}
for(const row of out)console.log(JSON.stringify(row));
console.error('仅生成待填写模板。真实来源、API测量和独立人工审查必须另外填写；模板本身不能通过门禁。');
