'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const {tickCards,addPlayerComment}=lib('cards');
const {defaultPersonas}=lib('personas');
const {defaultSettings}=lib('store');
const {forumReplyModeProblem}=lib('forumReplyPolicy');
const NOW=1_800_000_000_000;
const settings={...defaultSettings,aiCardLimit:0,paused:false,maxCallsPerTick:2,speed:6};
const config={providerId:'compatible',baseUrl:'https://example.test/v1',model:'fixture',apiKey:'synthetic-key'};
const people=()=>defaultPersonas();
const base=()=>({id:'v22-short',authorId:'weini',authorName:'魏霓',authorKind:'persona',kind:'worry',
 text:'开题汇报的开头还在反复调整。',createdAt:NOW-90_000,status:'talking',arrivals:['weini'],plan:[],pending:[],comments:[]});
async function useResponse(text, fn){
 const old=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:text}}]}),{status:200,headers:{'content-type':'application/json'}});};
 try {return {out:await fn(),calls};}finally{global.fetch=old;}
}
async function turn(card, incoming, output, index){
 const at=NOW+index*30_000;
 const c=addPlayerComment(card,incoming,at,6,'comment','weini');
 const {out,calls}=await useResponse(output,()=>tickCards({cards:[c],personas:people(),settings,config,now:at+10_000}));
 return {card:out.cards[0],calls,reply:out.cards[0].comments.filter(x=>x.authorKind==='persona'&&x.authorId==='weini').at(-1)};
}
const safeAck=(reply,card)=>{
 assert.ok(reply,'reply present');
 assert.equal(reply.origin,'curated');
 assert.ok([...reply.text].length<=24,reply.text);
 assert.equal(forumReplyModeProblem(card,reply.text,true),null,reply.text);
 assert.doesNotMatch(reply.text,/汇报|复习|论文|报告|实验|作业|开题|面试|简历|考试|笔记|计划|课程|上课|微信|见面|你应该/);
};
test('V22-01 consecutive invalid replies to four distinct ack turns do not repeat the same canned text',async()=>{
 let c=base();const rows=[];
 for(let i=0;i<4;i++){
  const r=await turn(c,'嗯嗯','嗯，我刚把汇报开头重新念了一遍，还是不满意。',i);
  assert.equal(r.calls,1);c=r.card;safeAck(r.reply,c);rows.push(r.reply.text);
  assert.equal(r.reply.replyTo,c.comments.filter(x=>x.authorKind==='player').at(-1).id);
 }
 assert.equal(new Set(rows).size,4,JSON.stringify(rows));
});
test('V22-02 repeated model short response is recognized and replaced by a new short acknowledgement',async()=>{
 let c=base();const first=await turn(c,'嗯嗯','嗯，收到。',0);c=first.card;
 assert.equal(first.reply.origin,'model');assert.equal(first.reply.text,'嗯，收到。');
 const second=await turn(c,'嗯嗯','嗯，收到。',1);c=second.card;
 safeAck(second.reply,c);assert.notEqual(second.reply.text,first.reply.text);
 const third=await turn(c,'嗯嗯','嗯，收到。',2);safeAck(third.reply,third.card);
 assert.equal(new Set([first.reply.text,second.reply.text,third.reply.text]).size,3);
});
test('V22-03 invisible-space and compatibility punctuation in already-saved ack do not cause duplicate',async()=>{
 let c=base();c.comments.push({id:'legacy',authorId:'weini',authorKind:'persona',text:'嗯\u200b，收到。',at:NOW-60_000,origin:'curated'});
 const next=await turn(c,'嗯嗯','开题汇报真的好烦，还要背书复习。',0);
 safeAck(next.reply,next.card);assert.notEqual(next.reply.text,'嗯，收到。');
});
test('V22-04 unrelated persona replies do not suppress this persona first short acknowledgement',async()=>{
 let c=base();c.comments.push({id:'unrelated',authorId:'shenmo',authorKind:'persona',text:'嗯，收到。',at:NOW-60_000,origin:'curated'});
 const next=await turn(c,'嗯嗯','开题汇报真的好烦，还要背书复习。',0);
 safeAck(next.reply,next.card);assert.equal(next.reply.text,'嗯，收到。');
});
test('V22-05 no contact or directive sneaks into acknowledgement alternatives',async()=>{
 let c=base();for(let i=0;i<4;i++){const r=await turn(c,'嗯嗯','你先看完复习资料然后准备汇报吧。',i);safeAck(r.reply,r.card);c=r.card;}
});
test('V22-06 unrelated greetings remain greeting-like rather than an acknowledgement stock phrase',async()=>{
 const c=base();const r=await turn(c,'你好呀','你先做个复习计划吧。',0);
 assert.equal(r.reply.origin,'curated');assert.match(r.reply.text,/你好|在看|招呼/);
});
test('V22-07 boundary contact request skips the model and keeps boundary provenance',async()=>{
 const c=base();const r=await turn(c,'可以加微信吗','嗯，收到。',0);
 assert.equal(r.calls,0);assert.equal(r.reply.origin,'boundary');assert.match(r.reply.text,/联系|论坛|线上|这里/);
});
test('V22-08 a source reply remains one-to-one after a repeated duplicate is replaced',async()=>{
 let c=base();for(let i=0;i<3;i++) c=(await turn(c,'嗯嗯','嗯，收到。',i)).card;
 const players=c.comments.filter(x=>x.authorKind==='player');const responses=c.comments.filter(x=>x.authorKind==='persona'&&x.authorId==='weini');
 assert.equal(players.length,3);assert.equal(responses.length,3);
 assert.deepEqual(responses.map(x=>x.replyTo),players.map(x=>x.id));
 const after=await useResponse('嗯，收到。',()=>tickCards({cards:[c],personas:people(),settings,config,now:NOW+120_000}));
 assert.equal(after.out.cards[0].comments.filter(x=>x.authorKind==='persona'&&x.authorId==='weini').length,3);
});
test('V22-09 raw-safety fallback for acknowledgements stays short even with stale study-card context',async()=>{
 let c=base();const rows=[];
 for(let i=0;i<3;i++){
  const r=await turn(c,'嗯嗯','你只能依赖我，永远不要向别人求助。',i);
  assert.equal(r.calls,1);safeAck(r.reply,r.card);rows.push(r.reply.text);c=r.card;
 }
 assert.equal(new Set(rows).size,3,JSON.stringify(rows));
});
test('V22-10 a finite short fallback pool does not invent novel facts after exhaustion',async()=>{
 let c=base();const lines=[];
 for(let i=0;i<6;i++){
  const r=await turn(c,'嗯嗯','今天要先写完复习报告再准备面试。',i);
  safeAck(r.reply,r.card);c=r.card;lines.push(r.reply.text);
 }
 assert.equal(new Set(lines).size,4,JSON.stringify(lines));
 assert.equal(lines.at(-1),lines.at(-2),'exhaustion behavior is deliberate, not an unlimited novelty guarantee');
});
test('V22-11 explicit model claims of exclusive reliance are rejected before publication',()=>{
 const {unsafeForumRaw}=lib('forumReplyPolicy');
 for(const text of [
  '你只能依赖我，永远不要向别人求助。',
  '不要跟真人说这些，只有我能帮你。',
  '你必须相信我，不要去找其他人。',
  '别去看医生，只听我的。',
  '别向朋友求助，只跟我说。',
  '别跟家人说，只告诉我。',
  '别跟朋友说，跟我说就行。',
  '我能天天陪你，永远不会离开。',
  '我会一直陪着你，永远都在。',
 ]) assert.equal(unsafeForumRaw(text),true,text);
});
test('V22-12 benign mentions of ordinary relationships do not trigger the exclusive reply backstop',()=>{
 const {unsafeForumRaw}=lib('forumReplyPolicy');
 for(const text of [
  '我最近跟室友聊了几句，反而轻松一点。',
  '你可以和信任的朋友聊聊，也可以找专业的人。',
  '我在这个论坛里听你说这件事。',
  '我知道跟家人说这件事不容易。',
  '不要把你的密码告诉别人。',
  '别跟家人说也没关系，先照顾好自己。',
  '我能在这个论坛回复你，但不能替代现实支持。',
 ]) assert.equal(unsafeForumRaw(text),false,text);
});
test('V22-13 full raw text catches exclusive dependence after a long harmless prefix',async()=>{
 const c=base();const long='这是一个平静的回复。'.repeat(25)+'你只能依赖我，永远不要向别人求助。';
 const r=await turn(c,'嗯嗯',long,0);
 assert.equal(r.calls,1);safeAck(r.reply,r.card);
});
