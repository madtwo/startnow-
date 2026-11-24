// Independent adversarial checks based on the v1 review feedback. No real API calls.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {lib}=require('./_ts-loader.cjs');
const policy=lib('cardPolicy'), cards=lib('cards'), actions=lib('actions'), goals=lib('goals');
const storage=lib('store'), domain=lib('goalStorage'), schedule=lib('schedule'), room=lib('room');
const llm=lib('llm'), decompose=lib('decompose');
const people=lib('personas').defaultPersonas();
const persona=people[0], now=Date.now();
const identity={id:'me',name:'Audit',avatarKey:'moon',bio:''};
const base={id:'audit-card',authorId:'me',authorName:'Audit',authorKind:'player',kind:'worry',text:'论文开题报告不知道怎么开始',status:'advised',createdAt:now,arrivals:[],comments:[],pending:[],plan:[]};
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'primary',fallbackModel:'backup',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:50};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const reply=text=>json({choices:[{message:{content:text},finish_reason:'stop'}]});
const withFetch=async(fn,run)=>{const old=global.fetch;global.fetch=fn;try{return await run();}finally{global.fetch=old;}};
const withStore=(data,remove,run)=>{const old=global.localStorage;global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>remove(k)};try{return run();}finally{global.localStorage=old;}};
const advised=(text,id,card=base)=>({...card,advice:{text,actionId:id,fromPersonaId:persona.id,at:now}});
const mkRoom=()=>{const r=room.newRoom(people.slice(0,4),now,identity.name);return {...r,scheduled:[{id:'due',personaId:r.cast[0].id,at:now-1,intent:'welcome',depth:0}],steps:[],lastMessageAt:now,lastSeenAt:now};};
const goal=goals.makeGoal({title:'论文',source:'manual',steps:[{text:'写一段摘要'}],now});
const legacy={id:'legacy-schedule',ownerId:'me',title:'旧步骤',dateKey:schedule.dateKeyLocal(now),status:'todo',source:'goal',createdAt:now,stepId:goal.steps[0].id};
const accepted=(text,id,card)=>cards.acceptAdvice(advised(text,id,card),now).status;

