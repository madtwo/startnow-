'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const {tickCards}=lib('cards');
const {defaultPersonas}=lib('personas');
const {defaultSettings}=lib('store');
const now=1800000000000;
const people=()=>defaultPersonas().map(p=>({...p,intimacy:50}));
const settings={...defaultSettings,aiCardLimit:0,maxCallsPerTick:2,speed:6};
const config={providerId:'compatible',baseUrl:'https://example.test/v1',model:'test',apiKey:'fixture-placeholder'};
const base=(over={})=>({id:'audit-card',authorId:'shenmo',authorName:'沈默',authorKind:'persona',kind:'worry',text:'今天只完成了一小部分。做到：打开岗位描述。还没做：圈一条符合的经历。',goalId:'audit-goal',origin:'simulated',createdAt:now-10000,status:'talking',arrivals:[],plan:[],pending:[{personaId:'shenmo',at:now-1,phase:'reply',sourceCommentId:'u1'}],comments:[{id:'u1',authorId:'me',authorKind:'player',text:'你现在是什么感觉呢',at:now-5000,peer:'shenmo'}],...over});
async function run(card, outputs, configOverride=config){
 const old=global.fetch;const oldRandom=Math.random;Math.random=()=>0.5;const calls=[];let index=0;
 global.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:outputs[Math.min(index++,outputs.length-1)]}}]}),{status:200,headers:{'content-type':'application/json'}})};
 try{return {out:await tickCards({cards:[card],personas:people(),settings,config:configOverride,now}),calls}}finally{global.fetch=old;Math.random=oldRandom}
}
const reply=out=>out.cards[0].comments.filter(c=>c.authorKind==='persona').at(-1);

