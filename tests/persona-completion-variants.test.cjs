// Actual tickRoom -> streamChat -> persisted domain state, replayed captured
// HTTP bodies and independent synthetic variants. No network / provider key.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const room=lib('room');
const people=lib('personas').defaultPersonas();
const now=new Date(2026,10,24,15,0).getTime();
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'replay',fallbackModel:'',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const tasks=['写一行开题笔记','把公式抄到卡片上','整理实验数据的第一列','给室友发一条沟通消息','把小组分工写成清单','准备面试自我介绍的第一段','投出一个实习岗位','列出文献综述的三个小标题','练习课程展示的开头两分钟','背五个专业名词'];
async function verify(task,raw,expected,{actionId,attempts=1}={}){
 const r=room.newRoom(people.slice(0,4),now,'C01 variant replay');
 const step={id:'c01-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(actionId===undefined?{}:{actionId})};
 const input={...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
 const oldFetch=global.fetch,oldRandom=Math.random;let calls=0;
 Math.random=()=>0.99;
 global.fetch=async url=>{assert.match(String(url),/^https:\/\/audit\.invalid\//);calls++;return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});};
 try{
  const out=await room.tickRoom({room:input,config,settings,now});const saved=out.room.steps.find(s=>s.id===step.id);
  assert.ok(saved);assert.equal(saved.text,task);assert.equal(saved.actionId,actionId);
  assert.equal(calls,attempts);assert.equal(out.calls,attempts);assert.equal(out.room.usage.messages,attempts);
  assert.equal(saved.doneAt,expected?now:undefined,`${task} / ${raw}`);
  if(expected){assert.equal(out.room.messages.length,1);assert.equal(out.room.messages[0].stepId,step.id);assert.equal(out.room.messages[0].text,raw.slice(5).trim());assert.equal(out.logs.length,0);}
  else{assert.equal(out.room.messages.length,0);assert.ok(saved.dueAt>=now+5*60000);assert.ok(out.logs.length);assert.ok(!out.logs.join(' ').includes(raw));}
 }finally{global.fetch=oldFetch;Math.random=oldRandom;}
}
// Source CSV is copied byte-for-byte from the independent review package.
// Its four columns contain no ASCII commas inside any cell. Fail closed if
// this frozen format changes; don't silently parse the labels incorrectly.
const csv=fs.readFileSync(path.join(__dirname,'fixtures','c01-real-output-2026-11-25.csv'),'utf8').replace(/^\uFEFF/,'');
const rows=csv.trimEnd().split(/\r?\n/).slice(1).map(line=>{const fields=line.split(',');assert.equal(fields.length,4);const [id,task,raw,label]=fields;assert.match(label,/^(接受|拒绝)（当前(?:误拒|正确)）$/u);return{id,task,raw,expected:label.startsWith('接受')};});
assert.equal(rows.length,30);assert.equal(new Set(rows.map(r=>r.id)).size,30);assert.equal(rows.filter(r=>r.expected).length,11);assert.equal(rows.filter(r=>!r.expected).length,19);
for(const {id,task,raw,expected} of rows)test(`review replay ${id} ${expected?'accept':'reject'}`,()=>verify(task,raw,expected));
// New wording, not copies of the reviewed outputs. For each task use multiple
// grammatical transformations and one or more scope/stage counterexamples.
const cases=[
 {ok:['我刚写完一行开题笔记','开题笔记已写了一行','已写1行开题笔记','一行开题笔记已经写好'],bad:['已写半行开题笔记','已写一行日记','刚写一行开题笔记的标题','已写一行开题笔记，没存好']},
 {ok:['公式已经抄到卡片上','公式卡片已抄好','卡片上已抄完公式','刚刚抄了三张公式卡片'],bad:['已抄半张公式卡片','公式已抄到草稿纸上','公式卡片刚写了标题','公式还没抄完']},
 {ok:['实验数据表的第一列已经整理完','表１第一列数据刚粘完','第一列数据已整理好','刚刚整理完第一列数据'],bad:['第二列数据已整理完','表2第一列粘完了','第一列数据只粘了两个格','第一列数据已粘完，没保存']},
 {ok:['我刚给室友发了一条沟通消息','给室友的沟通消息已经发出去了','给室友已发送一条消息','给室友发了条消息。'],bad:['给老师已发一条消息','给室友的消息已写好','给室友已发两条消息','给室友发了条消息，后来撤回了']},
 {ok:['小组分工清单已经写好，已发群里了','我刚列完小组分工清单','小组分工已写成清单','分工清单写好了，四个人两项任务写清了'],bad:['购物清单已列好','只写了分工清单标题','分工清单只写了一半','分工清单列完了，发群里失败']},
 {ok:['自我介绍的第一段已经准备好','刚刚写完面试自我介绍的第一段','面试自我介绍第一段已写完','第一段面试自我介绍刚写好'],bad:['自我介绍第二段已写好','自我介绍第一句已写好','面试自我介绍已准备好一半','自我介绍第一段已写好，重写']},
 {ok:['我已提交一份实习申请','一个实习岗位已经投递成功','简历已投出去了，等回复','我刚投递了1个实习岗位'],bad:['简历已改好，准备投递','两个实习岗位已投出去了','岗位页面已打开','简历已投出去了，尚未提交']},
 {ok:['我已列文献综述的三个小标题','文献综述3个小标题刚列完','刚刚写了三个小标题','已列好了甲状腺、循环、消化三个小标题'],bad:['文献综述两个小标题已列好','文献综述四个小标题已列好','已列好了甲、甲、甲三个小标题','已列好了标题、占位、待定三个小标题']},
 {ok:['课程展示开头2分钟已对着镜子练完一遍','对着镜子练完了课程展示的开头两分钟','刚练了两分钟课程展示的开头','课程展示开头两分钟已经对着镜子练了一遍'],bad:['课程展示开头半分钟已练完','开头两分钟只练了一句','对着镜子练习的准备已做好','开头两分钟练完了，可能没练完']},
 {ok:['我已经背了五个专业名词','五个专业术语已背下来','刚背完5个专业名词','已背五个专业术语'],bad:['已背四个专业术语','五个专业术语已抄完','五个专业名词只背了三个','五个专业名词已背完，差不多']},
];
for(const [i,c] of cases.entries()){
 for(const text of c.ok)test(`new positive C${i+1}: ${text}`,()=>verify(tasks[i],'DONE|'+text,true));
 for(const text of c.bad)test(`new negative C${i+1}: ${text}`,()=>verify(tasks[i],'DONE|'+text,false));
 // Negative protocol, future, negation, uncertainty and deletion must not be
 // removed by the controlled aspect rules. Use each new positive as seed.
 for(const [name,transform] of Object.entries({notDone:t=>'NOT_DONE|'+t,future:t=>'DONE|明天再'+t,negated:t=>'DONE|没有'+t,uncertain:t=>'DONE|可能'+t,deleted:t=>'DONE|'+t+'，后来删了',hidden:t=>'DONE|'+t+'\u2060',secondLine:t=>'DONE|'+t+'\nNOT_DONE|没完成',unreviewedTail:t=>'DONE|'+t+'，无关事情也做好了'})){
  test(`mutation ${name} C${i+1}`,()=>verify(tasks[i],transform(c.ok[0]),false));
 }
 // Same evidence, different task: no open similarity or generic DONE.
 test(`cross-task C${i+1}`,()=>verify(tasks[(i+1)%tasks.length],'DONE|'+c.ok[0],false));
}
// Fresh real-model outputs from 2026-11-25, not the reviewed historical set.
const fresh=[
 [0,'DONE|写了一行开题笔记，方向暂定规培'],
 [0,'DONE|在开题笔记里写了一行选题思路'],
 [5,'DONE|自我介绍第一段写好了，就等明天面试用'],
 [6,'DONE|简历投进了一个实习岗位'],
 [7,'DONE|三个小标题列好了，都是综述常用分类'],
 [9,'DONE|五个名词背下来了'],
];
for(const [i,raw] of fresh)test(`fresh positive C${i+1}: ${raw}`,()=>verify(tasks[i],raw,true));
test('fresh notes tail with unfinished direction stays rejected',()=>verify(tasks[0],'DONE|写了一行开题笔记，方向还没定',false));
test('fresh heading tail with unfinished count stays rejected',()=>verify(tasks[7],'DONE|三个小标题列好了，还差一个',false));
test('canonical data action accepts controlled first-column variant',()=>verify('新建表格，只粘第一列数据','DONE|第一列数据已粘完',true,{actionId:'data-column-2'}));
test('different catalog task cannot inherit data column evidence',()=>verify('新建表格，只粘第一列数据','DONE|第一列数据已粘完',false,{actionId:'lab-unit-2',attempts:0}));
test('unknown task with familiar evidence cannot spend a request',()=>verify('整理实验数据的第二列','DONE|第一列数据已粘完',false,{attempts:0}));