test('v2 A09: no known action ID licenses an unrelated contract operation',()=>{
 const text='先打开一份无关合同，删掉第三行。';
 const bad=Object.values(actions.actionMap).filter(a=>policy.validActionReference(base,{text,actionId:a.id,fromPersonaId:persona.id}));
 assert.deepEqual(bad.map(a=>a.id),[]);
});
test('v2 A09: unrelated text cannot produce a completion receipt',()=>{
 const ids=Object.values(actions.actionMap).filter(a=>cards.completeCard(cards.acceptAdvice(advised('先打开一份无关合同，删掉第三行。',a.id),now),now).status==='done');
 assert.deepEqual(ids.map(a=>a.id),[]);
});
test('v2 A09: canonical action preserved but appended unrelated instruction denied',()=>{
 const a=actions.actionMap['draft-3'];assert.equal(accepted(a.line,a.id),'noted');
 assert.equal(accepted(a.line+'然后删掉无关合同。',a.id),'advised');
});
test('v2 A09: scoped roommate clarification works only with its context',()=>{
 const text='你可以先跟室友说清楚是键盘声，不用把整件事都摊开。';
 assert.equal(accepted(text,'peer-clarify-2',{...base,text:'室友敲键盘声太响，我不敢开口'}),'noted');
 assert.equal(accepted(text,'peer-clarify-2'),'advised');
});
test('v2 A09: legacy help wording remains executable',()=>assert.equal(accepted('我先找学校心理中心','help-3'),'noted'));
test('v2 A09: short document-open action remains executable',()=>assert.equal(accepted('先打开文档','draft-3'),'noted'));
test('v2 A09: adopt -> shrink -> accept -> complete, new source and original retained',()=>{
 const text='先打开文档，只写三行。'; const a={...advised(text,'draft-3'),comments:[{id:'c1',authorId:persona.id,authorKind:'persona',text,actionId:'draft-3',at:now-1}]};a.advice.sourceCommentId='c1';
 const shrunk=cards.shrinkAdvice(a,now+1);assert.notEqual(shrunk.advice.sourceCommentId,'c1');assert.ok(shrunk.comments.some(c=>c.id==='c1'));
 assert.equal(shrunk.comments.find(c=>c.id===shrunk.advice.sourceCommentId).text,shrunk.advice.text);
 const noted=cards.acceptAdvice(shrunk,now+2);assert.equal(noted.status,'noted');assert.equal(cards.completeCard(noted,now+3).status,'done');
});
test('v2 A06: legacy step-only schedule resolves to uniquely owned goal',()=>{
 const parsed=domain.parseSchedule([legacy],[goal]);assert.ok(parsed);assert.equal(parsed[0].goalId,goal.id);
 const bundle=JSON.stringify({version:3,cards:[base],personas:people,world:storage.emptyWorld(now),settings:storage.defaultSettings,identity,todos:[],goals:[goal],schedule:[legacy],summaries:[]});
 assert.ok(storage.importBundle(bundle));
});
test('v2 A06: ambiguous or orphan legacy row is retained without an invented link',()=>{
 const other={...goal,id:'another',steps:goal.steps.map(s=>({...s,goalId:'another'}))};
 for(const gs of [[goal,other],[]]){const rows=domain.parseSchedule([legacy],gs);assert.ok(rows);assert.equal(rows[0].goalId,undefined);assert.equal(rows[0].stepId,legacy.stepId);}
});
test('v2 A06: duplicate legacy link alongside explicit row preserves both',()=>{
 const rows=domain.parseSchedule([legacy,{...legacy,id:'explicit',goalId:goal.id}],[goal]);assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===legacy.id).goalId,undefined);
});
test('v2 A privacy: clear failure reports exact residual, blocks write, and allows retry',()=>{
 const key='shudong.room.v1';const r=mkRoom(), raw=JSON.stringify(r);const data=new Map([[key,raw]]);let fail=true;
 withStore(data,k=>{if(k===key&&fail)throw new Error('synthetic remove failure');data.delete(k)},()=>{
  const out=storage.clearAll();assert.equal(out.ok,false);assert.ok(out.failed.includes(key));assert.equal(data.get(key),raw);
  storage.saveRoom({...r,title:'must not write'});assert.equal(data.get(key),raw);
  fail=false;assert.equal(storage.clearAll().ok,true);assert.equal(data.has(key),false);
 });
});
test('v2 room: raw social and dependency output never displayed',async()=>{
 for(const text of ['这是我的微信abc123，你可以加我。','这是我的微\u200B信abc123，你可以加我。','别离开我，我只剩你了。'])await withFetch(async()=>reply(text),async()=>{
  const r=mkRoom(),out=await room.tickRoom({room:r,settings,config:{...config,fallbackModel:''},now});assert.equal(out.room.messages.filter(m=>m.kind==='chat').length,r.messages.filter(m=>m.kind==='chat').length,text);
 });
});
test('v2 room: earlier crisis in transmitted history prevents a new model request',async()=>{
 const r={...mkRoom(),scheduled:[]};r.messages.push({id:'c',authorId:'me',authorKind:'player',authorName:'Audit',text:'我想自杀，不知道还能撑多久',at:now-3000,kind:'chat'},{id:'p',authorId:r.cast[0].id,authorKind:'persona',authorName:r.cast[0].name,text:'我在听。',at:now-2000,kind:'chat'},{id:'n',authorId:'me',authorKind:'player',authorName:'Audit',text:'先帮我列一个今天能做的小步骤',at:now-1000,kind:'chat'});
 let n=0;await withFetch(async()=>{n++;return reply('invalid')},async()=>{const out=await room.requestStep(r,{config,now,settings});assert.equal(n,0);assert.equal(out.calls,0);assert.equal(out.room.steps.length,0);});
});
test('v2 room: a failed actual attempt consumes remaining daily budget',async()=>{
 let n=0;const s={...settings,dailyMessages:1};await withFetch(async()=>{n++;throw new Error('synthetic offline')},async()=>{
 const first=await room.tickRoom({room:mkRoom(),settings:s,config:{...config,fallbackModel:''},now});assert.equal(first.calls,1);assert.equal(first.room.usage.messages,1);
 const second=await room.tickRoom({room:{...first.room,scheduled:[{id:'retry',personaId:first.room.cast[0].id,at:now-1,intent:'welcome',depth:0}]},settings:s,config,now});assert.equal(second.calls,0);assert.equal(n,1);});
});
test('v2 room: deferred actual response and newer player message both survive commit',async()=>{
 let release,start;const reached=new Promise(r=>start=r);await withFetch(async()=>{start();return new Promise(r=>release=()=>r(reply('我刚来，打个招呼。')))},async()=>{
 const snap=mkRoom(),pending=room.tickRoom({room:snap,settings,config,now});await reached;
 const current=room.postPlayerMessage(snap,'生成期间的新消息',identity,[],undefined,now+5,0);release();const out=await pending;
 const merged=room.commitRoomOperation(current,snap,out.room,now);assert.ok(out.room.messages.some(m=>m.text==='我刚来，打个招呼。'));assert.ok(merged.messages.some(m=>m.text==='我刚来，打个招呼。'));assert.ok(merged.messages.some(m=>m.text==='生成期间的新消息'));
 const replaced=mkRoom();const stale=room.commitRoomOperation(replaced,snap,out.room,now);assert.equal(stale.id,replaced.id);assert.ok(!stale.messages.some(m=>m.text==='我刚来，打个招呼。'));
 });
});
test('v2 room: rejected steps have explicit failure outcomes',()=>{
 const r=mkRoom();assert.equal(room.tryAddStep(r,'我想自杀','',identity,now).ok,false);const other={...r,steps:[{id:'foreign',text:'打开文档',ownerId:persona.id,ownerName:persona.name,origin:'persona',createdAt:now}]};assert.equal(room.tryCompleteStep(other,'foreign',now,0).ok,false);
 assert.equal(room.tryAddStep(r,'打开文档','',identity,now).ok,true);
});
test('v2 room: corrupt archive does not block intact active room',()=>{
 const r=mkRoom(),data=new Map([['shudong.room.v1',JSON.stringify(r)],['shudong.archives.v1',JSON.stringify([{...r,cast:[{}]}])]]);
 withStore(data,k=>data.delete(k),()=>{assert.ok(storage.loadRoom());assert.deepEqual(storage.loadArchives(),[]);assert.equal(storage.roomStorageBlocked(),false);assert.equal(storage.archiveStorageBlocked(),true);storage.clearAll();});
});
for(const kind of ['json','sse','http-400','http-500'])test(`v2 LLM: ${kind} content filter cannot call fallback or compatibility retry`,async()=>{
 let n=0;await withFetch(async()=>{n++;if(n>1)return reply('fallback accepted');const payload={error:{code:'content_filter',message:'reasoning_effort unsupported'}};return kind==='sse'?new Response('data: '+JSON.stringify(payload)+'\n\n',{headers:{'content-type':'text/event-stream'}}):json(payload,kind==='http-400'?400:kind==='http-500'?500:200);},async()=>{
 await assert.rejects(llm.streamChat({config,messages:[{role:'user',content:'synthetic'}],signal:AbortSignal.timeout(2000),lowEffort:true,onDelta:()=>{}}));assert.equal(n,1);});
});
test('v2 LLM: legacy decomposition reserves each actual HTTP attempt',async()=>{
 let n=0,reserved=1;await withFetch(async(_url,init)=>{n++;return JSON.parse(init.body).model==='primary'?json({error:{message:'synthetic'}},500):reply('not valid JSON');},async()=>{
 await assert.rejects(decompose.decomposeViaApi(config,{goalText:'写论文',answers:{},skipped:[],personalized:false,onRetryAttempt:()=>reserved++}));assert.equal(n,4);assert.equal(reserved,n);});
});
test('v2 LLM: strict per-attempt authorization prevents exceeding one slot',async()=>{
 let n=0,reserved=0;await withFetch(async()=>{n++;return json({error:{message:'synthetic'}},500)},async()=>{
 await assert.rejects(decompose.decomposeViaApi(config,{goalText:'写论文',answers:{},skipped:[],personalized:false,onRequestAttempt:()=>{if(reserved>=1)throw new Error('quota');reserved++;}}));assert.equal(n,1);assert.equal(reserved,1);});
});
