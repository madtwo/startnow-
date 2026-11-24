// Independent red/green regression probes. All network responses and data are synthetic.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const policy=lib('forumReplyPolicy'), room=lib('room'), safety=lib('safety'), dialogue=lib('dialogue');
const people=lib('personas').defaultPersonas();
const now=new Date(2026,10,24,15,30).getTime();
const today=new Date(now).toDateString();
const identity={id:'me',name:'Audit',avatarKey:'moon',bio:''};
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'primary',fallbackModel:'',apiKey:'synthetic-only'};
const mock={providerId:'mock',baseUrl:'',model:'demo',apiKey:''};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const response=text=>new Response(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
const withFetch=async(fn,run)=>{const old=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=old;}};
const mkRoom=()=>({...room.newRoom(people.slice(0,4),now,identity.name),messages:[],steps:[],scheduled:[],lastMessageAt:now,lastSeenAt:now});
const message=(id,text,at,authorKind='player',authorId='me')=>({id,text,at,authorId,authorName:'Audit',authorKind,kind:'chat'});
const dueRoom=(text='写一行笔记')=>{const r=mkRoom();r.steps=[{id:'persona-step',text,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000}];return r;};
const storePath=path.join(__dirname,'..','src','lib','store.ts');
const freshStore=()=>{delete require.cache[require.resolve(storePath)];return require(storePath);};
const fakeStorage=(rows={},fault={})=>{const data=new Map(Object.entries(rows));return {data,getItem:k=>{if(fault.get===k)throw Error('read failure');return data.get(k)??null},setItem:(k,v)=>{if(fault.set===k)throw Error('write failure');data.set(k,String(v))},removeItem:k=>{if(fault.remove===k)throw Error('delete failure');data.delete(k)}};};
const withStore=async(storage,run)=>{const old=global.localStorage;global.localStorage=storage;try{return await run(freshStore());}finally{global.localStorage=old;}};
const ROOM='shudong.room.v1', LEDGER='shudong.roomusage.v1', RESET='shudong.reset.v1';

for(const cp of ['\u0000','\u0007','\u0085','\u0600','·','•','・']) test(`v4 screening: ${cp.codePointAt(0).toString(16)} inserted inside contact and dependency terms`,()=>{
  for(const plain of ['加我微信吧','只有我能帮助你。','你只需要我']) assert.equal(policy.unsafeForumRaw([...plain].join(cp)),true,plain);
});
test('v4 shared safety screen rejects control-obfuscated crisis and contact request',()=>{
 assert.equal(safety.findCrisis('我想\u0000消失'),true);
 assert.equal(dialogue.boundaryRequest('给我你的微\u0007信'), 'contact');
});
test('v4 safety benign controls: ordinary text, explicit online-only boundary and third-party advice remain allowed',()=>{
 for(const text of ['今\u0000天写了一行笔记。','我们只在线上聊天，不见面。','加她微信之前先接一句','老师的邮箱已经写在通知里。'])assert.equal(policy.unsafeForumRaw(text),false,text);
});

for(const text of ['DONE|！！！','DONE|我只做了一半。','DONE|明天再做完。','DONE|我还差最后一步。','DONE|我没有完全完成。','DONE|我没法完成。','DONE|我并未完成。','DONE|我不确定完成了没有。','DONE|我写了一行笔记。'+('今天心情不错，'.repeat(10))])test(`v4 fictional completion rejects ${text.slice(0,30)}`,async()=>{
 const r=dueRoom();let n=0;await withFetch(async()=>{n++;return response(text)},async()=>{
   const out=await room.tickRoom({room:r,settings,config,now});assert.equal(n,1);assert.equal(out.calls,1);assert.equal(out.room.steps[0].doneAt,undefined);assert.equal(out.room.messages.length,0);assert.ok(out.room.steps[0].dueAt>now);
 });
});
for(const text of ['DONE|我写了一行笔记。','DONE|我把标题写好了。','DONE|我核对完单位了。'])test(`v4 fictional completion positive ${text}`,async()=>{
 await withFetch(async()=>response(text),async()=>{const out=await room.tickRoom({room:dueRoom(),settings,config,now});assert.equal(out.room.steps[0].doneAt,now);assert.equal(out.room.messages[0].text,text.slice(5));});
});
test('v4 manual request rejects punctuation-only words even with a valid candidate ID',async()=>{
 await withFetch(async(_u,init)=>{const id=JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1];return response(id+'|！！！')},async()=>{const out=await room.requestStep(mkRoom(),{config,settings,now});assert.equal(out.calls,1);assert.equal(out.room.steps.length,0);assert.equal(out.room.messages.length,0);});
});

