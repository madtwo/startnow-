// Independent tests based on the v2 verdict summary and existing legacy fixtures.
// The verdict's original EVIDENCE files were not supplied. No actual model calls.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const policy=lib('forumReplyPolicy'), cardPolicy=lib('cardPolicy'), cards=lib('cards'), room=lib('room');
const people=lib('personas').defaultPersonas(), actions=lib('actions');
const now=new Date(2026,10,24,15,30).getTime();
const identity={id:'me',name:'Audit',avatarKey:'moon',bio:''};
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'primary',fallbackModel:'',apiKey:'synthetic-only'};
const mock={providerId:'mock',baseUrl:'',model:'demo',apiKey:''};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const response=text=>new Response(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
const withFetch=async(fn,run)=>{const old=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=old;}};
const mkRoom=()=>({...room.newRoom(people.slice(0,4),now,identity.name),messages:[],steps:[],scheduled:[],lastMessageAt:now,lastSeenAt:now});
const player=(id,text,at)=>({id,text,at,authorId:'me',authorName:'Audit',authorKind:'player',kind:'chat'});
const dueRoom=()=>{const r=mkRoom();r.steps=[{id:'persona-step',text:'写一行笔记',ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000}];return r;};
const card={id:'lab-card',authorId:'me',authorName:'Audit',authorKind:'player',kind:'worry',text:'实验数据异常，需要核对一列实验数据的单位',status:'advised',createdAt:now,arrivals:[],comments:[],pending:[],plan:[]};
const advised=text=>({...card,advice:{text,actionId:'lab-unit-2',fromPersonaId:people[0].id,at:now}});

