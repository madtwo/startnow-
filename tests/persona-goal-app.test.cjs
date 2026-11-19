/** R2: pure scheduling, revision guard and idempotent card merge. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const lib=(name)=>require(path.join(__dirname,'../src/lib',name+'.ts'));
const {PERSONA_GOAL_CHECK_MS,shouldCheckPersonaGoals,canCommitPersonaGoals,mergeNewPersonaCards}=lib('personaGoalSchedule');
const {tickPersonaGoals}=lib('personaGoals');
const {defaultPersonas}=lib('personas');
const now=new Date(2026,10,19,12).getTime();

test('R2: 59999 does not trigger, 60000 triggers, first check immediate',()=>{
 assert.equal(PERSONA_GOAL_CHECK_MS,60000);
 assert.equal(shouldCheckPersonaGoals(0,now,false),true);
 assert.equal(shouldCheckPersonaGoals(now-59999,now,false),false);
 assert.equal(shouldCheckPersonaGoals(now-60000,now,false),true);
});

test('R2: paused and brag-only never advance persona story',()=>{
 assert.equal(shouldCheckPersonaGoals(0,now,true,false),false);
 assert.equal(shouldCheckPersonaGoals(0,now,false,true),false);
 assert.equal(shouldCheckPersonaGoals(now-60000,now,true,true),false);
});

test('R2: stale operation revision rejects both cards and goals writes',()=>{
 const cards=[],goals=[];let revision=5;
 const gate={isCurrent:(_id,r)=>revision===r};
 const expected=revision;
 revision++;
 assert.equal(canCommitPersonaGoals({revisionCurrent:gate.isCurrent('tick',expected),
  baseCards:cards,currentCards:cards,baseGoals:goals,currentGoals:goals}),false);
});

test('R2: newly saved goal or newly posted card rejects stale snapshot',()=>{
 const goals=[],cards=[];
 const base={revisionCurrent:true,baseCards:cards,currentCards:cards,baseGoals:goals,currentGoals:goals};
 assert.equal(canCommitPersonaGoals(base),true);
 assert.equal(canCommitPersonaGoals({...base,currentGoals:[{id:'user-new'}]}),false);
 assert.equal(canCommitPersonaGoals({...base,currentCards:[{id:'user-new'}]}),false);
});

test('R2: post new AI cards without replacing latest user likes/comments or duplicating IDs',()=>{
 const user={id:'user',authorId:'me',comments:[{id:'comment'}],likes:2};
 const ai={id:'ai',authorId:'shenmo',comments:[],likes:0};
 const merged=mergeNewPersonaCards([user],[ai,user]);
 assert.deepEqual(merged.map(c=>c.id),['ai','user']);
 assert.equal(merged[1],user);
 assert.equal(merged[1].comments.length,1);assert.equal(merged[1].likes,2);
 assert.equal(mergeNewPersonaCards(merged,[ai]).length,2);
});

test('R2: repeated checks 60000ms apart produce exactly one round of daily goals',()=>{
 const personas=defaultPersonas();let goals=[],cards=[],last=0,created=0;
 for(let t of [now,now+1000,now+60000,now+120000]){
  if(!shouldCheckPersonaGoals(last,t,false,false)) continue;
  const result=tickPersonaGoals({goals,cards,personas,now:t,enabled:true});
  goals=result.goals;cards=result.cards;last=t;created+=result.createdGoals;
 }
 assert.equal(created,4);
 assert.equal(goals.length,4);
 assert.equal(cards.filter(c=>c.kind==='goal').length,4);
});

test('R2: App wiring includes local-first check, tick revision guard and no extra model request',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');
 assert.match(code,/lastPersonaGoalCheck/);
 assert.match(code,/localPersonaWritePending\.current/);
 assert.match(code,/shouldCheckPersonaGoals\(/);
 assert.match(code,/canCommitPersonaGoals\(/);
 assert.match(code,/setCards\(personaResult \? personaResult\.cards : out\.cards\)/);
 assert.match(code,/checkPersonaGoalsLocally\(\)/);
 assert.doesNotMatch(code,/AI 虚构剧情/);
});
