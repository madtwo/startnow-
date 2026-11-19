#!/usr/bin/env node
/** Export model-generated replies for independent judges without persona truth.
 * Usage: node scripts/prepare-voice-blind.mjs generated.jsonl > blind.csv
 * The generated JSONL is metadata plus replies, never a hidden answer key. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const arg=process.argv[2];
if(!arg){console.error('用法：node scripts/prepare-voice-blind.mjs generated.jsonl > blind.csv');process.exit(2);}
let lines;
try{lines=fs.readFileSync(arg,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
catch{console.error('未找到模型输出 JSONL');process.exit(2);}
if(lines.length!==10){console.error('需要恰好10条模型生成回复');process.exit(1);}
const byId=new Map();
for(const line of lines){
 let row;try{row=JSON.parse(line);}catch{console.error('JSONL 无法解析');process.exit(1);}
 if(!row||typeof row!=='object'||Array.isArray(row)||
   Object.keys(row).some(x=>!['id','replyText','seed','modelName'].includes(x))||
   typeof row.replyText!=='string'||!row.replyText.trim()||row.replyText.length>800||
   typeof row.id!=='string'||!cases.some(c=>c.id===row.id)||byId.has(row.id)||
   row.seed!==20261201||row.modelName!=='deepseek-v4.1-flash'){
   console.error('存在无效、重复、包含答案或模型/seed不一致的回复');process.exit(1);
 }
 byId.set(row.id,row);
}
const csv=(value)=>'"'+String(value).replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';
console.log('id,replyText,guessPersona,reason,independentReviewer,modelName,seed,reviewerId');
for(const entry of cases){
 const r=byId.get(entry.id);
 if(!r){console.error('缺少题目',entry.id);process.exit(1);}
 console.log([r.id,r.replyText,'','','',r.modelName,r.seed,''].map(csv).join(','));
}
console.error('仅向独立评审发送生成的 blind.csv；不要提供含 personaId 的场景答案文件。');
