#!/usr/bin/env node
// 10 fresh cross-topic persona replies. Independent reviewers only see id+reply, not the truth map.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scenarios=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const byId=new Map(scenarios.map(row=>[row.id,row]));
const input=process.argv[2];
if(!input){console.error('用法: node scripts/verify-voice-replies.mjs acceptance/voice-replies-10.jsonl');process.exit(2);}
let lines;
try{lines=fs.readFileSync(input,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
catch{console.error('无法读取盲评数据');process.exit(2);}
const failures=[];const rows=[];
const allowed=['id','replyText','guessPersona','reason','independentReviewer','modelName','seed'];
for(const [i,line] of lines.entries()){
 try{
   const r=JSON.parse(line);
   if(!r||typeof r!=='object'||Array.isArray(r))throw Error();
   if(!byId.has(r.id))failures.push(`第${i+1}条ID不在固定10题中`);
   const extra=Object.keys(r).filter(k=>!allowed.includes(k));
   if(extra.length)failures.push(`第${i+1}条出现隐藏答案或额外字段`);
   if(!['shenmo','weini','miaoze','yanggao'].includes(r.guessPersona) ||
      typeof r.replyText!=='string'||!r.replyText.trim()||r.replyText.length>800 ||
      typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>250 ||
      r.independentReviewer!==true || r.seed!==20261201 || r.modelName!=='deepseek-v4.1-flash')
     failures.push(`第${i+1}条缺少完整独立盲评或沿用既定 seed/model`);
   rows.push(r);
 }catch{failures.push(`第${i+1}条JSON格式错误`);}
}
if(rows.length!==10)failures.push('需要恰好10条跨主题回复');
const counts=new Map();for(const r of rows)counts.set(r.id,(counts.get(r.id)||0)+1);
for(const row of scenarios)if(counts.get(row.id)!==1)failures.push(`${row.id}未恰好出现一次`);
const misses=[];let correct=0;
for(const r of rows){const truth=byId.get(r.id)?.personaId;
 if(!truth)continue;
 if(truth===r.guessPersona)correct++;
 else misses.push({id:r.id,truth,guess:r.guessPersona,reason:r.reason,replyText:r.replyText});
}
if(correct<8)failures.push(`角色辨识${correct}/10，低于8/10`);
console.log(JSON.stringify({status:failures.length?'FAIL_OR_UNVERIFIED':'PASS',total:rows.length,
  correct,misses,issues:failures.slice(0,30)},null,2));
process.exit(failures.length?1:0);
