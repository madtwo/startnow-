'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {install}=require('./tech-loader.cjs');install();
const {tickPersonaGoals}=require('../src/lib/personaGoals.ts');
const {isManipulative}=require('../src/lib/agentVulnerability.ts');
const ids=['shenmo','weini','miaoze','yanggao'];const personas=ids.map(id=>({id,name:id}));
const base=new Date('2026-11-19T12:00:00').getTime(),DAY=864e5;
const run=(goals=[],cards=[],now=base,other={})=>tickPersonaGoals({goals,cards,personas,now,enabled:true,dailyCap:4,enableLost:true,...other});
test('competition & paused never create persona goal or lost; neither changes input',()=>{
  for(const flag of [{competition:true},{enabled:false}]){
    const goals=[],cards=[];const out=run(goals,cards,base,flag);
    assert.equal(out.createdGoals,0);assert.equal(out.publishedResults,0);
    assert.deepEqual(goals,[]);assert.deepEqual(cards,[]);
  }
});
test('three local days: vulnerability cap global two/day, persona one/day, no dependency pressure',()=>{
  let goals=[],cards=[];
  for(let day=0;day<3;day++){
    const now=base+day*DAY;
    const result=run(goals,cards,now);
    ({goals,cards}=result);
    const today=new Date(now).toDateString();
    const todays=cards.filter(c=>c.vulnerability && new Date(c.vulnerability.at).toDateString()===today);
    assert.ok(todays.length<=2,'global daily cap');
    assert.equal(new Set(todays.map(c=>c.authorId)).size,todays.length,'no two vulnerability posts/persona/day');
    for(const c of todays){assert.equal(c.kind,'worry');assert.equal(c.authorKind,'persona');assert.equal(isManipulative(c.text),false);}
    const repeat=run(goals,cards,now);
    assert.equal(repeat.createdGoals,0,'day idempotence');assert.equal(repeat.publishedResults,0,'result idempotence');
  }
  assert.equal(goals.length,12);
  const counts=new Set(cards.map(c=>c.id));assert.equal(counts.size,cards.length,'no id duplicate');
});
test('same-day crisis stops new vulnerabilities, without deleting existing goals',()=>{
  const initial=run([],[],base,{enableLost:false});
  const day2=run(initial.goals,initial.cards,base+DAY,{crisisAt:base+DAY,enableLost:true});
  assert.equal(day2.cards.filter(c=>c.vulnerability).length,0);
});
test('missed outcome is worry and only one follow-up; multiple overdue respects 2/day',()=>{
  const past=base-3*DAY;
  const goals=ids.map((id,i)=>({id:`g${i}`,source:'ai',ownerId:id,createdAt:past,postPlan:{outcome:'missed',dueAt:past+3600_000}}));
  const first=run(goals,[],base,{dailyCap:0,enableLost:false});
  const published=first.cards.filter(c=>c.vulnerability);
  assert.equal(published.length,2);assert.ok(published.every(c=>c.kind==='worry'));
  const again=run(first.goals,first.cards,base,{dailyCap:0,enableLost:false});
  assert.equal(again.publishedResults,0);
});