test('v4 due persona step cannot bypass recent player crisis gate',async()=>{
 const r=dueRoom();r.messages=[message('crisis','我想消失',now-1000)];let n=0;await withFetch(async()=>{n++;return response('DONE|我写了一行笔记。')},async()=>{const out=await room.tickRoom({room:r,config,settings,now});assert.equal(n,0);assert.equal(out.calls,0);assert.equal(out.room.steps[0].doneAt,undefined);});
});
test('v4 imported crisis step text is not sent to model',async()=>{
 const r=dueRoom('我想消失');let n=0;await withFetch(async()=>{n++;return response('DONE|我写了一行笔记。')},async()=>{const out=await room.tickRoom({room:r,config,settings,now});assert.equal(n,0);assert.equal(out.calls,0);assert.equal(out.room.steps[0].doneAt,undefined);});
});
test('v4 crisis in imported persona history blocks manual model history transmission',async()=>{
 const r=mkRoom();r.messages=[message('crisis','我想消失',now-2,'persona',r.cast[0].id),message('u','我在写笔记',now-1)];let n=0;await withFetch(async()=>{n++;return response('NONE')},async()=>{const out=await room.requestStep(r,{config,settings,now});assert.equal(n,0);assert.equal(out.calls,0);});
});
test('v4 catch-up on crisis history neither sends requests nor adds fictional activity',async()=>{
 const r=mkRoom();r.lastSeenAt=now-20*60000;r.messages=[message('crisis','我想消失',r.lastSeenAt)];let n=0;await withFetch(async()=>{n++;return response('我写了一行笔记。')},async()=>{const out=await room.catchUpRoom({room:r,config,settings:{...settings,timeFlow:true},now});assert.equal(n,0);assert.deepEqual(out.room.messages,r.messages);});
});

