import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const judge=path.join(root,'scripts/compare-voice-ab.mjs');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-ab-'));
const wrong=(id)=>id==='weini'?'miaoze':'weini';
const build=()=>fixtures.map(f=>({id:f.id,replyText:`reply ${f.id}`,guessPersona:f.personaId,
 reason:'依据语气和所关注的细节',independentReviewer:true,reviewerId:'judge_a',
 seed:20261201,modelName:'deepseek-v4.1-flash'}));
const run=(before,after)=>{
 const a=path.join(dir,'a.jsonl'),b=path.join(dir,'b.jsonl');
 fs.writeFileSync(a,before.map(JSON.stringify).join('\n'));fs.writeFileSync(b,after.map(JSON.stringify).join('\n'));
 const out=spawnSync(process.execPath,[judge,a,b],{encoding:'utf8'});
 return {status:out.status,data:JSON.parse(out.stdout)};
};
test('A/B scorer validates exactly ten equal-seed same-judge replies (not a real judge)',()=>{
 const before=build();before[0].guessPersona=wrong(before[0].guessPersona);
 const after=build();const result=run(before,after);
 assert.equal(result.status,0);assert.equal(result.data.after.correct,10);assert.equal(result.data.delta,1);
});
test('A/B scorer fails when new voice gets more confused or misses 8/10',()=>{
 const before=build();const after=build();after[0].guessPersona=wrong(after[0].guessPersona);
 assert.equal(run(before,after).status,1);
 after[1].guessPersona=wrong(after[1].guessPersona);after[2].guessPersona=wrong(after[2].guessPersona);
 assert.equal(run(before,after).status,1);
});
test('A/B scorer requires same judge, model and seed, cannot accept answer key',()=>{
 const before=build(),after=build();after[1].reviewerId='judge_b';assert.equal(run(before,after).status,1);
 after[1].reviewerId='judge_a';after[1].seed=42;assert.equal(run(before,after).status,1);
 after[1].seed=20261201;after[1].personaId='weini';assert.equal(run(before,after).status,1);
});
