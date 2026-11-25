// Verify all current autonomous-action roots via the real completion path.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const room=lib('room');
const {ACTIONS}=lib('actions');
const {personaCompletionExample,validatePersonaCompletion}=lib('personaCompletion');
const roots=ACTIONS.filter(a=>!ACTIONS.some(x=>x.smaller===a.id));
const people=lib('personas').defaultPersonas();
const now=new Date(2026,10,24,15,0).getTime();
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'synthetic',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
for(const action of roots) test(`current autonomous action has bounded successful and failure path: ${action.id}`,async()=>{
  const task={text:action.label,actionId:action.id};
  const example=personaCompletionExample(task);
  assert.ok(example,'new catalog roots must define completion evidence before enabling real generation');
  assert.equal(personaCompletionExample({text:'unrelated imported task',actionId:action.id}),null);
  // Each reviewed example is accepted only as a result of this task. The
  // negative checks include every destructive/negating suffix, not just R6.
  for(const tail of ['，又全删了','，没保存','，还没完成','，只是计划','，只做了一半']) assert.notEqual(validatePersonaCompletion(task,'DONE|'+example+tail).kind,'done');
  assert.notEqual(validatePersonaCompletion(task,'DONE|完成了').kind,'done');
  const r=room.newRoom(people.slice(0,4),now,'Synthetic catalog');
  const step={...task,id:'step',ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000};
  const input={...r,messages:[],steps:[step],scheduled:[],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
  const old=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'DONE|'+example},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});};
  try {
    const out=await room.tickRoom({room:input,config,settings,now});
    assert.equal(calls,1);assert.equal(out.calls,1);assert.equal(out.room.steps[0].doneAt,now);assert.equal(out.room.messages[0].stepId,'step');assert.equal(out.room.messages[0].text,example);
  } finally {global.fetch=old;}
});
