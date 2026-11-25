// Multi-round self-review. All inputs here are synthetic, independently
// authored by the patch author; they are not fresh or human-labelled model samples.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const {validatePersonaCompletion:validate}=lib('personaCompletion');
const room=lib('room'), people=lib('personas').defaultPersonas();
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','c01-v4-self-review.json'),'utf8'));
const now=new Date(2026,10,24,15,0).getTime();
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'replay',fallbackModel:'',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const tasks=[...new Set(fixtures.map(x=>x.task))];
assert.equal(fixtures.length,148);
assert.equal(new Set(fixtures.map(x=>x.task+'\0'+x.text)).size,fixtures.length);
async function throughRoom(task,raw,expected,opts={}){
 const r=room.newRoom(people.slice(0,4),now,'self-review');
 const step={id:'review-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000};
 const input={...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
 const oldFetch=global.fetch,oldRandom=Math.random;let calls=0;
 Math.random=()=>0.99;
 global.fetch=async url=>{assert.match(String(url),/^https:\/\/audit\.invalid\//);calls++;
  if(opts.sse){const mid=Math.floor(raw.length/2);const chunk=(text,finish=null)=>'data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:finish}]})+'\n\n';return new Response(chunk(raw.slice(0,mid))+chunk(raw.slice(mid),opts.finish||'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
  return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:opts.finish||'stop'}]}),{status:opts.status||200,headers:{'content-type':'application/json'}});
 };
 try{const out=await room.tickRoom({room:input,config,settings,now});const saved=out.room.steps.find(x=>x.id===step.id);assert.ok(saved);assert.equal(saved.text,task);assert.equal(calls,1);assert.equal(out.calls,1);assert.equal(out.room.usage.messages,1);assert.equal(saved.doneAt,expected?now:undefined);assert.equal(out.room.messages.length,expected?1:0);if(expected){assert.equal(out.room.messages[0].stepId,step.id);assert.equal(out.room.messages[0].text,raw.slice(5).trim());assert.equal(out.logs.length,0);}else{assert.ok(saved.dueAt>=now+5*60000);assert.ok(out.logs.length);assert.ok(!out.logs.join(' ').includes(raw));}}
 finally{global.fetch=oldFetch;Math.random=oldRandom;}
}
for(const [i,r] of fixtures.entries())test(`round${r.round} fixture ${i+1} ${r.expected?'accept':'reject'}: ${r.text}`,async()=>{
 const raw='DONE|'+r.text;
 assert.equal(validate({text:r.task},raw).kind==='done',r.expected);
 await throughRoom(r.task,raw,r.expected);
});
// Each transformation has a known invalid meaning, not a random word edit.
// Count one test per base case so transformed cases are not presented as
// independent product defects. No transformation is used to change labels.
const positives=fixtures.filter(x=>x.expected);
for(const [i,r] of positives.entries())test(`round3 mutation matrix ${i+1}: ${r.text}`,()=>{
 const variants=[
  'DONE|准备'+r.text,'DONE|如果'+r.text,'DONE|假装'+r.text,'DONE|还没'+r.text,
  'DONE|'+r.text+'，后来撤回了','DONE|'+r.text+'，其实只做了一半',
  'DONE|'+r.text+'，实际失败了','DONE|'+r.text+'，结果没保存',
  'DONE|'+r.text+'\u2060','DONE|'+r.text+'\u2061','DONE|'+r.text+'\u200B',
  'DONE|'+r.text+'\nNOT_DONE|没做完','DONE|'+r.text+'|DONE',
  'NOT_DONE|'+r.text,'DONE|'+r.text+'，你加我微信',
  'DONE|'+r.text+'，只有我懂你','DONE|'+r.text+'x'.repeat(41),
 ];
 for(const raw of variants)assert.notEqual(validate({text:r.task},raw).kind,'done',raw);
 for(const other of tasks)if(other!==r.task)assert.notEqual(validate({text:other},'DONE|'+r.text).kind,'done',other+' / '+r.text);
 assert.notEqual(validate({text:r.task,actionId:'lab-unit-2'},'DONE|'+r.text).kind,'done');
});
// Exercise real tickRoom -> streamChat -> commit, including two SSE chunks.
for(const r of positives.filter((r,i)=>i%13===0)){
 for(const [tag,opts,expected] of [['SSE stop',{sse:true},true],['SSE length',{sse:true,finish:'length'},false],['JSON filter',{finish:'content_filter'},false],['JSON length',{finish:'length'},false],['HTTP error',{status:503},false]])test(`round3 ${tag}: ${r.text}`,()=>throughRoom(r.task,'DONE|'+r.text,expected,opts));
}
