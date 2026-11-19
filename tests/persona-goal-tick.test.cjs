/** R1: deterministic, offline persona story clock. No API keys or browser needed. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), {fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText, file);
const lib = (name) => require(path.join(__dirname, '../src/lib', `${name}.ts`));
const { tickPersonaGoals, personaGoalHash, isSafePersonaGoalTemplate } = lib('personaGoals');
const { PERSONA_GOAL_TEMPLATES } = lib('personaGoalTemplates');
const { makePersonaGoal, publishPersonaGoal } = lib('goals');
const { defaultPersonas } = lib('personas');
const { parseGoals } = lib('goalStorage');
const { dateKeyLocal } = lib('schedule');
const { containsCrisis } = lib('submissionGuard');
const { auditSocial, auditTone, auditCriticalContent } = lib('baseline');
const people = defaultPersonas().slice(0,4);
const start = new Date(2026,10,19,9).getTime();
const run = (goals=[],cards=[],now=start,personas=people,enabled=true,dailyCap=4) =>
  tickPersonaGoals({goals,cards,personas,now,enabled,dailyCap});
const byDay = (list, now) => list.filter(g=>g.source==='ai' && dateKeyLocal(g.createdAt)===dateKeyLocal(now));

test('R1: three local days x four repeated ticks have <=1 goal per persona/day and <=4 total/day',()=>{
 let state={goals:[],cards:[]};
 for(let d=0;d<3;d++){
  const ts=new Date(2026,10,19+d,9).getTime();
  for(let i=0;i<8;i++) state=run(state.goals,state.cards,ts+i*1000);
  assert.equal(byDay(state.goals,ts).length,4);
  for(const p of people) assert.equal(byDay(state.goals,ts).filter(g=>g.ownerId===p.id).length,1);
 }
 assert.equal(state.goals.length,12);
 assert.equal(state.cards.filter(c=>c.kind==='goal').length,12);
});

test('R1: same instant repeat is idempotent and writes no duplicate cards',()=>{
 const a=run(); const b=run(a.goals,a.cards);
 assert.equal(a.createdGoals,4); assert.equal(b.createdGoals,0);
 assert.equal(b.publishedResults,0); assert.deepEqual(b.goals,a.goals); assert.deepEqual(b.cards,a.cards);
});

test('R1: no premature result; due result once even when run three times',()=>{
 const a=run(); const due=Math.min(...a.goals.map(g=>g.postPlan.dueAt));
 const before=run(a.goals,a.cards,due-1);
 assert.equal(before.publishedResults,0);
 const after=run(before.goals,before.cards,due);
 assert.ok(after.publishedResults>=1);
 const third=run(after.goals,after.cards,due+1);
 assert.equal(third.publishedResults,0);
 assert.equal(third.cards.length,after.cards.length);
 assert.equal(new Set(third.cards.map(c=>c.id)).size,third.cards.length);
});

test('R1: done -> brag/all done, partial -> worry/first done, missed -> worry/none',()=>{
 const person=people[0];
 const goal=makePersonaGoal({persona:person,title:'整理一项课程笔记',steps:[{text:'写下第一条'},{text:'标出第二条'}],now:start});
 const published=publishPersonaGoal(goal,person.name,start);
 for(const outcome of ['done','partial','missed']){
  const g={...published.goal,postPlan:{outcome,dueAt:start+1000}};
  const result=run([g],[published.card],start+1001,[person]);
  assert.equal(result.publishedResults,1);
  const resultCard=result.cards.find(c=>c.id===result.goals[0].resultCardId);
  assert.equal(resultCard.kind,outcome==='done'?'brag':'worry');
  assert.equal(resultCard.title.includes(outcome==='done'?'小小炫耀':'今天没做完'),true);
  const count=result.goals[0].steps.filter(s=>s.status==='done').length;
  assert.equal(count,outcome==='done'?2:outcome==='partial'?1:0);
  assert.notEqual(resultCard.authorId,'me');
 }
});

test('R1: disabled clock does not change goals/cards by value',()=>{
 const initial=run(); const paused=run(initial.goals,initial.cards,start+24*60*60*1000,people,false);
 assert.equal(paused.createdGoals,0);assert.equal(paused.publishedResults,0);
 assert.deepEqual(paused.goals,initial.goals);assert.deepEqual(paused.cards,initial.cards);
});

test('R1: all templates pass four local audits and are different for each persona',()=>{
 const allTitles=[];
 for(const p of people){
  const templates=PERSONA_GOAL_TEMPLATES[p.id];
  assert.ok(templates.length>=6 && templates.length<=8);
  for(const template of templates){
   assert.ok(isSafePersonaGoalTemplate(template),`${p.id}:${template.title}`);
   assert.equal(containsCrisis([template.title,...template.steps]),false);
   for(const line of [template.title,...template.steps]){
    assert.ok(!auditSocial(line) && !auditTone(line) && !auditCriticalContent(line),line);
   }
   allTitles.push(template.title);
  }
 }
 assert.equal(new Set(allTitles).size,allTitles.length);
});

test('R1: legacy player + AI goals without postPlan are retained, never rewritten',()=>{
 const ordinary=makePersonaGoal({persona:people[0],title:'整理一份记录',steps:[{text:'打开文件'}],now:start});
 const legacy={...ordinary,postPlan:undefined,sharedCardId:undefined};
 const player={...ordinary,id:'player1',ownerId:'me',source:'manual',postPlan:undefined,
  steps:ordinary.steps.map(s=>({...s,goalId:'player1'}))};
 const next=run([player,legacy],[],new Date(2026,10,20,9).getTime());
 assert.deepEqual(next.goals.slice(0,2),[player,legacy]);
 assert.equal(next.cards.some(c=>c.goalId==='player1'),false);
});

test('R1: output fits strict goal storage parser, never writes player Schedule/Todo/Summary',()=>{
 const a=run();
 const b=run(a.goals,a.cards,Math.max(...a.goals.map(g=>g.postPlan.dueAt))+1);
 assert.deepEqual(parseGoals(b.goals),b.goals);
 assert.equal('schedule' in b,false);
 assert.equal('summaries' in b,false);
 assert.equal('todos' in b,false);
});

test('R1: same persona/day selects the same template and never borrows another persona story',()=>{
 assert.equal(personaGoalHash('shenmo2026-11-19'),personaGoalHash('shenmo2026-11-19'));
 const a=run([],[],start,[people[0]]);
 const b=run([],[],start,[people[0]]);
 assert.equal(a.goals[0].title,b.goals[0].title);
 assert.ok(PERSONA_GOAL_TEMPLATES.shenmo.some(t=>t.title===a.goals[0].title));
});

test('R1: cap may tighten but never exceeds four, duplicate persona entries do not add extra goals',()=>{
 const once=run([],[],start,[people[0],people[0],...people],true,2);
 assert.equal(once.createdGoals,2);
 assert.equal(once.goals.filter(g=>g.source==='ai').length,2);
 const high=run([],[],start,people,true,8);
 assert.equal(high.createdGoals,4);
});
