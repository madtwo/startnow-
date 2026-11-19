import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const runner=path.join(root,'scripts/prepare-voice-blind.mjs');
const cases=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const prepare=(alter=(x)=>x)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voiceblind-'));
 const rows=alter(cases.map(x=>({id:x.id,replyText:`回复原句 ${x.id}`,seed:20261201,modelName:'deepseek-v4.1-flash'})));
 const file=path.join(dir,'generated.jsonl');fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n'));
 const out=spawnSync(process.execPath,[runner,file],{encoding:'utf8'});
 fs.rmSync(dir,{recursive:true,force:true});return out;
};
test('blind CSV includes 10 replies without truth or any persona names',()=>{
 const r=prepare();assert.equal(r.status,0,r.stderr);
 assert.equal(r.stdout.trim().split('\n').length,11);
 assert.match(r.stdout,/guessPersona,reason,independentReviewer/);
 assert.doesNotMatch(r.stdout,/weini|yanggao|miaoze|shenmo|personaId/);
});
test('blind exporter refuses known answer key or duplicate IDs',()=>{
 assert.notEqual(prepare(rows=>rows.map((x,i)=>({...x,...(i===0?{personaId:'weini'}:{})}))).status,0);
 assert.notEqual(prepare(rows=>{rows[1].id=rows[0].id;return rows;}).status,0);
});