test('v4 completion returned after deletion must not publish a stale claim; usage preserved',async()=>{
 const snap=dueRoom();let release,started;const reached=new Promise(r=>started=r);await withFetch(async()=>{started();return new Promise(r=>release=()=>r(response('DONE|我写了一行笔记。')))},async()=>{const p=room.tickRoom({room:snap,config,settings,now});await reached;const current=room.dropStep(snap,'persona-step');release();const out=await p;assert.ok(out.room.steps[0].doneAt);const merged=room.commitRoomOperation(current,snap,out.room,now);assert.equal(merged.steps.length,0);assert.equal(merged.messages.length,0);assert.equal(merged.usage.messages,1);});
});
test('v4 completion returned after step edit must not publish old action claim',async()=>{
 const snap=dueRoom();await withFetch(async()=>response('DONE|我写了一行笔记。'),async()=>{const out=await room.tickRoom({room:snap,config,settings,now});const current={...snap,steps:[{...snap.steps[0],text:'核对单位'}]};const merged=room.commitRoomOperation(current,snap,out.room,now);assert.equal(merged.steps[0].text,'核对单位');assert.equal(merged.steps[0].doneAt,undefined);assert.equal(merged.messages.length,0);});
});
test('v4 positive concurrent completion retains both new user message and confirmed linked completion',async()=>{
 const snap=dueRoom();await withFetch(async()=>response('DONE|我写了一行笔记。'),async()=>{const out=await room.tickRoom({room:snap,config,settings,now});const current={...snap,messages:[message('u','我来了',now+1)],lastMessageAt:now+1};const merged=room.commitRoomOperation(current,snap,out.room,now);assert.equal(merged.steps[0].doneAt,now);assert.equal(merged.messages.length,2);assert.ok(merged.messages.some(m=>m.text==='我写了一行笔记。'));});
});
test('v4 manual action cannot survive the removal of its generating persona during merge',async()=>{
 const snap=mkRoom();await withFetch(async(_u,init)=>{const id=JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1];return response(id+'|先写一行')},async()=>{const out=await room.requestStep(snap,{config,settings,now});assert.equal(out.room.steps.length,1);const author=out.room.steps[0].fromPersonaId;const current={...snap,cast:snap.cast.filter(p=>p.id!==author)};const merged=room.commitRoomOperation(current,snap,out.room,now);assert.equal(merged.steps.length,0);assert.equal(merged.messages.length,0);assert.equal(merged.usage.messages,1);});
});
test('v4 CAS rejects orphan reply chains whose generated parent was removed',()=>{
 const snap=mkRoom();const parent=message('parent','旧角色回复',now,'persona',snap.cast[0].id);const child={...message('child','接话',now+1,'persona',snap.cast[1].id),replyTo:'parent'};const current={...snap,cast:snap.cast.slice(1)};const result={...snap,messages:[parent,child]};assert.deepEqual(room.commitRoomOperation(current,snap,result,now).messages,[]);
});
test('v4 scheduled reaction to removed step is discarded before HTTP',async()=>{
 const r=mkRoom();r.scheduled=[{id:'react',personaId:r.cast[0].id,at:now-1,intent:'react',stepId:'removed'}];let n=0;await withFetch(async()=>{n++;return response('做完了。')},async()=>{const out=await room.tickRoom({room:r,config,settings,now});assert.equal(n,0);assert.equal(out.calls,0);assert.equal(out.room.messages.length,0);assert.ok(!out.room.scheduled.some(s=>s.id==='react'));});
});

for(const [name,mutate] of [
 ['situation.knows',r=>{r.cast[0].situation={day:today,agenda:'a',worry:'b',busy:0,busyLabel:'c',knows:'not-array'}}],
 ['relations',r=>{r.cast[0].relations={me:'not-a-number'}}],
 ['mind',r=>{r.cast[0].mind={thought:4}}],
 ['message.replyTo',r=>{r.messages=[{...message('m','普通消息',now),replyTo:{bad:true}}]}],
 ['scheduled.stepId',r=>{r.scheduled=[{id:'a',personaId:r.cast[0].id,at:now,intent:'react',stepId:7}]}],
 ['invalid time',r=>{r.lastSeenAt=Infinity}],
])test(`v4 invalid nested room ${name} is quarantined and raw bytes retained`,async()=>{
 const r=mkRoom();mutate(r);const raw=JSON.stringify(r);await withStore(fakeStorage({[ROOM]:raw}),s=>{assert.equal(s.loadRoom(),null);s.saveRoom(mkRoom());assert.equal(global.localStorage.getItem(ROOM),raw);assert.ok(s.listCorruptStorageKeys().includes(ROOM));});
});
test('v4 legacy room missing optional fields and valid normal room both load',async()=>{
 const r=mkRoom();for(const p of r.cast){delete p.situation;delete p.relations;delete p.mind;}await withStore(fakeStorage({[ROOM]:JSON.stringify(r)}),s=>assert.equal(s.loadRoom().id,r.id));
});
test('v4 explicit zero and malformed room limits cannot silently become positive quota',async()=>{
 for(const limit of [0,-1,'bad',0.9])await withStore(fakeStorage({'shudong.roomsettings.v1':JSON.stringify({...settings,dailyMessages:limit})}),s=>assert.equal(s.loadRoomSettings().dailyMessages,0));
});
test('v4 legacy missing room quota retains default; upper bound is finite',async()=>{
 await withStore(fakeStorage({'shudong.roomsettings.v1':'{"liveliness":0.5}'}),s=>assert.ok(s.loadRoomSettings().dailyMessages>0));
 await withStore(fakeStorage({'shudong.roomsettings.v1':'{"dailyMessages":1e400}'}),s=>assert.equal(s.loadRoomSettings().dailyMessages,0));
});

