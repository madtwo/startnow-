import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startServer } from '../server/server.mjs';
import { gatewayChatFetch, resetGatewaySessions } from '../src/lib/gatewayClient.ts';
const BASE='http://127.0.0.1:32123/v1';
const json=(content='ok',status=200)=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{status,headers:{'content-type':'application/json'}});
const frame=content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
const done='data: [DONE]\n\n';
const sse=(wire,status=200)=>new Response(wire,{status,headers:{'content-type':'text/event-stream'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const bounded=async(p,ms=450)=>{let timer;try{return await Promise.race([p,new Promise(r=>timer=setTimeout(()=>r('deadline'),ms))]);}finally{clearTimeout(timer);}};
const result=async(work)=>{try{const r=await work;return {status:r.status,text:await r.text()};}catch{return {status:0,text:''};}};
const statuses=g=>g.db.prepare('SELECT status FROM attempts ORDER BY rowid').all().map(x=>x.status);
const issue=async g=>{const r=await fetch(g.url+'/v1/session',{method:'POST'});assert.equal(r.status,201);return r.json();};
const chat=(g,s,stream=false,base=BASE,signal)=>fetch(g.url+'/v1/chat',{method:'POST',signal,headers:{'content-type':'application/json',authorization:'Bearer '+s.token,'x-provider-key':'synthetic-key'},body:JSON.stringify({providerBaseUrl:base,model:'synthetic',messages:[{role:'user',content:'hello'}],stream})});
async function app(t,options={}){const g=await startServer({sessionSecret:'synthetic-round4-secret-long',providerAllowlist:[BASE],logger:()=>{},...options});t.after(async()=>{g.server.closeAllConnections();await g.close();});return g;}
// These faults simulate an adapter which does not observe AbortSignal. A timed
// out attempt remains charged; no automatic retry or refund is allowed.
for(const mode of ['headers','json-body','sse-body','error-body'])test('server timeout bounds a noncooperative '+mode+' adapter',async t=>{
 const entered=deferred(), release=deferred();let signal,lateCancelled=false,streamController,calls=0;
 const g=await app(t,{providerTimeoutMs:80,concurrencyLimit:1,fetchImpl:async(_u,init)=>{
  if(++calls>1)return json();signal=init.signal;entered.resolve();
  if(mode==='headers'){await release.promise;return new Response(new ReadableStream({cancel(){lateCancelled=true;}}),{headers:{'content-type':'application/json'}});}
  return new Response(new ReadableStream({start(c){streamController=c;if(mode==='sse-body')c.enqueue(new TextEncoder().encode(frame('ok')));},cancel(){lateCancelled=true;return release.promise;}}),{status:mode==='error-body'?429:200,headers:{'content-type':mode==='sse-body'?'text/event-stream':'application/json'}});
 }});const s=await issue(g);const pending=result(chat(g,s,mode==='sse-body'));await entered.promise;let observed,second,settledBeforeRelease;
 try{observed=await bounded(pending);settledBeforeRelease=statuses(g);second=await bounded(result(chat(g,s)));}
 finally{release.resolve();try{streamController?.close();}catch{}await bounded(pending);await delay(10);}
 assert.notEqual(observed,'deadline');assert.ok(observed.status===504||observed.status===0);assert.equal(signal.aborted,true);assert.deepEqual(settledBeforeRelease,['timeout']);assert.equal(second.status,200);assert.deepEqual(statuses(g),['timeout','ok']);assert.equal(g._quotaUsed(s.sessionId),2);assert.equal(lateCancelled,true);
});
for(const mode of ['headers','body'])test('revoke terminates a noncooperative '+mode+' adapter before it resolves',async t=>{
 const entered=deferred(),release=deferred();let c;const g=await app(t,{providerTimeoutMs:5000,fetchImpl:async()=>{entered.resolve();if(mode==='headers'){await release.promise;return json();}return new Response(new ReadableStream({start(x){c=x;}}),{headers:{'content-type':'application/json'}});}});const s=await issue(g);const pending=result(chat(g,s));await entered.promise;let observed,ledger;
 try{const r=await fetch(g.url+'/v1/session/revoke',{method:'POST',headers:{authorization:'Bearer '+s.token}});assert.equal(r.status,200);observed=await bounded(pending);ledger=statuses(g);}finally{release.resolve();try{c?.close();}catch{}await bounded(pending);}
 assert.notEqual(observed,'deadline');assert.equal(observed.status,403);assert.deepEqual(ledger,['aborted']);assert.equal(g._quotaUsed(s.sessionId),1);
});
for(const [name,body,stream] of [['JSON partial HTTP',()=>json('ok',206),false],['SSE partial HTTP',()=>sse(frame('ok')+done,206),true],['JSON unexpected success status',()=>json('ok',201),false],['JSON only invisible',()=>json('\u200b\u2060\u0000'),false],['SSE only invisible',()=>sse(frame('\u200b\u2060')+frame('\u0000')+done),true]])test('server rejects '+name,async t=>{
 const g=await app(t,{fetchImpl:async()=>body()});const s=await issue(g);const r=await result(chat(g,s,stream));assert.ok(r.status===0||r.status===502);assert.deepEqual(statuses(g),['upstream_error']);assert.equal(g._quotaUsed(s.sessionId),1);assert.ok(!r.text.includes('[DONE]'));
});
for(const stream of [false,true])test('server keeps visible text with invisible formatting '+stream,async t=>{const text='👩‍💻你好\u200b';const g=await app(t,{fetchImpl:async()=>stream?sse(frame(text)+done):json(text)});const s=await issue(g);const r=await result(chat(g,s,stream));assert.equal(r.status,200);assert.ok(r.text.includes(text));assert.deepEqual(statuses(g),['ok']);});
// Real loopback HTTP, no injected fetch, and no actual provider or real key.
test('real upstream stalls after SSE content: deadline fails transport and closes upstream',async t=>{
 let upstreamClosed=false;const up=createServer(async(req,res)=>{req.resume();res.on('close',()=>upstreamClosed=true);res.writeHead(200,{'content-type':'text/event-stream'});res.write(frame('ok'));});up.listen(0,'127.0.0.1');await once(up,'listening');t.after(async()=>{up.closeAllConnections();await new Promise(r=>up.close(r));});const base='http://127.0.0.1:'+up.address().port+'/v1';const g=await app(t,{providerAllowlist:[base],providerTimeoutMs:120});const s=await issue(g);const r=await bounded(result(chat(g,s,true,base)),1500);assert.notEqual(r,'deadline');assert.equal(r.status,0);for(let i=0;i<30&&!upstreamClosed;i++)await delay(10);assert.equal(upstreamClosed,true);assert.deepEqual(statuses(g),['timeout']);assert.equal(g._quotaUsed(s.sessionId),1);
});
const input=extra=>({base:'http://127.0.0.1:8787',providerBaseUrl:BASE,apiKey:'synthetic-key',model:'m',messages:[{role:'user',content:'hello'}],stream:false,maxTokens:100,...extra});
const token=()=>new Response(JSON.stringify({token:'synthetic-token',expiresAt:Date.now()+600000}),{status:201,headers:{'content-type':'application/json'}});
test('client abort releases a chat waiting for headers even if adapter ignores signal',async()=>{
 resetGatewaySessions();const entered=deferred(),release=deferred(),ctl=new AbortController();let cancelled=false;const f=async u=>{if(u.endsWith('/session'))return token();entered.resolve();await release.promise;return new Response(new ReadableStream({cancel(){cancelled=true;}}));};const work=gatewayChatFetch(input({fetchImpl:f,signal:ctl.signal})).then(()=>false,()=>true);await entered.promise;ctl.abort();let observed;try{observed=await bounded(work);}finally{release.resolve();await bounded(work);await delay(10);resetGatewaySessions();}assert.equal(observed,true);assert.equal(cancelled,true);
});
test('late session issuance after reset never caches or sends old credentials',async()=>{
 resetGatewaySessions();const entered=deferred(),release=deferred();let cancelled=false,chats=0;const f=async u=>{if(u.endsWith('/session')){entered.resolve();await release.promise;return new Response(new ReadableStream({cancel(){cancelled=true;}}));}chats++;return json();};const work=gatewayChatFetch(input({fetchImpl:f})).then(()=>false,()=>true);await entered.promise;resetGatewaySessions();try{assert.equal(await bounded(work),true);}finally{release.resolve();await delay(15);}assert.equal(chats,0);assert.equal(cancelled,true);
});

// Second wave: late rejection, recovery of shared issuance, and shutdown.
test('late adapter rejection after timeout does not double-settle or escape',async t=>{
 let rejectLate;const entered=deferred();let calls=0;const g=await app(t,{providerTimeoutMs:65,fetchImpl:()=>{if(++calls>1)return Promise.resolve(json());return new Promise((_r,reject)=>{rejectLate=reject;entered.resolve();});}});const s=await issue(g);const p=result(chat(g,s));await entered.promise;let observed;try{observed=await bounded(p);}finally{rejectLate(new Error('synthetic late error'));await bounded(p);await delay(10);}assert.notEqual(observed,'deadline');assert.equal(observed.status,504);assert.deepEqual(statuses(g),['timeout']);assert.equal((await chat(g,s)).status,200);assert.deepEqual(statuses(g),['timeout','ok']);assert.equal(g._quotaUsed(s.sessionId),2);
});
test('shared session issuance timeout clears pending work and permits fresh issuance',async()=>{
 resetGatewaySessions();const originalTimeout=AbortSignal.timeout;const release=deferred();let n=0,chats=0,disposed=false;const f=async u=>{if(u.endsWith('/session')){if(++n===1){await release.promise;return new Response(new ReadableStream({cancel(){disposed=true;}}));}return token();}chats++;return json();};
 // Shorten only the session-issuance watchdog in this test, not production code.
 AbortSignal.timeout=ms=>originalTimeout(ms===10000?35:ms);let first,second;try{first=await bounded(gatewayChatFetch(input({fetchImpl:f})).then(()=>false,()=>true));second=await bounded(gatewayChatFetch(input({fetchImpl:f})).then(r=>r.status,()=>0));}finally{AbortSignal.timeout=originalTimeout;release.resolve();await delay(15);resetGatewaySessions();}assert.equal(first,true);assert.equal(second,200);assert.equal(n,2);assert.equal(chats,1);assert.equal(disposed,true);
});
test('server invalid media response explicitly releases unread adapter body',async t=>{let cancelled=false;const g=await app(t,{fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}})});const s=await issue(g);assert.equal((await chat(g,s,true)).status,502);assert.equal(cancelled,true);assert.deepEqual(statuses(g),['upstream_error']);});
test('noncooperative request on client disconnect settles and permits another request',async t=>{
 const entered=deferred(),release=deferred();let calls=0;const g=await app(t,{providerTimeoutMs:5000,concurrencyLimit:1,fetchImpl:async()=>{if(++calls===1) {entered.resolve();await release.promise;}return json();}});const s=await issue(g),controller=new AbortController();const p=result(chat(g,s,false,BASE,controller.signal));await entered.promise;controller.abort();await p;let observed;try{for(let i=0;i<40&&statuses(g)[0]==='reserved';i++)await delay(10);observed=statuses(g);assert.deepEqual(observed,['aborted']);assert.equal((await chat(g,s)).status,200);}finally{release.resolve();}assert.equal(g._quotaUsed(s.sessionId),2);assert.deepEqual(statuses(g),['aborted','ok']);
});
// A session token is a credential too. Only the existing legacy HTTP 200
// and explicit HTTP 201 issuance contracts may authorize a subsequent POST.
for(const status of [202,206])test('non-final session issuance status never authorizes chat '+status,async()=>{
 resetGatewaySessions();let chats=0;const f=async u=>u.endsWith('/session')?new Response(JSON.stringify({token:'synthetic-token',expiresAt:Date.now()+600000}),{status,headers:{'content-type':'application/json'}}):(chats++,json());await assert.rejects(gatewayChatFetch(input({fetchImpl:f})));assert.equal(chats,0);
});
for(const status of [200,201])test('supported session issuance still authorizes one chat '+status,async()=>{
 resetGatewaySessions();let chats=0;const f=async u=>u.endsWith('/session')?new Response(JSON.stringify({token:'synthetic-token',expiresAt:Date.now()+600000}),{status,headers:{'content-type':'application/json'}}):(chats++,json());assert.equal((await gatewayChatFetch(input({fetchImpl:f}))).status,200);assert.equal(chats,1);
});
