/** R3: fictional cards do not enter player's completion/cheer chain. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const lib=name=>require(path.join(__dirname,'../src/lib',name+'.ts'));
const {defaultPersonas}=lib('personas');
const {makePersonaGoal,publishPersonaGoal,createPersonaGoalCard,resultCardForGoal,toggleCheer,personaCheer}=lib('goals');
const {tickCards,completeCard}=lib('cards');
const people=defaultPersonas();
const now=new Date(2026,10,19,9).getTime();
const create=(persona=people[0])=>{
 const goal=makePersonaGoal({persona,title:'把笔记整理出两条',steps:[{text:'找出一处问题'},{text:'写下一条笔记'}],now});
 return publishPersonaGoal(goal,persona.name,now);
};

test('R3: AI goal card has goal metadata without per-card AI-fiction label',()=>{
 const {goal,card}=create();
 assert.equal(card.authorKind,'persona');assert.equal(card.origin,'simulated');
 assert.equal(card.kind,'goal');assert.equal(card.goalId,goal.id);
 assert.ok(!card.text.includes('AI 虚构剧情'));
 assert.deepEqual(card.pending,[]);assert.deepEqual(card.arrivals,[]);
 assert.equal(card.likes,0);assert.equal(card.cheerCount,0);
});

test('R3: results keep origin metadata and never claim physical-world proof',()=>{
 const {goal,card}=create();
 for(const outcome of ['done','partial','missed']){
  const g={...goal,postPlan:{outcome,dueAt:now+1000}};
  const result=resultCardForGoal(g,[card],people[0].name,now+1001);
  assert.ok(result);
  assert.equal(result.card.origin,'simulated');
  assert.ok(!result.card.text.includes('AI 虚构剧情'));
  assert.equal(result.card.kind,outcome==='done'?'brag':'worry');
  assert.ok(result.card.title.includes(outcome==='done'?'小小炫耀':'今天没做完'));
  assert.doesNotMatch(result.card.text,/我真的做到了|我已经去了|老师夸我/);
 }
});

test('R3: toggling cheer only changes targeted AI card; likes and comments stay untouched',()=>{
 const first=create(people[0]).card,other=create(people[1]).card;
 const before=[first,other];const after=before.map(c=>c.id===first.id?toggleCheer(c):c);
 assert.equal(after[0].cheerCount,1);assert.equal(after[0].cheeredByMe,true);
 assert.equal(after[0].likes,0);assert.equal(after[0].comments.length,0);
 assert.equal(after[1],other);
 assert.equal(toggleCheer(after[0]).cheerCount,0);
});

test('R3: automated persona cheer accepts only player goal/progress, never AI card',()=>{
 const ai=create().card;
 assert.equal(personaCheer(ai,people[1],'加油','simulated'),ai);
});

test('R3: player done action must be a no-op on a crafted AI note',()=>{
 const ai=create().card;
 const crafted={...ai,status:'noted',note:{text:'误导性便签',fromPersonaId:'miaoze',at:now,dueAt:now+1000}};
 assert.equal(completeCard(crafted,now+2000),crafted);
});

test('R3: tickCards with simulated AI goal/result never schedules peers or comments',async()=>{
 const {goal,card}=create();
 const result=resultCardForGoal({...goal,postPlan:{outcome:'done',dueAt:now+1}},[card],people[0].name,now+2);
 assert.ok(result);
 const cards=[card,result.card];
 const out=await tickCards({cards,personas:people,config:{providerId:'mock',baseUrl:'',model:'',apiKey:''},
  settings:{paused:false,aiCardLimit:0,maxArrivals:0,dailyCalls:60,maxCallsPerTick:2,speed:6,baselineExtra:''},
  now:now+20*60_000});
 for(const c of cards){
  const updated=out.cards.find(x=>x.id===c.id);
  assert.ok(updated);assert.equal(updated.comments.length,0);
  assert.equal(updated.pending.length,0);assert.equal(updated.plan.length,0);
 }
});

test('R3: forum and detail keep goal tags but no per-card AI labels; player chain filters authorId',()=>{
 const row=fs.readFileSync(path.join(__dirname,'../src/components/CardRow.tsx'),'utf8');
 const detail=fs.readFileSync(path.join(__dirname,'../src/components/CardDetail.tsx'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');
 const summary=fs.readFileSync(path.join(__dirname,'../src/lib/summary.ts'),'utf8');
 assert.doesNotMatch(row,/AI 虚构剧情|AI 模拟结果|thread-badge">AI/);assert.match(row,/目标/);
 assert.doesNotMatch(detail,/AI 虚构剧情|AI 模拟结果/);assert.match(detail,/thread-badge">目标/);assert.match(detail,/fallback-note/);
 assert.match(detail,/mine && !isGuide && card\.note/);
 assert.match(app,/\.filter\(\(c\) => c\.authorId === 'me'\)/);
 assert.match(summary,/goals\.filter\(\(goal\) => goal\.ownerId === 'me'\)/);
});
