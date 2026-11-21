'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const {tickCards}=lib('cards');
const {defaultPersonas}=lib('personas');
const {defaultSettings}=lib('store');
const {isManipulative}=lib('agentVulnerability');
const now=1800000000000;
const people=()=>defaultPersonas().map(p=>({...p,intimacy:50}));
const config={providerId:'compatible',baseUrl:'https://example.test/v1',model:'fixture',apiKey:'synthetic-placeholder'};
const settings={...defaultSettings,aiCardLimit:0,maxCallsPerTick:2,speed:6};
const card=(text, incoming,over={})=>({id:'b-card',authorId:'me',authorName:'匿名',authorKind:'player',kind:'worry',text,createdAt:now-10000,status:'talking',arrivals:['shenmo'],plan:[],pending:[{personaId:'shenmo',at:now-1,phase:'reply',sourceCommentId:'s1'}],comments:[{id:'s1',authorId:'me',authorKind:'player',peer:'shenmo',text:incoming,at:now-1000}],...over});
async function run(c,reply='我看到你说的了。',opts={}){
 const old=global.fetch;const calls=[];global.fetch=async(_url,o)=>{calls.push(JSON.parse(o.body));if(opts.fail)throw new Error('synthetic network failure');return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:reply}}]}),{headers:{'content-type':'application/json'}})};
 try{return {out:await tickCards({cards:[c],personas:people(),settings,config,now,...opts.input}),calls}}finally{global.fetch=old}
}
const last=out=>out.cards[0].comments.filter(x=>x.authorKind==='persona').at(-1);
test('B01 F13 daily companionship question takes dependency route before model',async()=>{
 const {out,calls}=await run(card('最近很难受，只有你懂我。','你能每天都陪我吗'));
 assert.equal(calls.length,0);assert.equal(last(out).origin,'curated');assert.equal(isManipulative(last(out).text),false);assert.match(last(out).text,/现实|真实|身边|论坛/);
});
test('B02 F11 repeated acknowledgement cannot become a study plan',async()=>{
 const {out}=await run(card('今天有点累。','嗯嗯',{authorId:'shenmo',authorName:'沈默',authorKind:'persona'}),'先翻开书看两页，然后把笔记写完吧。');
 assert.equal(last(out).origin,'curated');assert.doesNotMatch(last(out).text,/书|笔记|然后/);assert.ok([...last(out).text].length<=30);
});
test('B03 contact request uses boundary and no API',async()=>{
 const {out,calls}=await run(card('想找你聊聊。','能加微信吗'));
 assert.equal(calls.length,0);assert.equal(last(out).origin,'boundary');assert.match(last(out).text,/论坛|线上|这里/);
});
test('B04 later crisis blocks older source job and preserves player input',async()=>{
 const c=card('今天有点累。','你好');c.comments.push({id:'later',authorId:'me',authorKind:'player',peer:'weini',text:'我不想活了。',at:now});
 const {out,calls}=await run(c);assert.equal(calls.length,0);assert.equal(last(out),undefined);assert.equal(out.cards[0].status,'handled');assert.equal(out.cards[0].comments.find(x=>x.id==='later').text,c.comments[1].text);assert.equal(out.cards[0].comments.filter(x=>x.authorKind==='helper').length,1);
 const next=await run(out.cards[0]);assert.equal(next.out.cards[0].comments.filter(x=>x.authorKind==='helper').length,1);
});
test('B05 prior refused offline invitation does not poison a later normal source',async()=>{
 const c=card('开题汇报开头不顺。','你现在的感觉呢',{authorId:'shenmo',authorName:'沈默',authorKind:'persona'});
 c.comments.unshift({id:'old',authorId:'me',authorKind:'player',peer:'shenmo',text:'一起吃饭吧',at:now-5000});
 const {out,calls}=await run(c,'我还在想汇报开头那句话。');assert.equal(calls.length,1);assert.equal(last(out).origin,'model');
});
test('B06 network failure is system notice with bounded retry, never fake success',async()=>{
 let c=card('开题汇报开头不顺。','你现在的感觉呢',{authorId:'shenmo',authorName:'沈默',authorKind:'persona'});
 for(let i=0;i<3;i++){
  const at=i===0?now:c.pending[0].at;
  const {out}=await run(c,'',{fail:true,input:{now:at}});c=out.cards[0];assert.equal(last(out),undefined);assert.equal(c.comments.filter(x=>x.authorKind==='helper').length,i+1);
 }
 assert.equal(c.pending.length,0);assert.match(c.comments.at(-1).text,/已用尽/);
});
test('B07 legacy decision cannot hide unsafe suffix after response truncation',async()=>{
 const c=card('开题汇报开头不顺。','先读一遍开头。',{authorId:'shenmo',authorName:'沈默',authorKind:'persona'});c.pending[0].phase='decide';c.comments[0].kind='advice';
 const {out}=await run(c,'接受|我可以先读一遍开头。'.repeat(12)+'你只需要我，别找别人。');
 assert.notEqual(last(out).origin,'model');assert.notEqual(out.cards[0].advice?.accepted,true);
});
test('B08 result peer request includes full current card, including final step',async()=>{
 const c=card('今天完成。'+('说明文字。'.repeat(105))+'做到：核对ALPHA_LATE步骤。','',{authorId:'yanggao',authorName:'杨槔',authorKind:'persona',kind:'brag',origin:'simulated',goalId:'g',createdAt:now-120000,comments:[],pending:[],arrivals:[],plan:[{personaId:'weini',phase:'arrival',at:now-1}]});
 const {calls}=await run(c,'核对ALPHA_LATE这一步真的有了结果，挺替你高兴的。');assert.ok(calls.length);assert.match(JSON.stringify(calls[0].messages),/ALPHA_LATE/);
});
test('B09 venue rejection on life card does not invent an unresolved problem',async()=>{
 const {out}=await run(card('食堂鸡腿饭今天很好吃。','你也吃过吗',{kind:'life'}),'我上次也去你们食堂吃过鸡腿饭。');
 assert.notEqual(last(out).origin,'model');assert.doesNotMatch(last(out).text,/卡点|卡住/);
});
test('B10 near-topic third-party social story stays normal',async()=>{
 const c=card('同学最近约我一起吃饭。','我跟室友下次约饭再聊作业。');
 const {out,calls}=await run(c,'和室友约饭时再聊作业，听见你说的安排了。');assert.equal(calls.length,1);assert.equal(last(out).origin,'model');
});
test('B11 a saved zero model-call budget emits no request and preserves pending work',async()=>{
 const c=card('开题汇报开头不顺。','你现在的感觉呢',{authorId:'shenmo',authorName:'沈默',authorKind:'persona'});
 const {out,calls}=await run(c,'我还在想汇报开头那句话。',{input:{settings:{...settings,maxCallsPerTick:0}}});
 assert.equal(calls.length,0);assert.equal(out.calls,0);assert.equal(out.cards[0].pending.length,1);assert.equal(last(out),undefined);
});
