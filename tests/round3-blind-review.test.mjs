import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvDump, csvParse, prepareReview, validateReview } from '../scripts/round3-blind-review.mjs';
const rows=Array.from({length:24},(_,i)=>({
  id:String(i+1),card:`卡片：压力${i},\n可能很忙`,advice:`建议“先写一句”，案例${i}`,
  expectedTheme:'DO_NOT_REVEAL', actionFamily:'HIDDEN',
}));
const source=csvDump(rows,['id','card','advice','expectedTheme','actionFamily']);
const prepared=prepareReview(source);
const headers=['case_id','card','advice','score_0_or_1','reason','reviewer_id','independent','disagree'];

test('R3: prepare includes only visible card & advice, strips route/expectedTheme',()=>{
  assert.equal(prepared.blind.length,24);
  assert.equal(prepared.mapping.length,24);
  const blind=csvDump(prepared.blind,headers);
  assert.ok(!blind.includes('DO_NOT_REVEAL'));
  assert.ok(!blind.includes('HIDDEN'));
  assert.equal(csvParse(blind)[0].card,rows[0].card);
});

test('R3: valid independent 24-case reviewer with 1 mismatch passes',()=>{
  const rated=prepared.blind.map((r,i)=>({...r,score_0_or_1:i===2?'1':'0',reason:'人工判断示例',reviewer_id:'reviewer-external',independent:'yes'}));
  const result=validateReview(csvDump(rated,headers));
  assert.equal(result.pass,true);
  assert.deepEqual(result.badCases,['03']);
  assert.equal(result.independentReviewers.length,1);
});

test('R3: 2 mismatches fail, reviewer missing independence or reason rejected',()=>{
  const rated=prepared.blind.map((r,i)=>({...r,score_0_or_1:i<2?'1':'0',reason:'具体原因',reviewer_id:'external',independent:'yes'}));
  assert.equal(validateReview(csvDump(rated,headers)).pass,false);
  rated[9].reason='';
  assert.throws(()=>validateReview(csvDump(rated,headers)),/评分理由/);
  rated[9].reason='具体原因'; rated[9].independent='no';
  assert.throws(()=>validateReview(csvDump(rated,headers)),/至少有 1 名/);
});

test('R3: reviewer disagreements must be recorded explicitly',()=>{
  const rated=prepared.blind.map((r)=>({...r,score_0_or_1:'0',reason:'还算贴合',reviewer_id:'external',independent:'yes'}));
  rated.push({...rated[0],score_0_or_1:'1',reason:'认为不贴合',reviewer_id:'another',independent:'yes'});
  assert.throws(()=>validateReview(csvDump(rated,headers)),/分歧/);
  rated[24].disagree='yes';
  assert.equal(validateReview(csvDump(rated,headers)).badCount,1);
});

test('R3: count enforced and quoted multiline CSV roundtrip',()=>{
  assert.equal(csvParse(source).length,24);
  assert.throws(()=>prepareReview(csvDump(rows.slice(0,23),['id','card','advice'])),/24/);
});
