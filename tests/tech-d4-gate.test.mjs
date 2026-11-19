import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const gate=path.join(root,'scripts/verify-material-d4.mjs');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/tech-material-cases.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'d4-'));
const check=(rows)=>{
  const file=path.join(tmp,'records.jsonl');fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));
  const done=spawnSync(process.execPath,[gate,file],{encoding:'utf8'});
  return {status:done.status,data:JSON.parse(done.stdout)};
};
const hash=(i)=>(i+30).toString(16).padStart(64,'0');
const pristine=()=>fixtures.map((x,i)=>({id:x.id,source:'real-api',imageOrigin:'real-camera',imageSha256:hash(i),
  humanReviewed:true,reviewerId:'anonymous1',modelName:'ds4.1-test',captureMode:'single',
  anchored:true,actionable5m:true,latencyMs:2000,costUsd:.002,fallback:false,requestCount:1}));
test('no live evidence strictly fails; synthetic source and known synthetic image fail',()=>{
  assert.equal(check([]).status,1);
  const r=pristine();r[0].source='synthetic';assert.equal(check(r).status,1);
  r[0].source='real-api';
  r[0].imageSha256=JSON.parse(fs.readFileSync(path.join(root,'fixtures/d4-synthetic-sha256.json'),'utf8'))[0];
  assert.equal(check(r).status,1);
});
test('metadata validates all limits but does not attest unseen images',()=>{
  const rows=pristine();assert.equal(check(rows).status,0,'the test checker input is synthetic METADATA, not D4 evidence');
  rows[0].costUsd=.02;assert.equal(check(rows).status,1);rows[0].costUsd=.002;
  rows[0].latencyMs=16001;rows[1].latencyMs=16001;assert.equal(check(rows).status,1);
  rows[0].latencyMs=2000;rows[1].latencyMs=2000;
  rows.slice(0,6).forEach(r=>r.fallback=true);assert.equal(check(rows).status,1);
});
test('duplicate photo hashes, lack of human review and image metadata reject',()=>{
  const rows=pristine();rows[1].imageSha256=rows[0].imageSha256;assert.equal(check(rows).status,1);
  rows[1].imageSha256=hash(1);rows[1].humanReviewed=false;assert.equal(check(rows).status,1);
  rows[1].humanReviewed=true;delete rows[1].imageOrigin;assert.equal(check(rows).status,1);
});
test('reject raw OCR, keys, two-stage and unreported retry',()=>{
  const rows=pristine();rows[0].ocrText='sensitive OCR';assert.equal(check(rows).status,1);delete rows[0].ocrText;
  rows[0].captureMode='two-step';assert.equal(check(rows).status,1);rows[0].captureMode='single';
  rows[0].requestCount=3;assert.equal(check(rows).status,1);
});