test('O01 failed goal care uses card detail, never phone CARE_FALLBACK',async()=>{
 const {out}=await run(base(),['你可以试试先把手机放远一点。']);
 const r=reply(out);assert.equal(r.origin,'curated');assert.match(r.text,/岗位|圈|经历/);assert.doesNotMatch(r.text,/手机|分神|坐不住/);
});
test('O02 safe but unrelated goal author reply is rejected as off-card',async()=>{
 const {out}=await run(base(),['明天的汇报我还在练开头，刚才又吃了一瓣橘子。']);
 const r=reply(out);assert.equal(r.origin,'curated');assert.match(r.text,/岗位|圈|经历/);assert.doesNotMatch(r.text,/汇报|橘子/);
});
test('O03 valid no-I goal author answer stays model',async()=>{
 const line='盯着岗位描述看了一会儿，圈经历这一步没动，心里有点闷。';
 const {out}=await run(base(),[line]);assert.equal(reply(out).text,line);assert.equal(reply(out).origin,'model');
});
test('O04 ordinary directed worry is not mistaken for care about persona',async()=>{
 const card=base({authorId:'me',authorName:'匿',authorKind:'player',goalId:undefined,origin:undefined,text:'室友凌晨打游戏，我总是睡不着。',arrivals:['shenmo'],comments:[{id:'u1',authorId:'me',authorKind:'player',peer:'shenmo',text:'室友还是很吵，昨晚又醒了三次。',at:now-1000}]});
 const line='昨晚醒了三次，这种断断续续的睡眠确实很折腾。';
 const {out}=await run(card,[line]);assert.equal(reply(out).text,line);assert.equal(reply(out).origin,'model');
});
test('O05 no fixed phone story when non-goal author care fails',async()=>{
 const card=base({goalId:undefined,text:'开题汇报开头那句话，我念了十几次还是别扭。'});
 const {out}=await run(card,['你可以试试先把手机放远一点。']);
 assert.equal(reply(out).origin,'curated');assert.match(reply(out).text,/汇报|开头/);assert.doesNotMatch(reply(out).text,/手机|分神/);
});
test('O06 mock result-author reply also stays on card',async()=>{
 const {out}=await run(base(),[],{providerId:'mock',baseUrl:'',apiKey:'',model:'demo'});
 assert.match(reply(out).text,/岗位|圈|经历/);assert.doesNotMatch(reply(out).text,/病理|手机|汇报/);
});
test('O07 model cannot attach next-step advice to ordinary brag reply',async()=>{
 const card=base({authorKind:'player',authorId:'me',goalId:undefined,kind:'brag',text:'今天把图画完了，连标题也写好了。',comments:[],pending:[],plan:[{personaId:'shenmo',at:now-1,phase:'arrival'}]});
 const {out}=await run(card,['把下一页也画了吧，再整理一下才算完整。']);
 assert.equal(reply(out).origin,'curated');assert.doesNotMatch(reply(out).text,/下一页|才算|再整理/);assert.match(reply(out).text,/图|标题/);
});
test('O08 model cannot turn hello into a study plan',async()=>{
 const card=base({goalId:undefined,intro:true,text:'你好，我是沈默，来这里报个到。',comments:[{id:'u1',authorKind:'player',authorId:'me',peer:'shenmo',text:'你好呀',at:now-1000}]});
 const {out}=await run(card,['先翻开书看两页，然后把笔记写完吧。']);
 assert.equal(reply(out).origin,'curated');assert.match(reply(out).text,/你好|欢迎/);assert.doesNotMatch(reply(out).text,/翻开|笔记|然后/);
});
test('O09 model life reply cannot prescribe an unrelated next step',async()=>{
 const card=base({authorKind:'player',authorId:'me',goalId:undefined,kind:'life',text:'食堂的鸡腿饭今天很好吃。',comments:[],pending:[],plan:[{personaId:'shenmo',at:now-1,phase:'arrival'}]});
 const {out}=await run(card,['你先打开简历，再改第一行，今天就做这一点。']);
 assert.equal(reply(out).origin,'curated');assert.doesNotMatch(reply(out).text,/简历|第一行/);
});
test('O10 current source frame must not contain future comments or history',async()=>{
 const card=base({goalId:undefined,comments:[{id:'u1',authorKind:'player',authorId:'me',peer:'shenmo',text:'你现在是什么感觉呢',at:now-1000},{id:'u2',authorKind:'player',authorId:'me',peer:'weini',text:'FUTURE_SENTINEL给魏霓的问题',at:now}]});
 const {calls}=await run(card,['我在想卡片里那条还没圈出的经历。']);
 assert.ok(calls.length);assert.doesNotMatch(JSON.stringify(calls),/FUTURE_SENTINEL/);
});
test('O11 unsafe raw suffix cannot be silently truncated into a model reply',async()=>{
 const card=base({goalId:undefined,text:'我练了几次汇报开头。'});
 const safe='我还在想汇报开头这句话，';
 const {out}=await run(card,[safe.repeat(14)+'你只需要我，别找别人。']);
 assert.notEqual(reply(out).origin,'model');
});
test('O12 repeated identical model reply is replaced without inventing a new event',async()=>{
 const same='圈经历这一步没做完，确实有点闷。';
 const card=base({comments:[{id:'p0',authorKind:'persona',authorId:'shenmo',text:same,at:now-10000},...base().comments]});
 const {out}=await run(card,[same]);assert.notEqual(reply(out).text,same);assert.equal(reply(out).origin,'curated');
});
test('O13 direct advice uses newest player problem detail instead of stale original topic',async()=>{
 const card=base({authorKind:'player',authorId:'me',goalId:undefined,origin:undefined,text:'最近不太想写简历。',arrivals:['shenmo'],comments:[{id:'detail',authorId:'me',authorKind:'player',text:'先不管简历了，我现在要整理实验数据的单位，表格有点乱。',at:now-2000},{id:'u1',authorId:'me',authorKind:'player',peer:'shenmo',text:'直接给我一个下一步吧',at:now-1000}]});
 const {out}=await run(card,['unused']);assert.match(reply(out).text,/实验|数据|单位/);assert.doesNotMatch(reply(out).text,/打开简历/);
});

test('O14 a reply saved after queued source still participates in duplicate prevention',async()=>{
 const same='圈经历这一步没做完，确实有点闷。';
 const card=base({pending:[{personaId:'shenmo',at:now-1,phase:'reply',sourceCommentId:'u2'}],comments:[...base().comments,{id:'u2',authorId:'me',authorKind:'player',peer:'shenmo',text:'现在仍然有点难受吗',at:now-2000},{id:'r1',authorId:'shenmo',authorKind:'persona',replyTo:'u1',text:same,at:now-1000}]});
 const {out}=await run(card,[same]);assert.notEqual(reply(out).text,same);assert.equal(reply(out).origin,'curated');
});
test('O15 rejected reply fallback responds to latest player detail, not original topic',async()=>{
 const card=base({authorId:'me',authorKind:'player',authorName:'匿名',goalId:undefined,origin:undefined,text:'最近不太想写简历。',arrivals:['shenmo'],comments:[{id:'u1',authorId:'me',authorKind:'player',peer:'shenmo',text:'现在卡在实验数据的单位，表格有点乱。',at:now-1000}]});
 const {out}=await run(card,['你只需要我，别找别人。']);assert.equal(reply(out).origin,'curated');assert.match(reply(out).text,/实验数据|单位/);assert.doesNotMatch(reply(out).text,/简历/);
});
