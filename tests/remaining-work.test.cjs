const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'startnow-remaining-'));
fs.writeFileSync(path.join(tmp,'package.json'),'{'+'"type":"commonjs"}');
try {
  execFileSync(process.execPath,[path.join(root,'node_modules','typescript','bin','tsc'),
    '--strict','--target','ES2022','--module','commonjs',
    '--moduleResolution','node','--lib','ES2022,DOM','--rootDir',path.join(root,'src'),
    '--outDir',tmp, 'src/lib/goals.ts','src/lib/goalStorage.ts','src/lib/summary.ts'],
    {cwd:root,stdio:'pipe'});
} catch(err) { console.error(String(err.stdout||err.stderr||err)); throw err; }
const {makePersonaGoal,publishPersonaGoal,resultCardForGoal,createPersonaGoalCard}=require(path.join(tmp,'lib/goals.js'));
const {parseGoals}=require(path.join(tmp,'lib/goalStorage.js'));
const {generateDailySummary,saveGeneratedSummary}=require(path.join(tmp,'lib/summary.js'));
const members=[{id:'shenmo',name:'沈默'},{id:'weini',name:'魏霓'},
  {id:'miaoze',name:'苗泽'},{id:'yanggao',name:'杨槔'}];
const DAY=86400000;
const start=new Date(2026,10,19,10,0,0).getTime();
const sample=(p,now,goals)=>makePersonaGoal({persona:p,title:`${p.name}今天想完成实验报告的一小步`,
 steps:[{text:'打开文件'},{text:'核对一项数字'}],now},goals);

test('3-day persona simulation: per-owner <=3 and per-goal at-most-once result',()=>{
 let goals=[],cards=[];
 for(let day=0;day<3;day++){
   const now=start+day*DAY;
   for(const p of members){
     let g=sample(p,now,goals);
     const published=publishPersonaGoal(g,p.name,now);
     g=published.goal;goals.push(g); cards.push(published.card);
     assert.throws(()=>sample(p,now,goals),/已经有一项/);
     assert.equal(resultCardForGoal(g,cards,p.name,now),null);
     const result=resultCardForGoal(g,cards,p.name,g.postPlan.dueAt+1);
     assert.ok(result);
     goals[goals.length-1]=result.goal;cards.push(result.card);
     assert.equal(result.card.goalId,g.id);
     assert.equal(resultCardForGoal(result.goal,cards,p.name,g.postPlan.dueAt+10000),null);
     assert.match(result.card.text,/AI 虚构剧情/);
     if(result.card.kind==='brag') assert.ok(result.goal.steps.every(s=>s.status==='done'));
     else assert.ok(result.goal.steps.some(s=>s.status!=='done'));
   }
 }
 assert.equal(goals.length,12);
 assert.equal(cards.filter(c=>c.kind==='goal').length,12);
 assert.equal(cards.filter(c=>['brag','worry'].includes(c.kind)).length,12);
 for(const p of members) assert.equal(goals.filter(g=>g.ownerId===p.id).length,3);
 assert.deepEqual(parseGoals(goals),goals);
});

test('AI goal daily cap, safe validation, and no automatic goal on bad source',()=>{
 assert.throws(()=>makePersonaGoal({persona:members[0],title:'不想活了',steps:[{text:'打开文件'}],now:start}),/高风险/);
 assert.throws(()=>makePersonaGoal({persona:members[0],title:'安全目标',steps:[],now:start}),/1–3/);
 let g=sample(members[0],start,[]);
 const invalid={...g,postPlan:{outcome:'done',dueAt:start-1000}};
 assert.equal(parseGoals([invalid]),null);
 const forged={...g,source:'manual'};
 assert.equal(parseGoals([forged]),null);
 assert.throws(()=>createPersonaGoalCard({...g,ownerId:'me'},'我',start));
});

test('summary outputs only facts plus bounded optional model line',async()=>{
 const goal=sample(members[0],start,[]);
 const local=await generateDailySummary({goals:[goal],cards:[],schedule:[],now:start});
 assert.equal(local.origin,'local');
 assert.match(local.text,/本地统计/);
 const model=await generateDailySummary({goals:[goal],cards:[],schedule:[],now:start,
 generate:async()=> '没关系，慢慢来，今天可以停一会儿。'});
 assert.equal(model.origin,'model');
 const untrusted=await generateDailySummary({goals:[goal],cards:[],schedule:[],now:start,
 generate:async()=> '你今天已经完成了十个步骤，真是蜕变！'});
 assert.equal(untrusted.origin,'local');
 const first=saveGeneratedSummary([],{...model,now:start});
 const refreshed=saveGeneratedSummary(first,{...local,now:start+1000});
 assert.equal(refreshed.length,1);
 assert.ok(refreshed[0].refreshedAt);
 assert.throws(()=>saveGeneratedSummary(refreshed,{...local,now:start+2000}),/刷新过一次/);
});

test('invalid persisted AI postPlan must not round-trip into legitimate goals',()=>{
 const g=sample(members[0],start,[]);
 assert.equal(parseGoals([{...g,postPlan:{outcome:'success',dueAt:start+DAY}}]),null);
 assert.equal(parseGoals([{...g,resultCardId:77}]),null);
 assert.equal(parseGoals([g])[0].postPlan.dueAt,g.postPlan.dueAt);
});
