import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scenarios=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const script=path.join(root,'scripts/verify-voice-replies.mjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v4-voice-'));
const run=rows=>{const file=path.join(dir,'test.jsonl');fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));
 const v=spawnSync(process.execPath,[script,file],{encoding:'utf8'});return {status:v.status,data:JSON.parse(v.stdout)};};
const valid=()=>scenarios.map(r=>({id:r.id,replyText:'针对你这件事我听到一个具体细节。',guessPersona:r.personaId,
  reason:'有具体细节且符合表达习惯',independentReviewer:true,modelName:'deepseek-v4.1-flash',seed:20261201}));
test('no actual 10 replies means unverified',()=>assert.equal(run([]).status,1));
test('a complete synthetic reviewer-input only tests scoring mechanics',()=>{
 const rows=valid();assert.equal(run(rows).status,0);
 rows.slice(0,3).forEach(r=>r.guessPersona=r.guessPersona==='weini'?'miaoze':'weini');
 const out=run(rows);assert.equal(out.status,1);assert.equal(out.data.correct,7);assert.equal(out.data.misses.length,3);
});
test('incomplete independent review, duplicate ids, changed seed are rejected',()=>{
 const rows=valid();rows[0].independentReviewer=false;assert.equal(run(rows).status,1);
 rows[0].independentReviewer=true;rows[0].seed=123;assert.equal(run(rows).status,1);
 rows[0].seed=20261201;rows[1].id=rows[0].id;assert.equal(run(rows).status,1);
});
