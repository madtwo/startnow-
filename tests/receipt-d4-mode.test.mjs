import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const gate=path.join(root,'scripts/verify-material-d4.mjs');
const cases=JSON.parse(fs.readFileSync(path.join(root,'fixtures/tech-material-cases.json'),'utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-d4-'));
const run=(rows,mode)=>{
 const file=path.join(dir,'input.jsonl');fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n'));
 const r=spawnSync(process.execPath,[gate,file,`--mode=${mode}`],{encoding:'utf8'});
 return {status:r.status,data:JSON.parse(r.stdout)};
};
const base=(mode)=>cases.map((row,i)=>({id:row.id,source:'real-api',imageOrigin:'real-camera',
 imageSha256:(i+100).toString(16).padStart(64,'0'),sourceSha256:(i+100).toString(16).padStart(64,'0'),humanReviewed:true,reviewerId:'manual1',
 modelName:'vision-model-test',captureMode:mode,stepSource:mode==='vision-template'?'template':'model',
 anchored:true,actionable5m:true,latencyMs:1000,costUsd:.0005,fallback:false,requestCount:mode==='vision-template'?1:2}));
test('mode-specific D4 schema accepts synthetic METADATA for checker mechanics only',()=>{
 for(const mode of ['two-step','vision-template','single']){
  const r=run(base(mode),mode);assert.equal(r.status,0,`${mode} ${JSON.stringify(r.data.issues)}`);
  assert.equal(r.data.captureMode,mode);
 }
});
test('vision-template enforces one request and local template provenance',()=>{
 const rows=base('vision-template');rows[1].requestCount=2;
 assert.equal(run(rows,'vision-template').status,1);
 rows[1].requestCount=1;rows[0].stepSource='model';assert.equal(run(rows,'vision-template').status,1);
 rows[0].stepSource='template';rows[0].captureMode='single';assert.equal(run(rows,'vision-template').status,1);
});
test('mode mixing, fake source, missing human audit, too slow and high fallback fail closed',()=>{
 const rows=base('two-step');rows[1].captureMode='single';assert.equal(run(rows,'two-step').status,1);
 rows[1].captureMode='two-step';rows[1].humanReviewed=false;assert.equal(run(rows,'two-step').status,1);
 rows[1].humanReviewed=true;rows[1].latencyMs=20_000;rows[2].latencyMs=20_000;
 assert.equal(run(rows,'two-step').status,1);
});
