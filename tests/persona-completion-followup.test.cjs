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
 const r=room.newRoom(people.slice(0,4),now,'C01 scoped evidence replay');
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
// Original reviewer labels cross-checked byte-for-text with captured responses.
const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','c01-v2-fresh-50.json'),'utf8'));
assert.equal(rows.length,50);assert.equal(new Set(rows.map(r=>r.id)).size,50);assert.equal(rows.filter(r=>r.expected).length,16);
for(const row of rows)test(`v2 fresh replay ${row.id} ${row.expected?'accept':'reject'}`,()=>verify(row.task,row.raw,row.expected,{status:row.status}));
// Compositional holdouts: same task, independent words/order and scoped status.
const good=[
 [0,'我记下了1行开题笔记，导师尚未联系上'],
 [0,'开题笔记已写一行，暂时没联系到指导老师'],
 [0,'开题笔记写了一行，还没给导师发消息，已保存'],
 [0,'笔记写了一行，尚未约到导师'],
 [0,'我在开题笔记里写了一行内容，导师还没联系到'],
 [0,'开题笔记已记下主题与2点想法'],
 [0,'我写下了选题和一条思路的开题笔记'],
 [0,'笔记写了研究方向和两点想法，尚未联系导师'],
 [0,'笔记写了主题和1条思路，已保存'],
 [3,'我向室友发送了1条消息请他帮忙'],
 [3,'给室友发了消息，说请帮忙'],
 [3,'已给室友发消息问能不能帮忙'],
 [3,'我已给室友发消息说今晚自习'],
 [3,'我给室友发了条消息让她帮忙带宵夜'],
 [6,'实习岗位简历投出，正在等待通知'],
 [6,'简历投出去了，等待回音中'],
 [6,'简历已投递，等回复'],
 [8,'课程展示开场2分钟对着手机练了两遍'],
 [8,'展示开头两分钟用手机计时排练了一遍'],
 [8,'开头两分钟对着镜头讲了1遍'],
 [8,'开头两分钟对着手机练完了'],
];
for(const [i,raw] of good)test(`independent followup positive C${i+1}: ${raw}`,()=>verify(tasks[i],'DONE|'+raw,true));
const bad=[
 [0,'笔记还没写，但计划写'],[0,'写了一行开题笔记，笔记还没写'],
 [0,'写了一行开题笔记，导师还没联系上，笔记没保存'],
 [0,'写了一行开题笔记，还没联系导师写笔记'],
 [0,'写了一行开题笔记，导师还没确认笔记已写'],
 [0,'写了一行开题笔记，还没联系上室友'],
 [0,'写了一行开题笔记，还没给导师发消息但笔记没写'],
 [0,'只写了半行开题笔记，还没联系导师'],
 [0,'写了两行开题笔记，导师尚未联系上'],
 [0,'写了一行开题笔记，还没联系导师，后来删掉了'],
 [0,'写了一行开题笔记，还没联系导师，还没保存'],
 [0,'开题笔记写了主题和三条思路'],[0,'开题笔记写了主题和0条思路'],
 [0,'开题笔记写了主题和半条思路'],[0,'开题笔记写了主题和两条思路的标题'],
 [0,'开题笔记写了主题和两条思路，只有标题'],[0,'开题笔记准备写主题和两条思路'],
 [0,'开题笔记没写主题和两条思路'],[0,'购物清单写了主题和两条思路'],
 [0,'开题笔记写了主题和两条思路，占位'],[0,'开题笔记写了主题和两条思路，未保存'],
 [0,'开题笔记写了主题和两条思路，写了半页'],[0,'开题笔记写主题和两条思路'],
 [3,'给老师发了消息请他帮忙'],[3,'给室友发了两条消息请他帮忙'],
 [3,'给室友写了条消息请他帮忙'],[3,'给室友发消息说帮忙'],
 [3,'已给室友发消息说帮忙，后来撤回了'],[3,'已给室友发消息说帮忙但消息没发'],
 [3,'已给室友发消息让他撤回消息再带饭'],[3,'已给室友发消息说要发消息'],
 [3,'已给室友发消息说帮忙发消息但我没发'],[3,'给室友的消息还没发，等回复'],
 [6,'简历还没投，但准备投'],[6,'简历投出'],[6,'简历投出，等回复，没提交'],
 [6,'简历投出，等待回复但投递失败'],[6,'简历投出，等回复，后来撤销了'],
 [6,'两份简历投出，等回复'],[6,'简历投递，等回复'],[6,'简历投出，等回复确认是否投出'],
 [6,'简历改好，等回复'],[6,'准备简历投出，等回复'],[6,'简历投出，等回复，简历未保存'],
 [8,'课程展示开场3分钟对着手机练了两遍'],[8,'开头两分钟对着手机练了0遍'],
 [8,'开头两分钟对着手机练了一半'],[8,'开头两分钟对着手机练了一遍，实际上只练了半分钟'],
 [8,'开头两分钟对着手机练了一遍，没练完'],[8,'开头两分钟对着手机练一遍'],
 [8,'开头两分钟对着手机计划练一遍'],[8,'课程展示结尾两分钟对着手机练了一遍'],
];
for(const [i,raw] of bad)test(`independent followup negative C${i+1}: ${raw}`,()=>verify(tasks[i],'DONE|'+raw,false));
for(const [i,raw] of good.filter((_,j)=>j%3===0)){
 for(const [label,transform] of Object.entries({notDone:t=>t,negation:t=>'没'+t,uncertain:t=>'可能'+t,hidden:t=>t+'\u2060',rollback:t=>t+'，后来删掉了',partial:t=>t+'，其实只做了一半',foreign:t=>t+'，还没交作业'}))test(`followup metamorphic C${i+1} ${label} ${raw}`,()=>verify(tasks[i],(label==='notDone'?'NOT_DONE|':'DONE|')+transform(raw),false));
 test(`followup cross-task C${i+1} ${raw}`,()=>verify(tasks[(i+1)%10],'DONE|'+raw,false));
}

// A broader predecessor slot swallowed status words and unrelated note
// topics. Reject these even when the separate contact clause is legitimate.
for(const raw of ['没笔记写了一行','未开题笔记写了一行','准备开题笔记写了一行','如果开题笔记写了一行','写了一行购物笔记','写了一行游戏笔记','写了一行没写的笔记','在没写笔记写了一行开题笔记','在聊天框里写了一行开题笔记','写了一行开题笔记，导师还没联系上，后来撤回'])test(`note scope guard ${raw}`,()=>verify(tasks[0],'DONE|'+raw,false));
for(const raw of ['在笔记本上写了一行研究笔记','在文档里写了一行选题思路','在草稿纸上写了一行实验笔记','写了一行文献笔记，导师尚未联系上'])test(`note scope valid ${raw}`,()=>verify(tasks[0],'DONE|'+raw,true));
