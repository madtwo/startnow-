import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalls, summarizeCalls, compareBudget,renderBudgetReport } from '../scripts/round3-budget-ab.mjs';
const map={chainId:'chainId',seed:'seed',costUsd:'costUsd',chainDurationMs:'chainDurationMs',visibleChars:'visibleChars',isNonFault:'isNonFault',emptyBody:'emptyBody',completionEligible:'completionEligible',completionAccepted:'completionAccepted'};
const rows=(cost,duration,accepted=true)=>Array.from({length:20},(_,i)=>({
  chainId:`chain-${i}`,seed:'same-seed',costUsd:cost,chainDurationMs:duration,visibleChars:60,
  isNonFault:true,emptyBody:false,completionEligible:true,completionAccepted:accepted,
}));

test('R5: parse real-shaped JSONL and aggregate 20 same-seed chains',()=>{
  const calls=parseCalls(rows(.002,2300).map((x)=>JSON.stringify(x)).join('\n'));
  const metric=summarizeCalls(calls,map);
  assert.equal(metric.chains,20);
  assert.equal(metric.seed,'same-seed');
  assert.ok(Math.abs(metric.costPerChain-.002)<1e-12);
  assert.equal(metric.p95ms,2300);
  assert.equal(metric.nonFaultEmptyRate,0);
});

test('R5: high cost / P95 triggers rollback even when some evidence missing',()=>{
  const old=summarizeCalls(rows(.002,2000),map);
  const next=summarizeCalls(rows(.0045,9000),map);
  const c=compareBudget(old,next,{badCount:1},{badCount:1});
  assert.equal(c.anyRollback,true);
  assert.equal(c.checks[0].triggered,true);
  assert.equal(c.checks[1].triggered,true);
});

test('R5: mismatch in seeds and missing latency never passes',()=>{
  const old=summarizeCalls(rows(.002,2000),map);
  const missing=rows(.002,2000).map((x)=>({...x,chainDurationMs:undefined,seed:'another-seed'}));
  const next=summarizeCalls(missing,map);
  const c=compareBudget(old,next);
  assert.equal(c.sameSeed,false);
  assert.equal(c.allKnown,false);
  assert.match(c.status,/不能判定通过/);
  assert.match(renderBudgetReport(old,next,c,'a.jsonl','b.jsonl'),/未验证/);
});

test('R5: actual independent blind-review metrics required for full threshold result',()=>{
  const old=summarizeCalls(rows(.002,2000),map), next=summarizeCalls(rows(.0025,2100),map);
  const c=compareBudget(old,next);
  assert.equal(c.anyRollback,false);
  assert.equal(c.allKnown,false);
  assert.equal(compareBudget(old,next,{badCount:0},{badCount:2}).anyRollback,true);
});

test('R5: completion adoption falls by over five percentage points triggers rollback',()=>{
  const old=summarizeCalls(rows(.002,2000,true),map);
  const next=summarizeCalls(rows(.002,2000,false),map);
  assert.equal(compareBudget(old,next).checks[3].triggered,true);
});
