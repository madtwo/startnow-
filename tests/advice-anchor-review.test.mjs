import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSamples, renderCsv, parseCsv, evaluateReviewSheets,
  reportMarkdown, runCli, checkSample } from '../scripts/advice-anchor-review.mjs';

const source = new URL('./fixtures/advice-anchor-synthetic.jsonl', import.meta.url);
const examples = readSamples(fs.readFileSync(source,'utf8'));
const review = (rows, reviewer, choices) => renderCsv(rows.map((row,i) => ({
  ...row, reviewer_id: reviewer, independent_confirmed:'Y',
  same_action: choices[i] ? 'Y':'N', grounded: choices[i] ? 'Y':'N',
  one_step: choices[i] ? 'Y':'N', safety:'Y', notes:'Checked independently against synthetic case',
})));

test('eight synthetic examples contain four rejected and four off-topic negative controls',()=>{
  assert.equal(examples.length,8);
  assert.deepEqual(examples.map((r)=>r.source),['rejected','rejected','rejected','rejected','negative','negative','negative','negative']);
});
test('preparation emits two independent blank CSVs, never overwrites an existing file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anchor-prepare-'));
  try {
    const folder=path.join(dir,'review');
    const result=runCli(['prepare',fileURLToPath(source),folder]);
    assert.match(result,/Two independent/u);
    const a=fs.readFileSync(path.join(folder,'reviewer-a.csv'),'utf8');
    const b=fs.readFileSync(path.join(folder,'reviewer-b.csv'),'utf8');
    assert.equal(a,b);
    assert.ok(a.startsWith('\uFEFF'), 'Excel-friendly UTF-8 BOM');
    assert.equal(parseCsv(a).length,8);
    assert.throws(()=>runCli(['prepare',fileURLToPath(source),folder]),/already exists/u);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('BOM-prefixed review CSV is accepted without corrupting headers or Chinese text',()=>{
  const a=review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]);
  const parsed=parseCsv('\uFEFF'+a);
  assert.equal(parsed.length,8);
  assert.equal(parsed[0].card,examples[0].card);
  assert.equal(parsed[0].actionLabel,examples[0].actionLabel);
});
test('blind review report counts candidates, disagreements and negative controls',()=>{
  const a=review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]);
  const b=review(examples,'reviewer_B',[true,true,true,true,false,false,false,false]);
  const result=evaluateReviewSheets(a,b);
  assert.equal(result.rejected,4);
  assert.equal(result.negativeTotal,4);
  assert.equal(result.candidate,4);
  assert.equal(result.negativeEscapes,0);
  assert.equal(result.ready_for_consideration,false); // Only 4, not 10 independently reviewed cases.
  assert.equal(result.change_validator_automatically,false);
  const summary=reportMarkdown(result);
  assert.match(summary,/INSUFFICIENT/u);
  assert.doesNotMatch(summary,/\u91cf\u7eb2\u7b26\u53f7/u); // Never print model text in summary.
});
test('reviewer independence and completion are mandatory',()=>{
  const a=review(examples,'same_reviewer',[true,true,true,true,false,false,false,false]);
  assert.throws(()=>evaluateReviewSheets(a,a),/identities/u);
  assert.throws(()=>evaluateReviewSheets(renderCsv(examples),review(examples,'reviewer_B',[true,true,true,true,false,false,false,false])),/Missing/u);
});
test('different case text or action ID cannot be silently paired',()=>{
  const a=review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]);
  const b=review(examples.map((row,i)=>i===0?{...row,actionId:'wrong-action'}:row),'reviewer_B',[true,true,true,true,false,false,false,false]);
  assert.throws(()=>evaluateReviewSheets(a,b),/differ/u);
});
test('negative-control escape blocks any readiness claim',()=>{
  const result=evaluateReviewSheets(review(examples,'reviewer_A',[true,true,true,true,true,false,false,false]),
    review(examples,'reviewer_B',[true,true,true,true,true,false,false,false]));
  assert.equal(result.negativeEscapes,1);
  assert.equal(result.ready_for_consideration,false);
});
test('disagreement in a safety dimension is reported',()=>{
  const a=review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]);
  const rows=parseCsv(review(examples,'reviewer_B',[true,true,true,true,false,false,false,false]));
  rows[0].safety='N';
  const b=renderCsv(rows);
  const result=evaluateReviewSheets(a,b);
  assert.equal(result.safeDisagreements,1);
  assert.equal(result.disagreements,1);
});
test('rejects untrusted real-looking content and malformed JSON without echoing it',()=>{
  const good={...JSON.parse(fs.readFileSync(source,'utf8').split('\n')[0])};
  for(const secret of ['test@example.com','https://test.invalid','sk-'+'0'.repeat(24),
    '13912345678','2026-11-20','\u5317\u4eac\u5927\u5b66']){
    assert.throws(()=>checkSample({...good,rejectedLine:secret}),err=>{
      assert.doesNotMatch(err.message,/test@example|139123|sk-0000/u);
      return true;
    });
  }
  assert.throws(()=>readSamples('hello not json\n'),/Malformed/u);
  assert.throws(()=>readSamples(JSON.stringify({...good,case_id:'real-uuid'})+'\n'),/Invalid/u);
  assert.throws(()=>readSamples([JSON.stringify(good),JSON.stringify(good)].join('\n')),/Duplicate/u);
});
test('does not run arbitrary formula text in CSV exports',()=>{
  const r={...examples[0],card:'=2+3'};
  const csv=renderCsv([r]);
  assert.ok(csv.includes('"\'=2+3"'));
  assert.match(parseCsv(csv)[0].card,/^'/u);
});
test('score CLI report is exclusive, no automatic access to API or network',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anchor-score-'));
  try {
    const a=path.join(dir,'a.csv'),b=path.join(dir,'b.csv'),output=path.join(dir,'report.md');
    fs.writeFileSync(a,review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]));
    fs.writeFileSync(b,review(examples,'reviewer_B',[true,true,true,true,false,false,false,false]));
    assert.match(runCli(['score',a,b,output]),/Reviewed 8/u);
    assert.match(fs.readFileSync(output,'utf8'),/Automatic acceptance or online threshold change: NEVER/u);
    assert.throws(()=>runCli(['score',a,b,output]),/EEXIST/u);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('refuses real-looking IDs and formula-like reviewer metadata',()=>{
  const sourceRow={...JSON.parse(fs.readFileSync(source,'utf8').split('\n')[0])};
  assert.throws(()=>checkSample({...sourceRow,case_id:'person-12'}),/synthetic/u);
  assert.throws(()=>checkSample({...sourceRow,model:'sk-'+'a'.repeat(24)}),/sensitive/u);
  const a=review(examples,'reviewer_A',[true,true,true,true,false,false,false,false]);
  const rows=parseCsv(review(examples,'reviewer_B',[true,true,true,true,false,false,false,false]));
  rows[0].reviewer_id='=EXEC';
  assert.throws(()=>evaluateReviewSheets(a,renderCsv(rows)),/Missing/u);
});
