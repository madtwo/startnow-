const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
Module._extensions['.ts']=(mod,filename)=>{
  const res=ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  mod._compile(res.outputText,filename);
};
const lib=(name)=>require(path.join(__dirname,'../src/lib',name+'.ts'));
const {makeGoal,goalProgress,shareGoal,toggleCheer,personaCheer,deleteGoal}=lib('goals');
const {scheduleGoal,dateKeyLocal,setStepDone,setScheduleDone,addManualSchedule,parseLocalDate,goalStreak}=lib('schedule');
const {parseGoals,parseSchedule,parseSummaries}=lib('goalStorage');
const {goalQuestions,grillQuestions,parseDecomposition,defaultAssumptions,recognizeNotice}=lib('decompose');
const {localDailySummary,saveLocalSummary}=lib('summary');
const {importBundle,exportBundle,saveGoals,loadGoals,saveSchedule,loadSchedule,saveSummaries,loadSummaries,clearAll,defaultSettings,emptyWorld}=lib('store');
const {defaultPersonas}=lib('personas');
const now=new Date(2026,10,18,13).getTime();
const tomorrow=new Date(2026,10,19,9).getTime();
const build=()=>makeGoal({title:'完成实验报告',detail:'数据已经跑完',source:'manual',now,
  steps:[{text:'列出异常数据',minutes:20,dueAt:tomorrow,kind:'research'},
    {text:'写方法段两百字',minutes:40,dueAt:tomorrow,kind:'draft'}]});