for(const cp of ['\u2060','\u2061','\u202e','\u200e','\u00ad','\ufe0f','\u034f']) test(`v3 safety: ${cp.codePointAt(0).toString(16)} cannot split safety keywords`,()=>{
 for(const plain of ['加我微信吧','别离开我，我只剩你了。','只有我能帮助你。']){
  assert.equal(policy.unsafeForumRaw(plain),true,plain);
  assert.equal(policy.unsafeForumRaw([...plain].join(cp)),true,plain);
 }
});
test('v3 safety: benign ordinary text with format character is not blocked',()=>{
 assert.equal(policy.unsafeForumRaw('今\u2060天有点累，我在看笔记。'),false);
});
test('v3 safety: player dependency screening strips format characters',()=>{
 assert.equal(policy.forumDependencySignal('你\u2060能\u2061每天陪我吗'),true);
});
test('v3 safety: real room response with word joiner is not published',async()=>{
 const r=mkRoom();r.scheduled=[{id:'due',personaId:r.cast[0].id,at:now-1,intent:'welcome',depth:0}];
 await withFetch(async()=>response('加我微\u2060信吧'),async()=>{const out=await room.tickRoom({room:r,settings,config,now});assert.equal(out.room.messages.length,0);assert.equal(out.calls,1);assert.equal(out.room.usage.messages,1);});
});
for(const [name,fetch] of [
 ['network error',async()=>{throw new Error('synthetic offline')}],
 ['HTTP failure',async()=>new Response('{"error":{"message":"synthetic"}}',{status:500})],
 ['invalid selection',async()=>response('not-a-candidate|先打开文档')],
 ['empty wording',async(_u,init)=>response(JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1]+'|')],
 ['invisible-only wording',async(_u,init)=>response(JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1]+'|\u2060\u2061')],
 ['unsafe response',async(_u,init)=>response(JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1]+'|加我微\u2061信吧')],
]) test(`v3 manual real ${name}: no AI step or success message, attempt counted`,async()=>{
 const r=mkRoom();let n=0;
 await withFetch(async(...args)=>{n++;return fetch(...args)},async()=>{const out=await room.requestStep(r,{config,settings,now});assert.equal(out.room.steps.length,0);assert.equal(out.room.messages.length,0);assert.equal(n,1);assert.equal(out.calls,1);assert.equal(out.room.usage.messages,1);assert.ok(out.logs.length);});
});
test('v3 manual success: selected action, displayed text and stored step agree',async()=>{
 let selected;
 await withFetch(async(_u,init)=>{selected=[...JSON.parse(init.body).messages.at(-1).content.matchAll(/^([^\s|]+) \| (.+?)（\d+ 分钟）$/gm)][1];return response(selected[1]+'|'+selected[2]);},async()=>{
 const out=await room.requestStep(mkRoom(),{config,settings,now});assert.equal(out.room.steps.length,1);assert.equal(out.room.steps[0].actionId,selected[1]);assert.equal(out.room.steps[0].text,selected[2]);assert.equal(out.room.messages.at(-1).text,selected[2]);assert.equal(out.room.usage.messages,1);});
});
test('v3 manual demo mode still generates a simulated step without HTTP',async()=>{
 await withFetch(async()=>{assert.fail('mock must not call HTTP')},async()=>{const out=await room.requestStep(mkRoom(),{config:mock,settings,now});assert.equal(out.room.steps.length,1);assert.equal(out.calls,0);});
});
for(const [name,fetch] of [
 ['network failure',async()=>{throw new Error('synthetic offline')}],
 ['content filter',async()=>new Response(JSON.stringify({choices:[{message:{content:'DONE|做完了'},finish_reason:'content_filter'}]}),{headers:{'content-type':'application/json'}})],
 ['unsafe output',async()=>response('DONE|加我微\u2060信吧')],
 ['unstructured output',async()=>response('嗯，不知道有没有做完')],
 ['explicit not done',async()=>response('NOT_DONE|这次没有做完。')],
 ['contradictory done',async()=>response('DONE|我还没做完。')],
 ['obfuscated contradictory done',async()=>response('DONE|我还\u2060没\u2061做完。')],
 ['contradictory tail after truncation',async()=>response('DONE|'+'整理实验笔记的过程有一点点慢，'.repeat(5)+'其实还没做完。')],
]) test(`v3 persona ${name}: never mark done or publish completion claim`,async()=>{
 const r=dueRoom();let n=0;
 await withFetch(async(...args)=>{n++;return fetch(...args)},async()=>{const out=await room.tickRoom({room:r,settings,config,now});const step=out.room.steps.find(s=>s.id==='persona-step');assert.ok(step);assert.equal(step.doneAt,undefined);assert.equal(out.room.messages.length,0);assert.equal(n,1);assert.equal(out.calls,1);assert.equal(out.room.usage.messages,1);assert.ok(step.dueAt>now,'failed fictional step should not retry every 4 seconds');});
});
test('v3 persona explicit success preserves fictional completion and usage',async()=>{
 await withFetch(async()=>response('DONE|我写了一行笔记。'),async()=>{const out=await room.tickRoom({room:dueRoom(),settings,config,now});assert.equal(out.room.steps.find(s=>s.id==='persona-step').doneAt,now);assert.equal(out.room.messages.at(-1).text,'我写了一行笔记。');assert.equal(out.room.usage.messages,1);});
});
test('v3 persona demo completion remains functional',async()=>{
 await withFetch(async()=>{assert.fail('mock must not call HTTP')},async()=>{const out=await room.tickRoom({room:dueRoom(),settings,config:mock,now});assert.equal(out.room.steps.find(s=>s.id==='persona-step').doneAt,now);assert.equal(out.room.messages.length,1);assert.equal(out.calls,0);});
});
for(const text of ['先只核对表里那一列单位，对完就停，别顺手改别的。','先核对实验数据表里那一列单位，对完就停。','先核对实验数据中的那一列单位，三分钟后停下来。','要不先核对实验数据里的那一列单位，确认后就停。']) test(`v3 lab legacy complete: ${text}`,()=>{
 const note=cards.acceptAdvice(advised(text),now+1);assert.equal(note.status,'noted');const done=cards.completeCard(note,now+2);assert.equal(done.status,'done');
});
for(const text of ['先核对实验数据中的那一列单位，然后删掉无关合同。','先核对实验数据中的那一列单位，三分钟后重写实验报告。','先核对实验数据中的那一列单位，再把整张表修改。','先把实习简历删掉重写一版。'])test(`v3 lab negative: ${text}`,()=>{
 assert.equal(cardPolicy.validActionReference(card,{text,actionId:'lab-unit-2'}),false);
 assert.equal(cards.acceptAdvice(advised(text),now+1).status,'advised');
});
test('v3 all action IDs still reject an unrelated operation',()=>{
 for(const action of Object.values(actions.actionMap))assert.equal(cardPolicy.validActionReference(card,{text:'先打开一份无关合同，删掉第三行。',actionId:action.id}),false,action.id);
});
test('v3 CAS chronological order and preservation of both messages',()=>{
 const snap=mkRoom();snap.messages=[player('old','旧消息',now-1)];
 const current={...snap,messages:[...snap.messages,player('new','新消息',now+10)],lastMessageAt:now+10};
 const generated={id:'ai',text:'回复',at:now,authorId:snap.cast[0].id,authorName:snap.cast[0].name,authorKind:'persona',kind:'chat',replyTo:'old'};
 const result={...snap,messages:[...snap.messages,generated],lastMessageAt:now,usage:{...snap.usage,messages:1}};
 const merged=room.commitRoomOperation(current,snap,result,now);assert.deepEqual(merged.messages.map(m=>m.id),['old','ai','new']);assert.equal(merged.lastMessageAt,now+10);assert.equal(merged.usage.messages,1);
 const again=room.commitRoomOperation(merged,snap,result,now);assert.deepEqual(again.messages.map(m=>m.id),['old','ai','new']);
});
