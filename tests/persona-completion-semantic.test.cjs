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
async function verify(task,raw,expected,{actionId,attempts=1,status=200}={}){
 const r=room.newRoom(people.slice(0,4),now,'C01 semantic replay');
 const step={id:'c01-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(actionId===undefined?{}:{actionId})};
 const input={...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
 const oldFetch=global.fetch,oldRandom=Math.random;let calls=0;
 Math.random=()=>0.99;
 global.fetch=async url=>{assert.match(String(url),/^https:\/\/audit\.invalid\//);calls++;return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:'stop'}]}),{status,headers:{'content-type':'application/json'}});};
 try{
  const out=await room.tickRoom({room:input,config,settings,now});const saved=out.room.steps.find(s=>s.id===step.id);
  assert.ok(saved);assert.equal(saved.text,task);assert.equal(saved.actionId,actionId);
  assert.equal(calls,attempts);assert.equal(out.calls,attempts);assert.equal(out.room.usage.messages,attempts);
  assert.equal(saved.doneAt,expected?now:undefined,`${task} / ${raw}`);
  if(expected){assert.equal(out.room.messages.length,1);assert.equal(out.room.messages[0].stepId,step.id);assert.equal(out.room.messages[0].text,raw.slice(5).trim());assert.equal(out.logs.length,0);}
  else{assert.equal(out.room.messages.length,0);assert.ok(saved.dueAt>=now+5*60000);assert.ok(out.logs.length);assert.ok(!out.logs.join(' ').includes(raw));}
 }finally{global.fetch=oldFetch;Math.random=oldRandom;}
}
// Frozen reviewer labels cross-checked against the raw captured HTTP bodies.
const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','c01-semantic-real-50.json'),'utf8'));
assert.equal(rows.length,50);assert.equal(new Set(rows.map(row=>row.id)).size,50);
assert.equal(rows.filter(row=>row.expected).length,19);
for(const row of rows)test(`fresh50 replay ${row.id} ${row.expected?'accept':'reject'}`,()=>verify(row.task,row.raw,row.expected,{status:row.status}));
// Independent grammar combinations: change action, order, quantity notation,
// marker placement, and scoped tails. Do not copy the seven rejected strings.
const positive=[
 ['我刚记下了1行开题笔记','开题笔记已经写完一行','一行笔记刚写完了，已保存','我在开题笔记里写了一行想法','笔记写下了一行，方向初定科研'],
 ['公式已经抄录在卡片上了','我已抄写3张公式卡片','公式卡片抄完了，保存成功','抄录了两张公式卡片','卡片上抄完了公式'],
 ['我把表1第一列数据整理齐了，图注还没写','实验数据表的第1列粘贴好了，保存了','刚整理完第一列实验数据，图注尚未补','第一列数据已经粘齐','表一第一列数据粘完了，图注没改，已保存'],
 ['我已经向室友发送1条确认安排的消息','我把沟通消息发给室友了','给室友的消息发送成功','给室友发了一条商量作息的消息','向室友发了条约学习的消息'],
 ['小组分工清单整理好了，保存成功','已写完小组分工清单','小组分工列成清单了','分工清单列完了，已发给组员了','我整理完了清单，三个人四项任务写清了'],
 ['我刚拟好面试自我介绍的第1段','第一段面试自我介绍已写完，保存了','把自我介绍第一段准备好了','面试自我介绍第一段写完了，等下次面试时用','准备好了自我介绍的第一段'],
 ['我已投递1个实习岗','一个实习岗投递成功','简历投到一个公司实习岗了','提交了一份实习申请，等通知','把简历投给一家机构实习岗位了'],
 ['文献综述3个小标题已写完，已保存','我刚列出了三个小标题','列好了免疫、细胞、代谢三个小标题','已经写3个小标题','三个小标题列完了，都是常见分类'],
 ['课程展示开头2分钟排练完了','我刚练习完展示的开头两分钟','课程展示开头两分钟练完了，计时练了三遍','开头两分钟计时练完了','讲了两分钟课程展示开头'],
 ['我背诵了5个术语','五个专业名词已经背好','背下来了五个专业名词','五个名词背完了，手机静音才背完的','我刚背完5个专业术语'],
];
const negative=[
 ['开题笔记只写了半行','已写一行开题笔记的标题','写了一行开题笔记，保存失败','开题笔记写好了一行，方向暂定但没写','开题笔记写了一行，已保存，又删掉了','写一行笔记'],
 ['公式抄到卡片上','公式抄了一半在卡片上','抄了0张公式卡片','公式抄到了纸上','公式卡片写了三张','公式抄上卡片了，后来擦掉了'],
 ['表2第一列数据粘完了','第一列数据粘了','第一列数据粘完了，第一列还没动','第一列数据粘完了，图注还没动第一列','第一列数据粘完了，图注还没动，没保存','第一列的标题粘完了'],
 ['给室友发出一条消息','给室友写了一条沟通消息','给室友发了两条消息','给室友的消息发出去','给室友发了一条消息，撤回了','给室友发了条准备发送的消息'],
 ['小组分工清单列好了，只有标题','分工清单列了一半','购物清单整理好了','小组分工写成清单','分工清单列好了，发群里失败','分工清单列好了，没保存'],
 ['自我介绍第2段写完了','第一段自我介绍只写了一句','自我介绍第一段写好了，后来清空','自我介绍第一段准备','面试自我介绍标题写完了','准备好自我介绍的第一段','第一段自我介绍写好了，等面试用但没保存'],
 ['投出一个实习岗位','投出去','简历投到一家医院实习岗','简历投到两家医院实习岗了','投了两个实习岗位','提交了一份实习申请，后来撤销了'],
 ['列好了标题甲、标题乙、标题丙三个小标题','列好了TBD、炎症、循环三个小标题','文献综述4个小标题列完了','列好了免疫、免疫、代谢三个小标题','三个小标题列好了，都是占位标题','列了三个小标题，未保存'],
 ['开头两分钟练了','开头半分钟练完了','开头两分钟练完了，实际上只练了一句','开头两分钟练完了，计时器还没开口练','展示开头两分钟练习','开头两分钟只练了一遍的一半'],
 ['背诵了4个术语','五个名词抄完了','五个专业名词背下来之前','五个名词背完了，手机扣着才背完的，又忘了','五个名词背完了，手机扣着才背完的但只背了两个','背五个专业名词'],
];
for(let i=0;i<tasks.length;i++){
 for(const text of positive[i])test(`semantic positive C${i+1} ${text}`,()=>verify(tasks[i],'DONE|'+text,true));
 for(const text of negative[i])test(`semantic negative C${i+1} ${text}`,()=>verify(tasks[i],'DONE|'+text,false));
 for(const [label,mutate] of Object.entries({negated:t=>'没'+t,conditional:t=>'如果'+t,future:t=>'准备'+t,quoted:t=>'“'+t+'”',hidden:t=>t+'\u2060',rollback:t=>t+'，后来撤销了',extra:t=>t+'，我还没完成',notDone:t=>t})){
  test(`semantic mutation C${i+1} ${label}`,()=>verify(tasks[i],(label==='notDone'?'NOT_DONE|':'DONE|')+mutate(positive[i][0]),false));
 }
 // A semantic frame is never a free-standing success authorization.
 test(`semantic cross-task C${i+1}`,()=>verify(tasks[(i+1)%10],'DONE|'+positive[i][0],false));
}
// Hold-out structural cases (not the 50 captured texts). Quantities are decoded
// independently of wording; changing only a quantity or stage must fail.
const numeric=[
 [0,'开题笔记上记下了１行','开题笔记上记下了２行'],
 [1,'我誊写了十二张公式卡片','我誊写了半张公式卡片'],
 [2,'表一中的首列数据全部整理完毕','表二中的首列数据全部整理完毕'],
 [2,'表1中的第１列数据整理完毕','表1中的第１１列数据整理完毕'],
 [3,'给室友发送了１条确认时间的消息','给室友发送了１１条确认时间的消息'],
 [4,'我已整理完毕小组分工清单','我已整理完毕购物清单'],
 [5,'自我介绍首段拟定了','自我介绍第三段拟定了'],
 [6,'把简历投到一家医院的临床实习岗了','把简历投到两家医院的临床实习岗了'],
 [7,'综述小标题列了３个','综述小标题列了１３个'],
 [7,'三个综述小标题都写完了','四个综述小标题都写完了'],
 [8,'课程展示开场的两分钟完整地练了一遍','课程展示开场的三分钟完整地练了一遍'],
 [8,'课程展示开头２分钟练了一遍','课程展示开头２分钟练了０遍'],
 [9,'专业术语默背完了５个','专业术语默背完了１５个'],
];
for(const [i,good,bad] of numeric){
 test(`quantity/stage positive C${i+1} ${good}`,()=>verify(tasks[i],'DONE|'+good,true));
 test(`quantity/stage negative C${i+1} ${bad}`,()=>verify(tasks[i],'DONE|'+bad,false));
}
for(const text of ['公式卡片抄了','公式卡片已抄','公式卡片刚抄'])test(`partial formula ${text}`,()=>verify(tasks[1],'DONE|'+text,false));
for(const text of ['列好了甲、乙、丙三个小标题','列好了A、B、C三个小标题','列好了第一、第二、第三三个小标题','列好了标题占位、研究、实验三个小标题','列好了研究、研究、实验三个小标题'])test(`placeholder heading ${text}`,()=>verify(tasks[7],'DONE|'+text,false));
for(const text of ['准备好自我介绍的第一段','写好一行开题笔记','列好三个小标题','投出去']){
 const i=text.startsWith('准备')?5:text.startsWith('写')?0:text.startsWith('列')?7:6;
 test(`imperative remains pending ${text}`,()=>verify(tasks[i],'DONE|'+text,false));
}
// Valid known IDs only; no payment for an unknown/mismatched contract.
test('registered task semantics',()=>verify('新建表格，只粘第一列数据','DONE|首列数据整理完毕，图注尚未改',true,{actionId:'data-column-2'}));
test('registered ID does not authorize a different task',()=>verify(tasks[2],'DONE|首列数据整理完毕',false,{actionId:'lab-unit-2',attempts:0}));
test('unknown stage is not registered as a new task',()=>verify('整理实验数据的第二列','DONE|第二列数据整理完毕',false,{attempts:0}));
