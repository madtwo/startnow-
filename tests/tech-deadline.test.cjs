'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const {install}=require('./tech-loader.cjs');install();
const {parseMaterialDeadline,confirmedDeadline,deadlineInputValue}=require('../src/lib/deadline.ts');
const now=new Date('2026-11-19T12:00:00').getTime();
test('explicit absolute date and time, no invented year',()=>{
  const result=parseMaterialDeadline('2026-11-21 23:59',now);
  assert.equal(result.ambiguous,false);assert.match(result.iso,/2026-11-21/);
  assert.equal(parseMaterialDeadline('11月21日 23:59',now).ambiguous,true);
});
test('today tomorrow and weekday with time',()=>{
  const today=parseMaterialDeadline('今天 23:59',now),tomorrow=parseMaterialDeadline('明天早上8点',now),fri=parseMaterialDeadline('周五 23:59',now);
  for(const r of [today,tomorrow,fri])assert.equal(r.ambiguous,false);
  assert.equal(deadlineInputValue(tomorrow).slice(0,10),'2026-11-20');
});
test('date-only, past, impossible date, conflicting dates never schedule',()=>{
  for(const text of ['周五','昨天23:59','今天 08:00','2026-02-30 12:00','2026-11-20 27:00','周五11月21日23:59'])
    assert.equal(parseMaterialDeadline(text,now).ambiguous,true,text);
});
test('only explicit valid local datetime confirmation returns milliseconds',()=>{
  assert.ok(confirmedDeadline('2026-11-21T23:59',now)>now);
  for(const text of ['2026-02-30T12:00','2026-11-19T08:00','2026-11-21','2026-99-99T00:00'])assert.equal(confirmedDeadline(text,now),null,text);
});