test('v4 real POST is pre-reserved and stays charged when result is never committed (unmount simulation)',async()=>{
 const r=mkRoom(),storage=fakeStorage({[ROOM]:JSON.stringify(r)});await withStore(storage,async s=>{
 let n=0;await withFetch(async()=>{n++;const raw=storage.getItem(LEDGER);assert.ok(raw,'reservation must exist before fetch');assert.equal(JSON.parse(raw).messages,1);throw Error('offline')},async()=>{
   const out=await room.requestStep(r,{config,settings,now,reserveAttempt:()=>s.reserveRoomRequest(r,1,now)});assert.equal(n,1);assert.equal(out.calls,1);assert.equal(out.room.steps.length,0);
   // Discard returned room as React would after unmount. Read through a new store instance.
   const next=freshStore().withRoomUsageFloor(r,now);assert.equal(room.usedToday(next,now),1);
   const second=await room.requestStep(next,{config,settings,now,reserveAttempt:()=>s.reserveRoomRequest(next,1,now)});assert.equal(second.calls,0);assert.equal(n,1);
 });});
});
test('v4 quota fallback POST cannot bypass persisted reservation limit',async()=>{
 const r=mkRoom(),storage=fakeStorage();await withStore(storage,async s=>{
   let n=0;await withFetch(async()=>{n++;return new Response('synthetic failure',{status:500})},async()=>{
     const out=await room.requestStep(r,{config:{...config,fallbackModel:'backup'},settings:{...settings,dailyMessages:3},now,reserveAttempt:()=>s.reserveRoomRequest(r,1,now)});assert.equal(n,1);assert.equal(out.calls,1);assert.equal(JSON.parse(storage.getItem(LEDGER)).messages,1);
   });
 });
});
test('v4 ledger write failure blocks network before HTTP',async()=>{
 const r=mkRoom();await withStore(fakeStorage({},{set:LEDGER}),async s=>{let n=0;await withFetch(async()=>{n++;return response('NONE')},async()=>{const out=await room.requestStep(r,{config,settings,now,reserveAttempt:()=>s.reserveRoomRequest(r,1,now)});assert.equal(n,0);assert.equal(out.calls,0);assert.ok(s.listFailedStorageKeys().includes(LEDGER));});});
});
test('v4 corrupt usage ledger is preserved and paid attempts blocked',async()=>{
 const r=mkRoom(),raw='{"day":"x","messages":-1}';await withStore(fakeStorage({[LEDGER]:raw}),s=>{assert.equal(s.reserveRoomRequest(r,10,now),false);assert.equal(global.localStorage.getItem(LEDGER),raw);assert.equal(s.roomStorageBlocked(),true);});
});
test('v4 new day reservation is not confused with prior day or stale room save',async()=>{
 const r=mkRoom();const nextDay=now+86400000;await withStore(fakeStorage(),s=>{assert.equal(s.reserveRoomRequest(r,2,now),true);assert.equal(s.reserveRoomRequest(r,2,now),true);assert.equal(s.reserveRoomRequest(r,2,now),false);assert.equal(s.reserveRoomRequest(r,2,nextDay),true);assert.equal(room.usedToday(s.withRoomUsageFloor(r,nextDay),nextDay),1);});
});
test('v4 ordinary mock chat never reserves paid quota',async()=>{
 const r=mkRoom();let reserves=0;await withFetch(async()=>{assert.fail('mock made a network call')},async()=>{const out=await room.requestStep(r,{config:mock,settings,now,reserveAttempt:()=>{reserves++;return false}});assert.equal(out.calls,0);assert.equal(reserves,0);assert.equal(out.room.steps.length,1);});
});

