#!/usr/bin/env node
/** Compare two independently blinded 10-reply evaluations with the SAME judge.
 * This verifies the scoring protocol, not that a judge/model was actually used.
 * Raw replies stay in input files; stdout contains only counts and misclassified ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scenarios=JSON.parse(fs.readFileSync(path.join(root,'fixtures/voice-replies-10-scenarios.json'),'utf8'));
const truth=new Map(scenarios.map(x=>[x.id,x.personaId]));
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath){console.error('用法: node scripts/compare-voice-ab.mjs before.review.jsonl after.review.jsonl');process.exit(2);}
const allowed=new Set(['id','replyText','guessPersona','reason','independentReviewer','modelName','seed','reviewerId']);
const problems=[];
function load(file,label){
 let lines;try{lines=fs.readFileSync(file,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}
 catch{problems.push(`${label}: 找不到评审文件`);return [];}
 if(lines.length!==10)problems.push(`${label}: 必须恰好10条`);
 const seen=new Set(),result=[];
 for(const [index,line] of lines.entries()){
  try{
   const row=JSON.parse(line);
   if(!row||typeof row!=='object'||Array.isArray(row))throw Error('non-object');
   if(Object.keys(row).some(k=>!allowed.has(k)))problems.push(`${label}第${index+1}行: 包含答案或非允许字段`);
   if(!truth.has(row.id)||seen.has(row.id))problems.push(`${label}第${index+1}行: 无效/重复ID`);
   seen.add(row.id);
   if(typeof row.replyText!=='string'||!row.replyText.trim()||row.replyText.length>800||
      !['shenmo','weini','miaoze','yanggao'].includes(row.guessPersona)||
      typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>250||
      row.independentReviewer!==true||row.seed!==20261201||row.modelName!=='deepseek-v4.1-flash'||
      typeof row.reviewerId!=='string'||!/^[a-zA-Z0-9_-]{2,32}$/.test(row.reviewerId))
     problems.push(`${label}第${index+1}行: 缺少独立评审、相同模型/seed或评审编号`);
   result.push(row);
  }catch{problems.push(`${label}第${index+1}行: JSON无效`);}
 }
 for(const id of truth.keys())if(!seen.has(id))problems.push(`${label}: 缺少${id}`);
 return result;
}
const before=load(beforePath,'before'),after=load(afterPath,'after');
const all=[...before,...after];
const reviewers=new Set(all.map(r=>r.reviewerId));
if(reviewers.size!==1)problems.push('两批必须由相同的匿名评审者按同一规则评审');
function summary(rows){return {correct:rows.filter(r=>truth.get(r.id)===r.guessPersona).length,
  missedIds:rows.filter(r=>truth.get(r.id)!==r.guessPersona).map(r=>r.id)};}
const b=summary(before),a=summary(after);
if(a.correct<8)problems.push(`新版辨识率${a.correct}/10，目标至少8/10`);
if(a.correct<b.correct)problems.push(`新版比旧版下降${b.correct-a.correct}/10，须人工审查`);
console.log(JSON.stringify({status:problems.length?'FAIL_OR_UNVERIFIED':'PASS',before:b,after:a,
  delta:a.correct-b.correct,reviewerCount:reviewers.size,issues:problems.slice(0,35)},null,2));
process.exit(problems.length?1:0);
