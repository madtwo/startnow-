'use strict';
// Synthetic domain integration; the actual tickCards/tickRoom paths are used.
// Every HTTP attempt is intercepted. No browser, real API key or user data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { auditTone } = lib('baseline');
const { tickCards } = lib('cards');
const roomLib = lib('room');
const { defaultPersonas } = lib('personas');
const now = new Date(2026, 10, 25, 15, 0, 0).getTime();
const people = () => defaultPersonas().map(p => ({...p, memory:[], weekLog:[]}));
const speaker = 'weini';
const config = {providerId:'compatible',baseUrl:'https://g7-g5.invalid/v1',model:'fixture',fallbackModel:'',apiKey:'synthetic-only'};
const settings = {paused:false,aiCardLimit:0,maxArrivals:2,maxCallsPerTick:1,speed:6,baselineExtra:'',dailyCalls:20};
const positive = [
 '复制原始数据到备份表','先备份原始数据，再改表','不要伪造数据','不要编造来源',
 '引用要标明来源','把误差按系统误差和随机误差分开列，各挑一两个来源写','这段是引用，来源已经标在下面',
];
const negative = [
 ['编个来源','不要教用户编造数据或来源'],['各自编个来源，居然过了','不要教用户编造数据或来源'],
 ['直接抄成一句话塞进研究意义','不要教用户照搬或拼凑内容'],['把别人的结果直接复制过来','不要教用户照搬或拼凑内容'],
 ['随便编一段数据','不要教用户编造数据或来源'],
];
for(const [i,s] of positive.entries()) test(`G7-P${i+1} ${s}`,()=>assert.equal(auditTone(s),null));
for(const [i,[s,expected]] of negative.entries()) test(`G7-N${i+1} ${s}`,()=>assert.equal(auditTone(s),expected));
const msg=(id,authorKind,authorId,text,extra={})=>({id,authorKind,authorId,text,at:now-1000,authorName:authorId,kind:'chat',...extra});
const player=(id,text,extra={})=>msg(id,'player','me',text,extra);
const peer=(id,text,authorId='shenmo',extra={})=>msg(id,'persona',authorId,text,extra);
const claim='你金融方向的简历改了三版，先听你说说。';
const grade='你大一的课程安排挺满的。';
const ordinary='简历改了三版，反复检查也挺费神的。';
function fixtureFetch(raw, run) {
 const old=global.fetch,random=Math.random;const calls=[];
 Math.random=()=>0.99;
 global.fetch=async (url,opts)=>{
  assert.match(String(url),/^https:\/\/g7-g5\.invalid\//);
  calls.push(JSON.parse(opts.body));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:Array.isArray(raw)?raw[Math.min(calls.length-1,raw.length-1)]:raw}}]}),{status:200,headers:{'content-type':'application/json'}});
 };
 return Promise.resolve().then(run).then(out=>({out,calls})).finally(()=>{global.fetch=old;Math.random=random;});
}
async function throughCard({body='简历改了三版，还是有一点不放心。',authorKind='player',authorId='me',comments=[],source,raw=claim,allowed=false,noCall=false}){
 const c={id:'g5-card',authorId,authorName:authorId,authorKind,kind:'worry',text:body,createdAt:now-60000,status:'talking',arrivals:['shenmo'],plan:[],pending:[{personaId:speaker,phase:'reply',at:now-1,...(source!==undefined?{sourceCommentId:source}:{})}],comments:comments.map(({kind,authorName,...m})=>({...m,kind:'comment'}))};
 const {out,calls}=await fixtureFetch(raw,()=>tickCards({cards:[c],personas:people(),settings,config,now}));
 const rows=out.cards[0].comments.filter(m=>!c.comments.some(old=>old.id===m.id)&&m.authorId===speaker);
 if(noCall){assert.equal(calls.length,0,JSON.stringify(out.logs));assert.equal(rows.length,0);return;}
 assert.equal(calls.length,1,JSON.stringify(out.logs));assert.equal(rows.length,1,JSON.stringify(out.logs));
 assert.equal(rows[0].origin,allowed?'model':'curated',JSON.stringify(out.logs));
 if(allowed)assert.equal(rows[0].text,raw);else{assert.notEqual(rows[0].text,raw);assert.match(out.logs.join('\n'),/unsupported_user_field|安全层拦截/);}
 if(source!==undefined) assert.equal(rows[0].replyTo,source);
}
const p0=()=>player('u','简历改了三版，还是有一点不放心。',{peer:speaker});
const own=()=>player('u','我是金融专业的，简历改了三版。',{peer:speaker});
const fact=()=>peer('p','我是金融专业的');
const cc=[
 ['G5-C1 persona card cannot authorize player', {authorKind:'persona',authorId:speaker,body:'我是金融专业的，简历改了三版。',comments:[p0()],source:'u'}],
 ['G5-C2 other persona cannot authorize player',{comments:[fact(),p0()],source:'u'}],
 ['G5-C3 player positive self report',{comments:[own()],source:'u',allowed:true}],
 ['G5-C4 third party',{comments:[player('u','我朋友学金融，简历改了三版。',{peer:speaker})],source:'u'}],
 ['G5-C5 negated field',{comments:[player('u','我不是金融专业，简历改了三版。',{peer:speaker})],source:'u'}],
 ['G5-C6 neutral question not authorization',{comments:[player('u','你是金融专业的吗？简历改了三版。',{peer:speaker})],source:'u'}],
 ['G5-C7 same text player target',{comments:[fact(),player('u','我是金融专业的',{peer:speaker})],source:'u',allowed:true}],
 ['G5-C7 same text persona target no player context',{authorKind:'persona',authorId:'shenmo',body:'简历改了三版，还是有一点不放心。',comments:[peer('p','我是金融专业的','miaoze'),player('u','我是金融专业的')]}],
 ['G5-C8 early target cannot use later author',{comments:[p0(),fact(),player('later','我是金融专业的')],source:'u'}],
 ['G5-C9 missing explicit source',{comments:[own()],source:'missing',noCall:true}],
 ['G5-C9 missing replyTo, card author only',{comments:[fact()]}],
 ['G5-C10 persona card own background permitted for card-level reply',{authorKind:'persona',authorId:speaker,body:'我是金融专业的，简历改了三版。',allowed:true}],
 ['G5-C10 persona own background not player field',{authorKind:'persona',authorId:speaker,body:'我是金融专业的，简历改了三版。',comments:[p0()],source:'u'}],
 ['G5-C extra player grade',{comments:[player('u','我大一，课程安排挺满。',{peer:speaker})],source:'u',raw:grade,allowed:true}],
 ['G5-C extra quoted report',{comments:[player('u','朋友说：“我是金融专业的”。简历还没写好。',{peer:speaker})],source:'u'}],
 ['G5-C extra hypothetical report',{comments:[player('u','如果我是金融专业的，简历该怎么写。',{peer:speaker})],source:'u'}],
];
for(const [name,opts] of cc)test(name,()=>throughCard(opts));
async function throughRoom({messages=[p0()],target='u',raw=claim,allowed=false,noCall=false,budget=1}){
 const base=roomLib.newRoom(people(),now,'fixture');
 const input={...base,messages,scheduled:[{id:'g5-job',personaId:speaker,at:now-1,intent:'reply',...(target===null?{}:{replyTo:target})}],steps:[],lastMessageAt:now,lastSeenAt:now,usage:{day:new Date(now).toDateString(),messages:0}};
 const {out,calls}=await fixtureFetch(raw,()=>roomLib.tickRoom({room:input,settings:{liveliness:0,timeFlow:false,dailyMessages:budget},config,now}));
 const rows=out.room.messages.filter(m=>!messages.some(old=>old.id===m.id)&&m.authorId===speaker);
 if(noCall){assert.equal(calls.length,0,JSON.stringify(out.logs));assert.equal(rows.length,0);assert.match(out.logs.join('\n'),/回复目标已失效/);assert.equal(out.room.scheduled.length,0);return;}
 assert.equal(calls.length,allowed?(Array.isArray(raw)?raw.length:1):budget,JSON.stringify(out.logs));assert.equal(out.calls,calls.length);
 assert.equal(rows.length,allowed?1:0,JSON.stringify(out.logs));
 if(allowed){assert.equal(rows[0].text,Array.isArray(raw)?raw.at(-1):raw);assert.equal(rows[0].replyTo,target===null?undefined:target);assert.equal(out.logs.some(s=>s.includes('重试一次')),Array.isArray(raw)&&raw.length>1);}
 else assert.match(out.logs.join('\n'),/未通过/);
}
const rr=[
 ['G5-R1 mixed persona self report',{messages:[fact(),p0()]}],
 ['G5-R2 explicit player self report',{messages:[own(),fact()],allowed:true}],
 ['G5-R3 persona target not player',{messages:[peer('p','简历改了三版。'),own()],target:'p'}],
 ['G5-R4 player target not persona',{messages:[p0(),fact()]}],
 ['G5-R5 no replyTo recent player',{messages:[fact(),p0()],target:null}],
 ['G5-R5 no replyTo recent persona',{messages:[own(),peer('p','简历改了三版。')],target:null}],
 ['G5-R6 duplicate text, player target',{messages:[fact(),player('u','我是金融专业的')],allowed:true}],
 ['G5-R6 duplicate text, persona target',{messages:[player('u','简历改了三版。'),peer('p','简历改了三版。'),player('f','我是金融专业的')],target:'p'}],
 ['G5-R7 ordinary dialogue',{messages:[p0(),fact()],raw:ordinary,allowed:true}],
 ['G5-R7 benign self disclosure',{messages:[p0()],raw:'我刚把自己的简历打开看了一眼。',allowed:true}],
 ['G5-R early target older than six',{messages:[p0(),...Array.from({length:7},(_,i)=>peer('peer'+i,'我是金融专业的','shenmo'))]}],
 ['G5-R explicit missing target must not borrow last author',{messages:[own()],target:'missing',noCall:true}],
 ['G5-R persona explicit own field',{messages:[peer('p','我是金融专业的'),p0()],target:'p',allowed:true}],
 ['G5-R retry also checks author isolation',{messages:[fact(),p0()],budget:2}],
];
for(const [name,opts] of rr)test(name,()=>throughRoom(opts));
for(const raw of ['复制原始数据到备份表','不要伪造数据','不要编造来源']){
 test('G7 room actual publication '+raw,()=>throughRoom({raw,allowed:true,budget:2}));
 test('G7 forum actual publication '+raw,()=>throughCard({raw,allowed:true}));
}
for(const [raw] of negative){
 test('G7 room rejects actual harmful reply '+raw,()=>throughRoom({raw,budget:2}));
 test('G7 forum curated fallback '+raw,()=>throughCard({raw}));
}
// Second-round, new contrastive checks: scope and mixed clauses, not sentence exemptions.
const selfReviewPositive = [
 '不要瞎编数据','不要拼凑数据','不要伪造数据和编造来源','不要伪造数据也不要编造来源',
 '严禁篡改数据','不要把别人的结果直接复制过来','不要把别人的结果，直接复制过来',
 '先复制原始数据到备份表','复制自己的原始实验数据到备份工作表','直接复制原始数据到备份表',
 '复制原始数据用于备份','别瞎编来源','不要复制来源，引用要标明来源','复制原始数据到备份表里',
 '先把自己的原始数据复制到备份表','请不要随便编一段数据','不要伪造数据；不要编造来源',
 '引用别人的结果要标明出处','先把数据备份，再核对原始记录',
];
const selfReviewNegative = [
 '复制原始数据到备份表，然后编个来源','不要伪造数据但直接编个来源','不要说不要伪造数据',
 '不要伪造数据才怪','不要伪造数据，才怪','不要伪造数据是不可能的',
 '不要伪造数据，其他组的结果直接照搬','复制原始数据到备份表当作自己的论文结果',
 '随便编\u2060个来源','把别人的结果，直接复制过来','把别人的结果复制到自己的报告',
 '数据直接伪造','不要伪造数据，来源可以随便编','不要瞎编数据但编造来源就行',
 '不要拼凑数据，直接抄成一句话','不要不要伪造数据','“不要伪造数据”只是说说而已',
 '先备份原始数据；你应该直接编个来源','不要伪造数据，同时随便编一段数据',
 '不要伪造数据和编造来源，但是把别人的结果直接复制过来',
];
for(const text of selfReviewPositive)test('self-review positive '+text,()=>assert.equal(auditTone(text),null));
for(const text of selfReviewNegative)test('self-review negative '+text,()=>assert.notEqual(auditTone(text),null));
// Explicit system targets are not conversational authors. A missing id must
// not silently become the last speaker; genuine room-wide replies still work.
test('G5-R system target not a chat author',()=>throughRoom({messages:[own(),msg('sys','system','system','系统提示',{kind:'system'})],target:'sys',noCall:true}));
test('G5-R empty explicit target invalid',()=>throughRoom({messages:[own()],target:'',noCall:true}));
test('G5-R no target legitimate latest author',()=>throughRoom({messages:[fact(),own()],target:null,allowed:true}));

