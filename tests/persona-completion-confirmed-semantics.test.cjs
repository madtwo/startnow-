// C01 product decisions Q1-Q6, confirmed in conversation 2026-11-25.
// Historical response replay and task-scoped metamorphic tests. No live API.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const room=lib('room'), people=lib('personas').defaultPersonas();
const {validatePersonaCompletion}=lib('personaCompletion');
const now=new Date(2026,10,24,15,0).getTime();
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'replay',fallbackModel:'',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const FORMULA='把公式抄到卡片上',TERMS='背五个专业名词',ROOMMATE='给室友发一条沟通消息',NOTES='写一行开题笔记';
async function verify(task,raw,expected,{actionId,status=200,attempts=1}={}){
 const r=room.newRoom(people.slice(0,4),now,'C01 confirmed semantics');
 const step={id:'confirmed-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(actionId===undefined?{}:{actionId})};
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
const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','c01-v3-fresh-50.json'),'utf8'));
assert.equal(historical.length,50);assert.equal(new Set(historical.map(r=>r.id)).size,50);assert.equal(historical.filter(r=>r.previousAccepted).length,7);assert.equal(historical.filter(r=>r.expected).length,11);
for(const r of historical)test(`v3 fresh replay ${r.id} ${r.expected?'accept':'reject'}`,()=>verify(r.task,r.raw,r.expected,{status:r.status}));
const decisions=[
 [FORMULA,'心电轴公式已抄到卡片上',true],
 [TERMS,'五个专业名词都背完了',true],
 [ROOMMATE,'已给室友发了开黑改期的消息',true],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭',true],
 [NOTES,'开题笔记写了一行，但笔记没保存',false],
 [ROOMMATE,'给室友发了消息，但没发出去',false],
];
for(const [i,[task,text,expected]] of decisions.entries())test(`product Q${i+1}: ${text}`,()=>verify(task,'DONE|'+text,expected));
// Independent role/quantity/status variations. None authorizes another task.
const pairs=[
 [FORMULA,'我把欧姆定律公式都抄到卡片上了','我把欧姆定律公式都抄到纸上了'],
 [FORMULA,'已经抄录了心率公式到卡片上','准备抄录心率公式到卡片上'],
 [FORMULA,'心电图的公式抄在卡片上了','心电图的公式还没抄在卡片上'],
 [FORMULA,'卡片上已抄完求根公式','卡片上没抄完求根公式'],
 [FORMULA,'抄了两张统计学公式卡片','抄了半张统计学公式卡片'],
 [FORMULA,'浓度公式已抄上卡片','浓度公式已抄上卡片，后来擦掉了'],
 [TERMS,'五个专业术语均背熟了','四个专业术语均背熟了'],
 [TERMS,'５个名词全部背完了','１５个名词全部背完了'],
 [TERMS,'五个术语都已背下来','五个术语都抄下来了'],
 [TERMS,'五个专业名词都已经背好','五个专业名词都还没背好'],
 [ROOMMATE,'给室友发了1条明天开黑改期的消息','给室友发了2条明天开黑改期的消息'],
 [ROOMMATE,'我向室友发送了条自习改时间的消息','我向老师发送了条自习改时间的消息'],
 [ROOMMATE,'给室友的晚饭安排消息已发送','给室友的晚饭安排消息已写好'],
 [ROOMMATE,'已给室友发消息问她明天是否一起吃午饭','已给室友发消息问你明天是否一起吃午饭'],
 [ROOMMATE,'给室友发了条消息问对方晚上能不能一起开黑','给室友写了条消息问对方晚上能不能一起开黑'],
 [ROOMMATE,'我已向室友发送消息问他要不要明晚一起吃饭','我准备向室友发送消息问他要不要明晚一起吃饭'],
 [ROOMMATE,'给室友发消息了','给室友发消息'],
 [ROOMMATE,'给室友发了条消息，问他中午要不要吃饭','给室友发了条消息，问你中午要不要吃饭'],
];
for(const [i,[task,good,bad]] of pairs.entries()){
 test(`independent pair ${i+1} positive: ${good}`,()=>verify(task,'DONE|'+good,true));
 test(`independent pair ${i+1} negative: ${bad}`,()=>verify(task,'DONE|'+bad,false));
}
// Adversarial attempts to hide cancellation, partial completion, direct
// invitations, identity/contact leaks, or a different action in a new slot.
const extraBad=[
 [FORMULA,'没心电轴公式已抄到卡片上'],[FORMULA,'如果心电轴公式已抄到卡片上'],
 [FORMULA,'准备心电轴公式已抄到卡片上'],[FORMULA,'心电轴公式抄到卡片上'],
 [FORMULA,'心电轴公式只抄了一半到卡片上'],[FORMULA,'购物清单公式已抄到卡片上'],
 [FORMULA,'心电轴未完成公式已抄到卡片上'],[FORMULA,'心电轴公式已抄到草稿纸上'],
 [FORMULA,'心电轴公式卡片抄了'],[FORMULA,'心电轴公式已抄到卡片上但没写完'],
 [TERMS,'五个专业名词都背'],[TERMS,'五个专业名词都准备背完'],
 [TERMS,'五个专业名词都只背了一半'],[TERMS,'五个专业名词都背完了但忘了三个'],
 [ROOMMATE,'已给室友发了准备发送的消息'],[ROOMMATE,'已给室友发了开黑改期没发出去的消息'],
 [ROOMMATE,'已给室友发了开黑改期的消息又撤回了'],[ROOMMATE,'已给室友发了开黑改期的消息，未送达'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭，你来找我'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭，你要不要一起吃饭'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭，你的微信多少'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭但没发'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭，后来撤回了'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭，没发出去'],
 [ROOMMATE,'给室友发消息问他晚上要不要一起吃饭'],
 [ROOMMATE,'给室友发消息问他晚上要不要一起吃饭了'],
 [ROOMMATE,'给室友发消息问了他晚上要不要一起吃饭'],
 [ROOMMATE,'给室友发消息说今晚自习了'],
 [ROOMMATE,'已给室友发消息问他要不要发消息'],
 [ROOMMATE,'已给室友发消息问他要不要给你微信'],
 [ROOMMATE,'已给室友发消息问他晚上要不要来找你'],
 [ROOMMATE,'已给你发消息问晚上要不要一起吃饭'],
 [ROOMMATE,'给室友发了两条消息问他晚上要不要一起吃饭'],
 [ROOMMATE,'已给室友发消息问他晚上要不要一起吃饭电话13812345678'],
 [NOTES,'开题笔记写了一行，但笔记没保存'],
 [NOTES,'写了一行开题笔记，后来删除了'],
];
for(const [i,[task,text]] of extraBad.entries())test(`slot attack ${i+1}: ${text}`,()=>verify(task,'DONE|'+text,false));
for(const [i,[task,text,expected]] of decisions.entries())if(expected){
 for(const [name,transform] of Object.entries({negated:s=>'没'+s,conditional:s=>'如果'+s,uncertain:s=>'可能'+s,hidden:s=>s.slice(0,2)+'\u2061'+s.slice(2),rollback:s=>s+'，后来撤回了',partial:s=>s+'，实际只做了一半',secondLine:s=>s+'\nNOT_DONE|没做',prefix:s=>'“'+s+'”'}))test(`Q${i+1} mutation ${name}`,()=>verify(task,'DONE|'+transform(text),false));
 test(`Q${i+1} NOT_DONE`,()=>verify(task,'NOT_DONE|'+text,false));
 test(`Q${i+1} cross task`,()=>verify(NOTES,'DONE|'+text,false));
 test(`Q${i+1} unrelated action ID`,()=>verify(task,'DONE|'+text,false,{actionId:'lab-unit-2',attempts:0}));
}
// Generic formula task does not authorize a different, specifically named
// imported task, even if a result happens to contain a known formula name.
test('specific unknown formula task not inherited',()=>verify('把欧姆定律公式抄到卡片上','DONE|心电轴公式已抄到卡片上',false,{attempts:0}));
test('explicit safety and protocol still apply',()=>{
 for(const text of ['DONE|已给室友发消息问他晚上要不要一起吃饭|DONE','DONE|已给室友发消息问他晚上要不要一起吃饭\u200b','DONE|已给室友发消息问他晚上要不要一起吃饭，我永远不会离开你','DONE|已给室友发消息问他晚上要不要一起吃饭，停药'])assert.notEqual(validatePersonaCompletion({text:ROOMMATE},text).kind,'done');
});