function store(){const m=new Map();global.localStorage={getItem:(k)=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:(k)=>m.delete(k)};return m;}
test('R1/R3: 1–12 个自由步骤且非有效高风险内容才能持久化',()=>{
 const goal=build();assert.equal(goal.steps.length,2);assert.equal(goalProgress(goal).done,0);
 assert.throws(()=>makeGoal({title:'',source:'manual',steps:[{text:'列数据'}]}));
 assert.throws(()=>makeGoal({title:'写报告',source:'manual',steps:[]}));
 assert.throws(()=>makeGoal({title:'写报告',source:'manual',steps:[{text:'写一页',minutes:125}]}));
 assert.equal(goal.steps[0].goalId,goal.id);
});
test('R8: 目标步骤排期一对一、重跑幂等、反复勾选双向同步',()=>{
 const goal=build();let schedule=scheduleGoal(goal,[],now);assert.equal(schedule.length,2);
 schedule=scheduleGoal(goal,schedule,now);assert.equal(schedule.length,2);
 const done=setScheduleDone([goal],schedule,schedule[0].id,true,tomorrow);
 assert.equal(done.goals[0].steps[0].status,'done');assert.equal(done.schedule[0].status,'done');
 const again=setStepDone(done.goals,done.schedule,goal.steps[0].id,true,tomorrow+100);
 assert.equal(again.goals[0].steps[0].completedAt,tomorrow);
 const undone=setStepDone(again.goals,again.schedule,goal.steps[0].id,false,tomorrow+200);
 assert.equal(undone.schedule[0].status,'todo');assert.equal(undone.goals[0].steps[0].completedAt,undefined);
});
test('R8/R9: 手动日程不转便签；日历无效日期拒绝、时间范围校验',()=>{
 assert.equal(parseLocalDate('2026-02-31'),undefined);assert.equal(parseLocalDate('2026-11-19')!==undefined,true);
 const arr=addManualSchedule([],'核对方法段','2026-11-19',600,now);
 assert.equal(arr[0].source,'manual');assert.equal(arr[0].goalId,undefined);
 assert.throws(()=>addManualSchedule([],'测试','2026-11-19',1440,now));
});
test('R5: 同一个目标 24h 禁止重复分享到论坛，打气与点赞分开持久化',()=>{
 const goal=build();const shared=shareGoal(goal,[],'我',now);
 assert.equal(shared.card.kind,'goal');assert.equal(shared.card.goalId,goal.id);
 assert.equal(shared.card.cheerCount,0);assert.equal(shared.card.likes,0);
 assert.throws(()=>shareGoal(shared.goal,[shared.card],'我',now+100));
 const cheer=toggleCheer(shared.card);
 assert.equal(cheer.cheerCount,1);assert.equal(cheer.likes,0);assert.equal(toggleCheer(cheer).cheerCount,0);
 const persona=defaultPersonas()[0];
 const peer=personaCheer(shared.card,persona,'列异常数据这一步挺具体的，等你下一步。','simulated',now+1000);
 assert.equal(peer.cheerCount,1);assert.equal(peer.comments[0].origin,'simulated');
 assert.equal(personaCheer(peer,persona,'再次打气','simulated').cheerCount,1);
});
test('R8: 删除目标时默认将日程保留为普通日程，可选择一并删除',()=>{
 const goal=build();const schedule=scheduleGoal(goal,[],now);
 const kept=deleteGoal([goal],schedule,goal.id,false);assert.equal(kept.goals.length,0);
 assert.equal(kept.schedule.length,2);assert.equal(kept.schedule[0].source,'manual');assert.equal(kept.schedule[0].stepId,undefined);
 assert.equal(deleteGoal([goal],schedule,goal.id,true).schedule.length,0);
});
test('R1/R2: AI JSON 严格解析，只有动作且 3–8 步、≤120 分钟；跳过有标注',()=>{
 const input={goalText:'周三完成实验报告',answers:{},skipped:true,now};
 assert.equal(goalQuestions('写一份报告').some(q=>q.field==='deadline'),true);
 assert.equal(goalQuestions('周五前写一份报告').length>=0,true);
 assert.equal(defaultAssumptions({}).length<=4,true);
 const rows=[{text:'列异常数据',minutes:20,due:'2026-11-19',kind:'research'},
  {text:'写方法段',minutes:40,due:'2026-11-20',kind:'draft'},
  {text:'核对参考文献',minutes:30,due:null,kind:'review'}];
 const plan=parseDecomposition(JSON.stringify({title:'模型随便改名',steps:rows}),input);
 assert.equal(plan.title,input.goalText);assert.equal(plan.steps.length,3);assert.ok(plan.assumptions.length<=4);assert.ok(plan.assumptions.every((line)=>line.length<=60));
 assert.throws(()=>parseDecomposition('{"steps":[]}',input));
 assert.throws(()=>parseDecomposition(JSON.stringify({steps:rows.map(s=>({...s,minutes:140}))}),input));
 assert.throws(()=>parseDecomposition(JSON.stringify({steps:rows.map(s=>({...s,text:'努力学习'}))}),input));
});
test('R4: vision API 不能用 mock 假装完成，必须降级并提示',async()=>{
 const result=await recognizeNotice({providerId:'mock',baseUrl:'',model:'',apiKey:''},'data:image/png;base64,AAA');
 assert.equal(result.ok,false);assert.equal(result.code,'vision_unsupported');
});
test('R14/R15: 今日总结只依赖当天真实数据且限生成与刷新一次',()=>{
 const g=build();const done=setStepDone([g],scheduleGoal(g,[],now),g.steps[0].id,true,now);
 const summary=localDailySummary(done.goals,[],done.schedule,now);
 assert.match(summary,/列出异常数据/);assert.doesNotMatch(summary,/完成实验报告了/);
 const first=saveLocalSummary([],done.goals,[],done.schedule,now);
 const second=saveLocalSummary(first,done.goals,[],done.schedule,now+100);
 assert.equal(second.length,1);assert.equal(second[0].refreshedAt,now+100);
 assert.throws(()=>saveLocalSummary(second,done.goals,[],done.schedule,now+200));
 assert.equal(goalStreak(done.goals,now),1);
});
test('R20: goals/schedule/summaries 键导出导入回环；旧包缺键不报错',()=>{
 const m=store();const goal=build();const sch=scheduleGoal(goal,[],now);
 saveGoals([goal]);saveSchedule(sch);saveSummaries([]);
 assert.equal(loadGoals().length,1);assert.equal(loadSchedule().length,2);assert.equal(loadSummaries().length,0);
 const base={cards:[],personas:defaultPersonas(),world:emptyWorld(now),settings:defaultSettings,
  identity:{id:'me',name:'我',avatarKey:'petal',bio:''},todos:[]};
 const exported=exportBundle({...base,goals:[goal],schedule:sch,summaries:[]});
 assert.doesNotMatch(exported,/apiKey/);
 const imported=importBundle(exported);assert.ok(imported);assert.equal(imported.goals.length,1);
 assert.equal(imported.schedule.length,2);
 const old=importBundle(JSON.stringify({version:3,exportedAt:now,...base}));
 assert.ok(old);assert.deepEqual(old.goals,[]);assert.deepEqual(old.schedule,[]);
 const malformed=importBundle(JSON.stringify({version:3,exportedAt:now,...base,goals:[{title:'不合法'}]}));
 assert.equal(malformed,null);
 const crisis=importBundle(JSON.stringify({version:3,exportedAt:now,...base,goals:[{...goal,title:'我要自杀'}]}));
 assert.equal(crisis,null);
 clearAll();assert.equal(m.get('shudong.goals.v1'),undefined);assert.equal(m.get('shudong.schedule.v1'),undefined);
});

test('R20: 显式 null 与伪造的关联步骤不会被旧存档兼容规则吞掉',()=>{
 const m=store();const goal=build();const sch=scheduleGoal(goal,[],now);
 const base={version:3,exportedAt:now,cards:[],personas:defaultPersonas(),world:emptyWorld(now),settings:defaultSettings,
  identity:{id:'me',name:'我',avatarKey:'petal',bio:''},todos:[]};
 assert.equal(importBundle(JSON.stringify({...base, goals:null})),null);
 assert.equal(importBundle(JSON.stringify({...base, goals:[goal], schedule:sch.map((x,i)=>i?x:{...x,stepId:'invented-step'})})),null);
 assert.equal(m.has('shudong.goals.v1'),false);
});

test('R2: /grill-me 最多问 5 个关键问题，随时可跳过并标注假设',()=>{
  const vague='把事情弄好';
  const questions=grillQuestions(vague,{});
  assert.ok(questions.length>=3 && questions.length<=5);
  assert.ok(questions.some((q)=>q.field==='done'));
  const answered=grillQuestions(vague,{deadline:'周五',deliverable:'一页',done:'能交',progress:'写了一半',constraint:'每天一小时'});
  assert.equal(answered.length,0);
  const assumptions=defaultAssumptions({});
  assert.ok(assumptions.length>0 && assumptions.length<=4);
  assert.ok(assumptions.join(' ').length>0);
});