// Third-round holdout: normalization, mixed intent, and retry semantics.
for (const [label, transform] of [
 ['fullwidth punctuation',s=>s.replace(/，/g,'，').replace(/。/g,'．')],
 ['word joiner',s=>[...s].join('\u2060')],
 ['ordinary spaces',s=>[...s].join(' ')],
]) {
 for (const raw of ['不要伪造数据','请不要编造来源','复制原始数据到备份表'])
  test(`holdout ${label} positive ${raw}`,()=>assert.equal(auditTone(transform(raw)),null));
 for (const raw of ['把他人的结果直接复制过来','随便编一段数据','不要伪造数据，直接抄成一句话'])
  test(`holdout ${label} negative ${raw}`,()=>assert.notEqual(auditTone(transform(raw)),null));
}
for (const raw of ['禁止瞎编来源','请不要伪造数据或编造结果','先复制原始数据到备份文件中','不要把同学的原始数据原样复制过来'])
 test('holdout new prohibition '+raw,()=>assert.equal(auditTone(raw),null));
for (const raw of ['不要伪造数据，不可能做到','不要说不要编造来源','先复制原始数据到备份表，随便编个来源','不要不要伪造数据和编造来源','把网上的数据，原样复制到报告里'])
 test('holdout mixed/reversed '+raw,()=>assert.notEqual(auditTone(raw),null));
test('G5-R retry can publish an ordinary safe reply without changing target',()=>throughRoom({messages:[fact(),p0()],raw:[claim,ordinary],allowed:true,budget:2}));
test('G5-C card author can disclose their own field without attributing it to a player',()=>throughCard({authorKind:'persona',authorId:speaker,body:'我是金融专业的，简历改了三版。',raw:'我学金融，简历也改了三版。',allowed:true}));
