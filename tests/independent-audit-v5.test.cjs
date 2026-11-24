// Independent local fault injection. No real credentials, network or browser data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const room=lib('room'),llm=lib('llm'),decompose=lib('decompose'),vision=lib('materialVision'),capture=lib('materialCapture');
const people=lib('personas').defaultPersonas();
const now=Date.now(),day=new Date(now).toDateString();
const R='shudong.room.v1',S='shudong.roomsettings.v1',L='shudong.roomusage.v1',J='shudong.reset.v1';
const settings={liveliness:0,timeFlow:false,dailyMessages:8};
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'primary',fallbackModel:'backup',visionModel:'vision',apiKey:'synthetic-only'};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRxgAAAAASUVORK5CYII=';
const mk=()=>({...room.newRoom(people.slice(0,4),now,'Audit'),messages:[],steps:[],scheduled:[],lastMessageAt:now,lastSeenAt:now});
const response=text=>new Response(JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
const storePath=path.join(__dirname,'..','src','lib','store.ts');
const fresh=()=>{delete require.cache[require.resolve(storePath)];return require(storePath);};
const fake=(rows={},fault={})=>{const data=new Map(Object.entries(rows));return new Proxy({data,getItem:k=>{if(fault.get===k)throw Error('read failure');return data.get(k)??null;},setItem:(k,v)=>{if(fault.set===k)throw Error('write failure');data.set(k,String(v));},removeItem:k=>{if(fault.remove===k)throw Error('remove failure');data.delete(k);}}, {ownKeys:()=>[...data.keys()],getOwnPropertyDescriptor:(_,k)=>data.has(k)?{enumerable:true,configurable:true}:undefined});};
const withStore=async(storage,run)=>{const old=global.localStorage;global.localStorage=storage;try{return await run(fresh());}finally{if(old===undefined)delete global.localStorage;else global.localStorage=old;}};
const withFetch=async(fn,run)=>{const old=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=old;}};
const session=s=>s.captureStorageSession?.();
const chat=(extra={})=>llm.streamChat({config,messages:[{role:'user',content:'synthetic note'}],signal:new AbortController().signal,onDelta:()=>{},...extra});
const tryCall=async(fn)=>{try{await fn();}catch{/* rejection is expected in negative cases */}};
for(let i=1;i<=3;i++)test(`same-page reset revokes loaded room snapshot cycle ${i}`,async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{const token=session(s),old=s.loadRoom();assert.equal(s.clearAll().ok,true);s.saveRoom(old,token);assert.equal(storage.getItem(R),null);const newer=mk();s.saveRoom(newer,session(s));assert.equal(JSON.parse(storage.getItem(R)).id,newer.id);s.saveRoom(old,token);assert.equal(JSON.parse(storage.getItem(R)).id,newer.id);});
});
test('stale mounted room settings and archives cannot survive reset',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{const token=session(s);s.loadRoom();assert.equal(s.clearAll().ok,true);s.saveRoomSettings(settings,token);s.saveArchives([r],token);assert.equal(storage.getItem(S),null);assert.equal(s.loadArchives().length,0);});
});
test('old loaded room cannot be reauthorized by a fresh explicit token after reset',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{const old=s.loadRoom();s.clearAll();s.saveRoom(old,session(s));assert.equal(storage.getItem(R),null);});
});
test('old room cannot reserve fresh usage after reset',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{const old=s.loadRoom(),token=session(s);s.clearAll();assert.equal(s.reserveRoomRequest(old,8,now,token),false);assert.equal(storage.getItem(L),null);});
});
test('new storage session can persist a new room after successful reset',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{s.loadRoom();assert.equal(s.clearAll().ok,true);const newer=mk();s.saveRoom(newer,session(s));assert.equal(s.loadRoom().id,newer.id);});
});
test('unreadable reset marker closes all three permission checks and preserves bytes',async()=>{
 const r=mk(),raw=JSON.stringify(r),fault={get:J};await withStore(fake({[R]:raw},fault),s=>{assert.equal(s.canWriteAppStorage(),false);assert.equal(s.resetBlocksGeneration(),true);assert.equal(s.isClearIncomplete(),true);s.saveRoom(mk());assert.equal(global.localStorage.getItem(R),raw);});
});
const routes={chat:()=>chat(),connection:()=>llm.testConnection(config),material:()=>vision.extractMaterial(config,image),capture:()=>capture.captureFirstStep({config,imageDataUrl:image,persona:people[0],now}),notice:()=>decompose.recognizeNotice(config,image),visionProbe:()=>decompose.testVisionConnection(config),decompose:()=>decompose.decomposeViaApi(config,{goalText:'write notes',answers:{},skipped:true,onRequestAttempt:()=>{}}),room:()=>room.requestStep(mk(),{config,settings,now})};
for(const [name,fn] of Object.entries(routes))test(`reset read failure blocks actual HTTP at ${name}`,async()=>{
 let calls=0;await withStore(fake({},{get:J}),async()=>withFetch(async()=>{calls++;return response('NONE');},async()=>{await tryCall(fn);assert.equal(calls,0);}));
});
test('reset after primary HTTP blocks fallback even if fresh storage now writable',async()=>{
 let calls=0;await withStore(fake(),async s=>withFetch(async()=>{calls++;if(calls===1){assert.equal(s.clearAll().ok,true);return new Response('synthetic failure',{status:500});}return response('late fallback');},async()=>{await assert.rejects(chat());assert.equal(calls,1);}));
});
test('reset after response starts prevents text result and onDelta adoption',async()=>{
 let delta=0;await withStore(fake(),async s=>withFetch(async()=>{s.clearAll();return response('late reply');},async()=>{await assert.rejects(chat({onDelta:()=>delta++}));assert.equal(delta,0);}));
});
test('reset between authorization and actual POST prevents network',async()=>{
 let calls=0;await withStore(fake(),async s=>withFetch(async()=>{calls++;return response('late reply');},async()=>{await assert.rejects(chat({onRequestAttempt:()=>s.clearAll()}));assert.equal(calls,0);}));
});
for(const [key,raw] of [[L,'{"day":"x","messages":-1}'],[S,'{"dailyMessages":"bad"}'],[R,'{"id":"bad"}']])test(`live malformed ${key} blocks every room write and preserves bytes`,async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r)});await withStore(storage,s=>{const token=session(s);s.loadRoom();storage.setItem(key,raw);const before=Object.fromEntries(storage.data);s.saveRoom({...r,title:'bad overwrite'},token);s.saveRoomSettings(settings,token);s.saveArchives([r],token);assert.equal(s.reserveRoomRequest(r,8,now,token),false);assert.deepEqual(Object.fromEntries(storage.data),before);assert.equal(s.roomStorageBlocked(),true);});
});
for(const key of [L,S,R])test(`live unreadable ${key} blocks room/settings/archive writes`,async()=>{
 const r=mk(),fault={},storage=fake({[R]:JSON.stringify(r)},fault);await withStore(storage,s=>{const token=session(s);s.loadRoom();fault.get=key;const before=Object.fromEntries(storage.data);s.saveRoom({...r,title:'bad overwrite'},token);s.saveRoomSettings(settings,token);s.saveArchives([r],token);assert.equal(s.reserveRoomRequest(r,8,now,token),false);assert.deepEqual(Object.fromEntries(storage.data),before);});
});
test('explicit discard of corrupt ledger permits safe room storage again',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r),[L]:'{"day":"x","messages":-1}'});await withStore(storage,s=>{assert.equal(s.roomStorageBlocked(),true);assert.ok(s.discardCorruptStorage().removed.includes(L));s.saveRoom({...r,title:'recovered'},session(s));assert.equal(s.loadRoom().title,'recovered');});
});
test('normal room persistence retains paid ledger floor',async()=>{
 const r=mk(),storage=fake({[R]:JSON.stringify(r),[L]:JSON.stringify({day,messages:3})});await withStore(storage,s=>{const token=session(s);s.loadRoom();assert.equal(s.reserveRoomRequest(r,8,now,token),true);s.saveRoom(r,token);assert.equal(JSON.parse(storage.getItem(R)).usage.messages,4);});
});
for(const result of ['1|先写一行','not-an-action|先写一行','ID|先写一行|再做一步','ID|先写一行\n另一个步骤','ID|先写一行\u2028另一个步骤'])test(`manual protocol rejects ${JSON.stringify(result)}`,async()=>{
 await withFetch(async(_u,init)=>{const id=JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1];return response(result.replace('ID',id));},async()=>{const out=await room.requestStep(mk(),{config,settings,now});assert.equal(out.room.steps.length,0);assert.equal(out.room.messages.length,0);assert.ok(out.logs.length);});
});
test('manual protocol accepts exact candidate and stores trusted matching label',async()=>{
 await withFetch(async(_u,init)=>{const id=JSON.parse(init.body).messages.at(-1).content.match(/^([^\s|]+) \| /m)[1];return response(id+'|先写一行');},async()=>{const out=await room.requestStep(mk(),{config,settings,now});assert.equal(out.room.steps.length,1);assert.equal(out.room.messages[0].text,out.room.steps[0].text);});
});
// Additional self-review: an affirmative verb is not enough when hedged.
const due=()=>{const r=mk();r.steps=[{id:'persona-step',text:'写一行笔记',ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000}];return r;};
for(const result of ['DONE|我可能写了一行笔记。','DONE|我好像完成了。','DONE|我差不多完成了。','DONE|我大致完成了。','DONE|我只写了一点笔记。','DONE|我写了一行\v另一个结果'])test(`completion protocol refuses uncertain or control-separated ${JSON.stringify(result)}`,async()=>{
 await withFetch(async()=>response(result),async()=>{const out=await room.tickRoom({room:due(),settings:{...settings,dailyMessages:1},config,now});assert.equal(out.room.steps[0].doneAt,undefined);assert.equal(out.room.messages.length,0);assert.ok(out.logs.length);});
});
test('completion protocol retains a definite positive result',async()=>{
 await withFetch(async()=>response('DONE|我写了一行笔记。'),async()=>{const out=await room.tickRoom({room:due(),settings:{...settings,dailyMessages:1},config,now});assert.equal(out.room.steps[0].doneAt,now);assert.equal(out.room.messages.length,1);});
});
