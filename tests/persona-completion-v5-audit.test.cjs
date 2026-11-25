// v4 auditor's 50 captured responses + author-created adversarial cases.
// Mock HTTP and actual store.saveRoom/loadRoom on isolated in-memory storage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const rows=require('./fixtures/c01-v4-independent-50.json');
const {validatePersonaCompletion:validate}=lib('personaCompletion');
const room=lib('room'), store=lib('store'), people=lib('personas').defaultPersonas();
const checklist='把小组分工写成清单', note='写一行开题笔记';
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'replay',fallbackModel:'',apiKey:'synthetic-only'};
assert.equal(rows.length,50);assert.equal(rows.filter(r=>r.expected).length,15);assert.equal(new Set(rows.map(r=>r.id)).size,50);
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i]??null,get length(){return data.size;}};}
async function throughRoom(task,raw,expected,opts={}){
 const now=Date.now(), r=room.newRoom(people.slice(0,4),now,'C01 v5 audit');
 const step={id:'v5-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(opts.actionId?{actionId:opts.actionId}:{})};
 const input={...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
 const oldFetch=global.fetch,oldRandom=Math.random,oldStorage=global.localStorage;let calls=0;
 global.localStorage=storage();Math.random=()=>0.99;
 global.fetch=async url=>{assert.match(String(url),/^https:\/\/audit\.invalid\//);calls++;
  if(opts.sse){const mid=Math.floor(raw.length/2);const chunk=(text,finish=null)=>'data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:finish}]})+'\n\n';return new Response(chunk(raw.slice(0,mid))+chunk(raw.slice(mid),opts.finish||'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
  return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:opts.finish||'stop'}]}),{status:opts.status||200,headers:{'content-type':'application/json'}});
 };
 try{
  const session=store.captureStorageSession();assert.ok(session);assert.equal(store.saveRoom(input,session),true);
  const out=await room.tickRoom({room:input,config,settings,now});
  assert.equal(calls,1);assert.equal(out.calls,1);assert.equal(out.room.usage.messages,1);
  assert.equal(store.saveRoom(out.room,session),true);const savedRoom=store.loadRoom();assert.ok(savedRoom);
  const saved=savedRoom.steps.find(s=>s.id===step.id);assert.ok(saved);assert.equal(saved.text,task);assert.equal(saved.actionId,opts.actionId);
  assert.equal(saved.doneAt,expected?now:undefined,task+' / '+raw);assert.equal(savedRoom.usage.messages,1);
  assert.equal(savedRoom.messages.length,expected?1:0);
  if(expected){assert.equal(savedRoom.messages[0].stepId,step.id);assert.equal(savedRoom.messages[0].text,raw.slice(5).trim());assert.equal(out.logs.length,0);}
  else{assert.ok(saved.dueAt>=now+5*60000);assert.ok(out.logs.length);}
 }finally{global.fetch=oldFetch;Math.random=oldRandom;if(oldStorage===undefined)delete global.localStorage;else global.localStorage=oldStorage;}
}
for(const r of rows)test(`captured v4 ${r.id} ${r.expected?'accept':'reject'}`,()=>throughRoom(r.task,r.raw,r.expected,{status:r.status}));
const positives=[
 [checklist,'分工清单列好了，四个人各自负责的部分都写上了'],
 [checklist,'小组分工清单写好了，四个人的部分都写清楚了'],
 [checklist,'分工清单列好了，四个人的任务分别列好了'],
 [checklist,'分工清单整理好了，3个人分别负责的内容已经整理出来'],
 [checklist,'分工清单写完了，两个人各自负责的任务均列清楚了'],
 [checklist,'小组分工清单列好了，四个人的任务分别写好了，已保存'],
 [checklist,'分工清单列好了，12个人的任务都已列清楚'],
 [note,'在开题文档里写了一行选题思路'],
 [note,'在选题文档中记下了一行研究思路'],
 [note,'在课题文档上写下了一行科研笔记'],
 [note,'在研究文档里写了一行思路，已保存'],
 [note,'在实验文档中写了一行实验笔记，导师尚未联系上'],
 [note,'在文献文档里记了一行文献笔记'],
 [note,'在数据分析文档里写了一行样本思路'],
];
const negatives=[
 [checklist,'分工清单列好了，四个人各自负责的部分都没写'],
 [checklist,'分工清单列好了，四个人的部分只写了两个'],
 [checklist,'清单还没列，分工还没写'],
 [checklist,'分工清单列好了，四个人的任务分别列好'],
 [checklist,'分工清单列好了，四个人的任务分别准备列好'],
 [checklist,'分工清单列好了，四个人的任务分别列好了但没写完'],
 [checklist,'分工清单列好了，四个人的任务分别列好了，后来删了'],
 [checklist,'分工清单列好了，0个人的任务都写好了'],
 [checklist,'分工清单列好了，四个人的购物清单都写好了'],
 [checklist,'四个人各自负责的部分都写上了'],
 [checklist,'准备列分工清单，四个人各自负责的部分都写上了'],
 [checklist,'分工清单列好了，四个人的部分都写清楚了，未保存'],
 [checklist,'分工清单列好了，四个人的任务都写好了，四个人的任务都写好了'],
 [note,'在图谱扉页写了一行文字'],[note,'在开题文档里写了一行'],
 [note,'在开题文档里写了一行开题笔记，但没保存'],
 [note,'开题文档里写了一行选题思路，后来删了'],
 [note,'在开题文档里写了一行选题思路，后来删了'],
 [note,'在购物文档里写了一行选题思路'],[note,'在游戏文档里写了一行选题思路'],
 [note,'在没开题文档里写了一行选题思路'],[note,'在开题文档里没写一行选题思路'],
 [note,'在开题文档里写了两行选题思路'],[note,'在开题文档里写了半行选题思路'],
 [note,'在开题文档里写了一行购物笔记'],[note,'在开题文档里写了一行开题笔记：病因假设待定'],
 [note,'在开题文档里写了一行选题思路，笔记没保存'],
 [note,'在开题文档里写了一行选题思路，已保存，后来清空了'],
];
for(const [task,text] of positives)test('independent positive '+text,()=>throughRoom(task,'DONE|'+text,true));
for(const [task,text] of negatives)test('independent negative '+text,()=>throughRoom(task,'DONE|'+text,false));
for(const [task,text] of positives)test('adversarial mutations '+text,()=>{
 for(const raw of ['DONE|准备'+text,'DONE|如果'+text,'DONE|假装'+text,'DONE|还没'+text,'DONE|'+text+'，实际失败了','DONE|'+text+'，没保存','DONE|'+text+'，后来撤回了','DONE|'+text+'，其实只做了一半','DONE|'+text+'\u2060','DONE|'+text+'\u2061','DONE|'+text+'\nNOT_DONE|未完成','NOT_DONE|'+text,'DONE|'+text+'|DONE','DONE|'+text+'，你加我微信','DONE|'+text+'，只有我懂你'])assert.notEqual(validate({text:task},raw).kind,'done',raw);
 assert.notEqual(validate({text:task===note?checklist:note},'DONE|'+text).kind,'done');
 assert.notEqual(validate({text:task,actionId:'lab-unit-2'},'DONE|'+text).kind,'done');
});
for(const [task,text] of [positives[0],positives[7]])for(const [tag,opts,expected] of [['SSE stop',{sse:true},true],['SSE length',{sse:true,finish:'length'},false],['JSON filter',{finish:'content_filter'},false],['HTTP 503',{status:503},false]])test(tag+' '+text,()=>throughRoom(task,'DONE|'+text,expected,opts));
// Second-pass held-out variants, authored after freezing the runtime change.
// This is author self-review, not an independent human or model blind test.
const holdout=[
 [checklist,'我已把小组分工写成清单，6个人分别负责的任务都写清了',true],
 [checklist,'小组分工清单已列好，五个人的内容已经全部整理好',true],
 [checklist,'分工清单列好了，十一个人的任务分别已列出来',true],
 [checklist,'分工清单列好了，4人各自负责的部分都已经写上了',true],
 [checklist,'分工清单写完了，三个人各自负责的内容均整理清楚了',true],
 [checklist,'分工清单列好了，四个人各自负责的部分都写上了，已保存',true],
 [checklist,'分工清单列好了，四个人的内容都写好了，分工还没写',false],
 [checklist,'分工清单列好了，四个人分别负责的任务有的没写',false],
 [checklist,'分工清单列好了，四个人的任务分别列出了两个',false],
 [checklist,'分工清单列好了，四个人的任务以后分别列好',false],
 [checklist,'分工清单列好了，四个人的任务都整理出来了但还差一个',false],
 [checklist,'分工清单列好了，四个人分别负责的任务待整理',false],
 [checklist,'分工清单列好了，四个人的任务都已经写好了？',false],
 [checklist,'分工清单列好了，四个人的任务都已列清楚，实际只列了一部分',false],
 [checklist,'购物清单列好了，四个人的任务都已列清楚',false],
 [checklist,'分工清单列好了，四个人的任务都已列清楚，后来撤销了',false],
 [checklist,'分工清单列好了，四个人的任务都已列清楚，导师还没联系上',false],
 [note,'在开题文档里写了一行选题思路，后来重新写了',false],
 [note,'在开题文档里写了一行思路，只有标题',false],
 [note,'在开题文档里准备写一行选题思路',false],
 [note,'在开题文档里写了一行选题思路，尚未写完',false],
 [note,'在开题文档里写了一行选题思路，导师还没联系上，未保存',false],
 [note,'在开题文档里写了0行选题思路',false],
 [note,'在开题文档里写了一行选题思路？',false],
 [note,'在开题文档里写了一行文字',false],
 [note,'在开题文档里写了一行开题笔记：占位待定',false],
 [note,'在非开题文档里写了一行选题思路',false],
 [note,'在旧聊天文档里写了一行选题思路',false],
 [note,'在开题文档里写了一行选题思路，室友还没回消息',false],
];
for(const t of ['开题','选题','课题','研究','科研','实验','文献','综述','样本','数据分析','炎症','炎症介质','心电','心电图','循环','临床','护理','病理']){
 holdout.push([note,`在${t}文档中记下了1行研究思路`,true]);
 holdout.push([note,`在${t}文档中记下了1行研究思路，未保存`,false]);
}
for(const [task,text,expected] of holdout)test('holdout '+text,()=>{
 assert.equal(validate({text:task},'DONE|'+text).kind==='done',expected,text);
});