test('v4 partial clear survives reload and retry with raw residual protected',async()=>{
 const r=mkRoom(),raw=JSON.stringify(r),fault={remove:ROOM},storage=fakeStorage({[ROOM]:raw},fault);await withStore(storage,s=>{
   assert.equal(s.clearAll().ok,false);assert.ok(JSON.parse(storage.getItem(RESET)).pending);assert.equal(storage.getItem(ROOM),raw);
   const restarted=freshStore();assert.equal(restarted.isClearIncomplete(),true);restarted.saveRoom({...r,title:'must not overwrite'});assert.equal(storage.getItem(ROOM),raw);
   delete fault.remove;assert.equal(restarted.clearAll().ok,true);assert.equal(storage.getItem(ROOM),null);assert.equal(JSON.parse(storage.getItem(RESET)).pending,false);
 });
});
test('v4 reset journal write failure does not partially clear user data',async()=>{
 const r=mkRoom(),raw=JSON.stringify(r),storage=fakeStorage({[ROOM]:raw},{set:RESET});await withStore(storage,s=>{const out=s.clearAll();assert.equal(out.ok,false);assert.equal(out.removed.length,0);assert.equal(storage.getItem(ROOM),raw);assert.ok(out.failed.includes(RESET));});
});
test('v4 old tab cannot write or clear after observing old epoch and another tab completes reset (no event delivered)',async()=>{
 const r=mkRoom(),storage=fakeStorage({[ROOM]:JSON.stringify(r)});await withStore(storage,a=>{
   const old=a.loadRoom();assert.equal(old.id,r.id);const b=freshStore();assert.equal(b.clearAll().ok,true);const newer={...mkRoom(),title:'fresh data'};b.saveRoom(newer);const bytes=storage.getItem(ROOM);
   a.saveRoom(old);assert.equal(storage.getItem(ROOM),bytes);assert.equal(a.clearAll().ok,false);assert.equal(storage.getItem(ROOM),bytes);assert.equal(a.roomStorageBlocked(),true);
 });
});
test('v4 clear removes paid usage ledger and retains only non-private reset epoch',async()=>{
 const r=mkRoom(),storage=fakeStorage({[ROOM]:JSON.stringify(r),[LEDGER]:JSON.stringify({day:today,messages:1})});await withStore(storage,s=>{assert.equal(s.clearAll().ok,true);assert.equal(storage.getItem(LEDGER),null);assert.equal(storage.getItem(ROOM),null);assert.deepEqual(Object.keys(JSON.parse(storage.getItem(RESET))).sort(),['epoch','pending']);});
});
test('v4 direct room APIs fail closed on non-finite or fractional sub-one quotas',async()=>{
 for(const limit of [NaN,Infinity,-1,0.9]){
   const r=mkRoom();let n=0;await withFetch(async()=>{n++;return response('NONE')},async()=>{const out=await room.requestStep(r,{config,settings:{...settings,dailyMessages:limit},now});assert.equal(n,0,`limit ${limit}`);assert.equal(out.calls,0);});
 }
});
test('v4 crash recovery delegates to journaled clear and private draft writes are fenced by the app',()=>{
 const fs=require('node:fs');const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 const main=read('src/main.tsx'),app=read('src/App.tsx'),sheet=read('src/components/DecomposeSheet.tsx');
 assert.match(main,/const result = clearAll\(\)/);assert.doesNotMatch(main,/appStorageKeys\(\)\.forEach/);
 assert.match(app,/canPersist=\{canWriteAppStorage\}/);assert.match(sheet,/!canPersist\(\)\) return/);
});
test('v4 reset journal protects pre-event stale direct-draft permission and newly discovered app keys',async()=>{
 const storage=fakeStorage();const extra='startnow.extraPrivate';storage[extra]='synthetic';storage.data.set(extra,'synthetic');storage.data.set('unrelated.origin.key','leave alone');await withStore(storage,a=>{
   a.loadRoom();assert.equal(a.canWriteAppStorage(),true);const b=freshStore();assert.equal(b.clearAll().ok,true);assert.equal(storage.getItem(extra),null);assert.equal(storage.getItem('unrelated.origin.key'),'leave alone');assert.equal(a.canWriteAppStorage(),false);assert.equal(a.resetBlocksGeneration(),true);
 });
});
