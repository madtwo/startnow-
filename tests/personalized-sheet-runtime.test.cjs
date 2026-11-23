'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const path=require('node:path');
const ts=require('typescript');
Module._extensions['.tsx']=(mod,filename)=>{
 const out=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
 mod._compile(out.outputText,filename);
};
let active=null;
const react={
 useState:(init)=>active.useState(init),
 useRef:(init)=>active.useRef(init),
 useMemo:(fn)=>{active.i++;return fn()},
 useEffect:()=>{active.i++},
};
const JSX={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
let questionKind='initial', questionError=false;
let questionHold=false, questionPending=null, followupResponses=[];
let initialQuestions=[
 {id:'progress',field:'progress',question:'最近一次12分钟测试是多少米？',chips:['还未测过','约2000米']},
 {id:'done',field:'done',question:'学校的满分标准是多少米？',chips:['还没查','约2600米']},
];
let followups=[];
const p={
 answeredPersonalizedQuestions:(rounds,answers)=>rounds.flat().filter(q=>answers[q.id]).map(q=>({id:q.id,question:q.question,answer:answers[q.id]})),
 personalizedQuestionHistory:(rounds,answers)=>rounds.flat().map(q=>({id:q.id,question:q.question,answer:answers[q.id]||''})),
 localPersonalizedQuestions:()=>initialQuestions,
 localPersonalizedPlan:(goal)=>({title:goal,assumptions:['本地示例步骤，非模型'],steps:[{text:'查标准',minutes:10},{text:'测一次',minutes:20},{text:'安排训练',minutes:15}]}),
 requestPersonalizedQuestions:async ({stage,onModelAttempt})=>{
  onModelAttempt();questionKind=stage;
  if(questionError)throw new Error('offline');
  if(stage==='followup' && questionHold)return await new Promise((resolve,reject)=>{
   questionPending={resolve,reject};});
  return stage==='initial'?initialQuestions:(followupResponses.length?followupResponses.shift():followups);
 },
};
let pending=null;let captured=null;
const plan={title:'十二分钟跑满分',assumptions:[],steps:[{text:'查满分标准',minutes:15},{text:'记录12分钟跑距离',minutes:20},{text:'安排训练',minutes:15}]};
const deps={
 '../lib/decompose':{
  decomposeViaApi:(_config,input)=>{captured=input;return new Promise((resolve,reject)=>{
   pending={resolve,reject,signal:input.signal};
   input.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })},
  estimateDailyEffort:()=>({totalMinutes:50,days:3,dailyMinutes:17,heavy:false,isDeadlineConfirmed:false}),
  goalQuestions:()=>[],recognizeNotice:async()=>({ok:false}),
 },
 '../config/providers':{isMock:(cfg)=>cfg.providerId==='mock',isReady:(cfg)=>!!cfg.apiKey||cfg.providerId==='mock'},
 '../lib/personalizedQuestions':p,
 '../lib/llm':{scrubSecrets:(msg)=>msg},
 '../lib/noticeFields':{buildNoticeAppend:()=>({ok:false,message:'none'})},
 '../lib/submissionGuard':{containsCrisis:(texts)=>texts.some(t=>/我要自杀/.test(String(t)))},
 '../lib/image':{fileToImage:async()=>''},
 '../lib/schedule':{dateKeyLocal:()=>'',parseLocalDate:()=>undefined},
 '../lib/decomposeDraft':{DECOMPOSE_DRAFT_KEY:'draft',readDecomposeDraft:()=>({goal:'十二分钟跑满分',confirmedDeadline:'',manualSteps:'',mode:'grill',answers:{}}),saveDecomposeDraft:()=>{}},
};
const oldLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='react')return react;
 if(request==='react/jsx-runtime')return JSX;
 const file=String(parent?.filename||'').replace(/\\/g,'/');
 if(file.endsWith('/components/DecomposeSheet.tsx') && Object.hasOwn(deps,request))return deps[request];
 return oldLoad.apply(this,arguments);
};
const Comp=require(path.resolve(__dirname,'../src/components/DecomposeSheet.tsx')).default;
Module._load=oldLoad;
const storage=new Map();
global.localStorage={getItem:(k)=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:(k)=>storage.delete(k)};
class Harness {
 constructor(config={providerId:'compatible',apiKey:'dummy'}){
  this.slots=[];this.i=0;this.saved=[];this.notifications=0;this.failures=0;this.crisis=0;this.reserved=[];this.events=[];
  this.props={open:true,config,onClose:()=>{this.props.open=false},
   onBackgroundReady:()=>this.notifications++,onBackgroundFailed:()=>this.failures++,
   onBackgroundState:(event)=>this.events.push(event),onCrisis:()=>this.crisis++,
   onSave:(input,schedule)=>this.saved.push({input,schedule}),onModelAttempt:(kind)=>this.reserved.push(kind)};
 }
 useState(init){const i=this.i++;if(!(i in this.slots))this.slots[i]=typeof init==='function'?init():init;
  return [this.slots[i],(next)=>{this.slots[i]=typeof next==='function'?next(this.slots[i]):next}];}
 useRef(init){const i=this.i++;if(!(i in this.slots))this.slots[i]={current:init};return this.slots[i]}
 render(){active=this;this.i=0;return Comp(this.props)}
 find(predicate){const node=this.render();const search=(item)=>{
  if(!item||typeof item!=='object')return null;
  if(Array.isArray(item)){for(const child of item){const hit=search(child);if(hit)return hit;}return null;}
  if(predicate(item))return item;return search(item.props?.children)
 };return search(node)}
 click(text){const btn=this.find((node)=>node.type==='button' && (textOf(node)===text || node.props?.['aria-label']===text));
  if(!btn)throw new Error(`Button not found: ${text}`);btn.props.onClick();}
 input(value){const field=this.find((node)=>node.type==='input' && node.props?.id==='grill-progress');
  if(!field)throw new Error('missing progress input');field.props.onChange({target:{value}})}
}
function textOf(node){if(typeof node==='string'||typeof node==='number')return String(node);
 if(Array.isArray(node))return node.map(textOf).join('');if(!node||typeof node!=='object')return '';
 return textOf(node.props?.children);
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const setup=()=>{pending=null;captured=null;questionError=false;questionHold=false;questionPending=null;followupResponses=[];followups=[];return new Harness()};

test('R1/R2 runtime: initial model questions, chips, answers and [] directly create plan',async()=>{
 const h=setup();h.click('开始拆解');await flush();
 assert.match(textOf(h.render()),/模型生成的问题/);
 h.input('2300米');h.click('继续');await flush();
 assert.equal(questionKind,'followup');assert.equal(h.reserved.length,3);
 assert.ok(pending);assert.equal(captured.personalized,true);
 assert.equal(captured.answers.progress,'2300米');
 assert.equal(captured.notes[0].answer,'2300米');
 pending.resolve(plan);await flush();
 assert.ok(h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1'&&node.props.value==='查满分标准'));
});
test('R3 runtime: close during request does not abort; background toast and reopen preview',async()=>{
 const h=setup();h.click('开始拆解');await flush();
 h.click('立刻拆解');await flush();
 assert.ok(pending);h.click('关闭');
 assert.equal(h.props.open,false);assert.equal(pending.signal.aborted,false);
 assert.equal(h.render(),null);
 pending.resolve(plan);await flush();
 assert.equal(h.notifications,1);assert.equal(h.failures,0);
 h.props.open=true;
 assert.ok(h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1'&&node.props.value==='查满分标准'));
 assert.ok(h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1'));
});
test('R3 runtime: only explicit cancellation aborts and never persists cancelled plan',async()=>{
 const h=setup();h.click('开始拆解');await flush();
 h.click('立刻拆解');await flush();
 assert.ok(pending);h.click('取消拆解（保留输入）');await flush();
 assert.equal(pending.signal.aborted,true);
 assert.equal(h.notifications,0);assert.equal(h.saved.length,0);
 assert.match(textOf(h.render()),/开始拆解/);
});
test('R2 runtime: model may add followup then receives previous answers',async()=>{
 const h=setup();followups=[{id:'schedule_run',question:'本周哪天有时间练？',chips:['周三','周末']}];
 h.click('开始拆解');await flush();h.input('2200米');h.click('继续');await flush();
 assert.match(textOf(h.render()),/本周哪天有时间练/);
 const chip=h.find(node=>node.type==='button'&&textOf(node)==='周末');chip.props.onClick();
 followups=[];h.click('继续');await flush();
 assert.ok(pending);assert.equal(captured.notes.length,2);assert.equal(captured.notes[0].answer,'2200米');
 assert.equal(captured.notes[1].answer,'周末');
 pending.resolve(plan);await flush();
});
test('R5 runtime: no API mode shows local origin and allows an editable local plan',async()=>{
 const h=setup();h.props.config={providerId:'mock',apiKey:''};
 h.click('开始拆解');await flush();
 assert.match(textOf(h.render()),/本地降级问题/);
 h.click('继续');await flush();
 assert.match(textOf(h.render()),/本地示例步骤/);
 assert.equal(h.reserved.length,0);
});
test('R5 runtime: model question failure explicitly labelled local fallback',async()=>{
 const h=setup();questionError=true;
 h.click('开始拆解');await flush();
 assert.match(textOf(h.render()),/本地降级问题/);
 assert.match(textOf(h.render()),/模型问题生成失败/);
});
test('R5 runtime: crisis goal prevents starting standard plan',async()=>{
 const h=setup();const entry=h.find(node=>node.type==='textarea' && node.props?.maxLength===2000);
 entry.props.onChange({target:{value:'我要自杀'}});
 h.click('开始拆解');await flush();
 assert.equal(h.crisis,1);assert.equal(h.reserved.length,0);
 assert.equal(pending,null);
});

test('R2 runtime: three followup rounds are the hard limit; fourth Continue decomposes',async()=>{
 const h=setup();followupResponses=[1,2,3].map(i=>[{id:`r${i}_train`,question:`第${i}轮你还能留多少训练时间？`,chips:['十分钟','半小时']}]);
 h.click('开始拆解');await flush();
 for(let i=0;i<3;i++){h.click('继续');await flush();assert.match(textOf(h.render()),new RegExp(`第${i+1}轮`));}
 assert.match(textOf(h.render()),/已追问 3\/3 轮/);
 const before=h.reserved.length;h.click('继续');await flush();
 assert.ok(pending);assert.equal(h.reserved.length,before+1);
 pending.resolve(plan);await flush();
});
test('R2 runtime: immediate decompose while model deciding aborts decision, not new plan',async()=>{
 const h=setup();questionHold=true;h.click('开始拆解');await flush();
 h.click('继续');await flush();
 assert.ok(questionPending);assert.match(textOf(h.render()),/正在判断/);
 h.click('立刻拆解');await flush();
 assert.ok(pending);pending.resolve(plan);await flush();
 assert.ok(h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1'));
});
test('R3 runtime: background failure produces notification and retains local-plan recovery',async()=>{
 const h=setup();h.click('开始拆解');await flush();h.click('立刻拆解');await flush();
 h.click('关闭');pending.reject(new Error('upstream failed'));await flush();
 assert.equal(h.failures,1);assert.equal(h.notifications,0);
 h.props.open=true;assert.match(textOf(h.render()),/模型|重试/);
 h.click('使用本地示例步骤（非模型）');
 assert.match(textOf(h.render()),/本地示例步骤/);
});
test('R3/R4 runtime: edit, uncheck, save plan; only checked steps passed onward',async()=>{
 const h=setup();h.click('开始拆解');await flush();h.click('立刻拆解');await flush();
 pending.resolve(plan);await flush();
 const input=h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1');
 input.props.onChange({target:{value:'查看学校满分标准'}});
 const check=h.find(node=>node.type==='input'&&node.props?.['aria-label']==='采纳步骤 2');
 check.props.onChange({target:{checked:false}});
 h.click('只保存不排日程');
 assert.equal(h.saved.length,1);assert.equal(h.saved[0].schedule,false);
 assert.equal(h.saved[0].input.steps.length,2);assert.equal(h.saved[0].input.steps[0].text,'查看学校满分标准');
 assert.equal(h.props.open,false);
 h.props.open=true;assert.match(textOf(h.render()),/开始拆解/);
});


test('Orb wiring runtime: closed active request updates running -> ready and reopens cached preview',async()=>{
 const h=setup();h.click('开始拆解');await flush();
 assert.equal(h.events.at(-1).status,'running');
 h.click('立刻拆解');await flush();
 assert.equal(h.events.at(-1).stage,'requesting');
 const originalPending=pending;h.click('关闭');
 assert.equal(originalPending.signal.aborted,false);
 originalPending.resolve(plan);await flush();
 assert.equal(h.events.at(-1).status,'ready');
 assert.equal(h.events.at(-1).seen,false);
 h.props.open=true;
 assert.ok(h.find(node=>node.type==='input'&&node.props?.['aria-label']==='步骤 1'));
 assert.equal(pending,originalPending,'reopening must not create another request');
});

test('Orb wiring runtime: closing during question generation -> waiting questions, no false progress',async()=>{
 const h=setup();h.click('开始拆解');
 assert.equal(h.events.at(-1).stage,'loadingQuestions');
 h.click('关闭');await flush();
 assert.equal(h.events.at(-1).stage,'questions');
 assert.equal(h.events.at(-1).status,'running');
 assert.equal(h.notifications,0);
 h.props.open=true;
 assert.match(textOf(h.render()),/模型生成的问题/);
});

test('Orb wiring runtime: explicit cancellation resets orb state and stale settle cannot revive',async()=>{
 const h=setup();h.click('开始拆解');await flush();h.click('立刻拆解');await flush();
 const doomed=pending;h.click('关闭');h.props.open=true;h.click('取消拆解（保留输入）');
 assert.equal(doomed.signal.aborted,true);
 assert.equal(h.events.at(-1).status,'idle');
 doomed.resolve(plan);await flush();
 assert.equal(h.events.at(-1).status,'idle');
 assert.equal(h.notifications,0);assert.equal(h.saved.length,0);
});

test('Orb wiring runtime: failed request reports failed rather than ready, retains retry entry',async()=>{
 const h=setup();h.click('开始拆解');await flush();h.click('立刻拆解');await flush();
 h.click('关闭');pending.reject(new Error('offline'));await flush();
 assert.equal(h.events.at(-1).status,'failed');
 assert.equal(h.events.at(-1).seen,false);
 assert.equal(h.failures,1);assert.equal(h.notifications,0);
 h.props.open=true;assert.match(textOf(h.render()),/模型|重试/);
});

test('Orb wiring runtime: manual/local plans and save report correct status',async()=>{
 const h=setup();h.props.config={providerId:'mock',apiKey:''};
 h.click('开始拆解');await flush();h.click('继续');await flush();
 assert.equal(h.events.at(-1).status,'ready');
 assert.equal(h.events.at(-1).seen,true);
 h.click('只保存不排日程');
 assert.equal(h.events.at(-1).status,'idle');
});

test('Orb wiring runtime: crisis aborts normal plan and leaves idle state',async()=>{
 const h=setup();const field=h.find(node=>node.type==='textarea'&&node.props?.maxLength===2000);
 field.props.onChange({target:{value:'我要自杀'}});
 h.click('开始拆解');await flush();
 assert.equal(h.crisis,1);assert.equal(h.events.at(-1).status,'idle');
 assert.equal(pending,null);
});

test('runtime: restart clears answers, keeps the goal, and starts from question one again',async()=>{
 const h=setup();h.click('开始拆解');await flush();
 h.input('2300米');await flush();
 h.click('重新拆解');await flush();
 const entry=textOf(h.render());
 assert.match(entry,/开始拆解/);
 const goal=h.find(node=>node.type==='textarea'&&node.props?.maxLength===2000);
 assert.equal(goal.props.value,'十二分钟跑满分');
 h.click('开始拆解');await flush();
 const field=h.find(node=>node.type==='input'&&node.props?.id==='grill-progress');
 assert.equal(field.props.value,'');
});
