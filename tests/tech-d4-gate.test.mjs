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
const pristine=()=>fixtures.map(x=>({id:x.id,source:'real-api',anchored:true,actionable5m:true,latencyMs:2000,costUsd:.002,fallback:false,requestCount:1}));
test('missing live evidence strictly fails and cannot be inferred from test fixtures',()=>{
  const x=check([]);assert.equal(x.status,1);assert.equal(x.data.status,'FAIL_OR_UNVERIFIED');
});
test('synthetic source is rejected even if all thresholds look green',()=>{
  const rows=pristine();rows[0].source='synthetic';const x=check(rows);assert.equal(x.status,1);
});
test('all five numerical thresholds are mechanically enforced when metadata is provided',()=>{
  const rows=pristine();assert.equal(check(rows).status,0,'valid metadata only tests the checker, not any API');
  rows[0].costUsd=.02;assert.equal(check(rows).status,1);rows[0].costUsd=.002;
  rows[0].latencyMs=16_001;rows[1].latencyMs=16_001;assert.equal(check(rows).status,1);rows[0].latencyMs=2000;rows[1].latencyMs=2000;
  rows.slice(0,6).forEach(r=>r.fallback=true);assert.equal(check(rows).status,1);
});
test('raw OCR/prompt/key fields fail closed for privacy',()=>{
  const rows=pristine();rows[0].ocrText='raw';assert.equal(check(rows).status,1);
});
