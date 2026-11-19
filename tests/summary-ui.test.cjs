/** R4: fact-only summary, optional one-line model, max one refresh. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const lib=name=>require(path.join(__dirname,'../src/lib',name+'.ts'));
const {localDailySummary,generateDailySummary,saveGeneratedSummary}=lib('summary');
const {makeGoal,makePersonaGoal}=lib('goals');
const {defaultPersonas}=lib('personas');
const now=new Date(2026,10,19,15).getTime();
const own=makeGoal({title:'写完一段报告',source:'manual',now,
 steps:[{text:'核对第一行数据'}]});
const done={...own,steps:own.steps.map(s=>({...s,status:'done',completedAt:now}))};
const goalAi=makePersonaGoal({persona:defaultPersonas()[0],title:'看一页笔记',
 steps:[{text:'写出一个考点'}],now});
const doneAi={...goalAi,steps:goalAi.steps.map(s=>({...s,status:'done',completedAt:now}))};
const cards=[{id:'user',authorId:'me',createdAt:now,comments:[]}];

test('R4: no generator uses local statistics only',async()=>{
 const out=await generateDailySummary({goals:[done],cards,schedule:[],now});
 assert.equal(out.origin,'local');
 assert.equal(out.text,localDailySummary([done],cards,[],now));
});

test('R4: rejects >32 characters and numeric model inventions',async()=>{
 for(const line of ['很长的一句话'.repeat(12),'今天有3个目标已经做完了！','今天一共写了三行。']){
  const out=await generateDailySummary({goals:[done],cards,schedule:[],now,generate:async()=>line});
  assert.equal(out.origin,'local');
 }
});

test('R4: rejects invented persona names, absolute growth claims, and two sentences',async()=>{
 for(const line of ['沈默已经替你完成了。','你获得了成长与蜕变。','先歇一会儿。再来一次。']){
  const out=await generateDailySummary({goals:[done],cards,schedule:[],now,generate:async()=>line});
  assert.equal(out.origin,'local');
 }
});

test('R4: first generation and one refresh succeed; third throws',async()=>{
 const first=await generateDailySummary({goals:[done],cards,schedule:[],now,generate:async()=> '停一停也可以，别急。'});
 assert.equal(first.origin,'model');
 const saved=saveGeneratedSummary([],{...first,now});
 const second=saveGeneratedSummary(saved,{...first,now:now+1000});
 assert.equal(saved[0].refreshedAt,undefined);
 assert.equal(second[0].refreshedAt,now+1000);
 assert.throws(()=>saveGeneratedSummary(second,{...first,now:now+2000}),/今日总结已经刷新过一次/);
});

test('R4: valid model adds exactly one line without touching verified facts',async()=>{
 const facts=localDailySummary([done],cards,[],now);
 const line='停一停也可以，别急。';
 const result=await generateDailySummary({goals:[done],cards,schedule:[],now,generate:async()=>line});
 assert.equal(result.origin,'model');assert.equal(result.text,`${facts}\n${line}`);
});

test('R4: AI-fiction completed step and AI schedule never enter player facts',()=>{
 const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);
 const sched=[{id:'ai',ownerId:'shenmo',dateKey:new Date(tomorrow).toLocaleDateString('sv-SE'),
  status:'todo',title:'AI 的明日安排'}];
 const output=localDailySummary([done,doneAi],cards,sched,now);
 assert.match(output,/核对第一行数据/);
 assert.doesNotMatch(output,/写出一个考点|AI 的明日安排/);
});

test('R4: App uses existing streamChat and reserves exactly one summary budget, no mock impostor',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');
 assert.match(app,/generateDailySummary\(/);
 assert.match(app,/saveGeneratedSummary\(/);
 assert.match(app,/reserveMeetingCall\('summary'\)/);
 assert.match(app,/maxTokens: 240/);
 assert.match(app,/事实来自本地统计；模型只加一句衔接/);
 assert.match(app,/!isMock\(snapshot\.config\)/);
});
