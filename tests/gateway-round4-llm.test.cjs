// Compile the actual TypeScript module with its actual dependencies. No model network.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-gateway-llm-'));
const originalFetch = global.fetch;
const config = {providerId:'compatible',baseUrl:'https://provider.example/v1',model:'main',fallbackModel:'backup',apiKey:'synthetic-test-key'};
const response = (data, status=200, headers={}) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
const good = {choices:[{message:{content:'ok'},finish_reason:'stop'}]};
const firstFrame = 'data: {"choices":[{"delta":{"content":"ok."}}]}\n\n';
const sse = value => new Response(value,{headers:{'content-type':'text/event-stream'}});
before(()=>{
  const local=path.join(root,'node_modules','typescript','bin','tsc');
  const args=['--strict','--skipLibCheck','--target','ES2022','--module','commonjs','--moduleResolution','node','--lib','ES2022,DOM','--rootDir',path.join(root,'src'),'--outDir',out,'--noEmitOnError',path.join(root,'src/lib/llm.ts')];
  const proc=fs.existsSync(local)?spawnSync(process.execPath,[local,...args],{encoding:'utf8'}):spawnSync(process.env.TSC_BIN||'tsc',args,{encoding:'utf8',shell:process.platform==='win32'});
  assert.equal(proc.status,0,`${proc.error||''}\n${proc.stdout||''}\n${proc.stderr||''}`);
});
after(()=>fs.rmSync(out,{recursive:true,force:true}));
afterEach(()=>{global.fetch=originalFetch;delete global.__STARTNOW_GATEWAY_URL__;});
function load(base='http://127.0.0.1:8787') {
  for(const file of Object.keys(require.cache)) if(file.startsWith(out+path.sep)) delete require.cache[file];
  global.__STARTNOW_GATEWAY_URL__=base;
  return require(path.join(out,'lib/llm.js'));
}
function setup(llm, handler) {
  const calls=[];let sessions=0;
  global.fetch=async(url,init)=>{calls.push({url:String(url),init});if(String(url).endsWith('/v1/session'))return response({token:'token-'+(++sessions),expiresAt:Date.now()+3600000},201);return handler(String(url),init,calls);};
  return {calls, chats:()=>calls.filter(x=>x.url.endsWith('/v1/chat')||x.url.endsWith('/chat/completions'))};
}
const run=(llm, extra={})=>llm.streamChat({config,messages:[{role:'user',content:'hello'}],signal:new AbortController().signal,onDelta:()=>{},...extra});
const kind=k=>e=>e?.kind===k;

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const bounded=async(p,ms=450)=>{let timer;try{return await Promise.race([p,new Promise(r=>timer=setTimeout(()=>r('deadline'),ms))]);}finally{clearTimeout(timer);}};
const reset=()=>require(path.join(out,'lib/gatewayClient.js')).resetGatewaySessions();
const outcome=p=>p.then(value=>({value}),error=>({error}));
const doneFrame='data: [DONE]\n\n';
for(const kindName of ['JSON','SSE','error'])test('gateway reset invalidates in-progress '+kindName+' response read',async()=>{
 const l=load(),entered=deferred();let ctl;let cancelled=false;
 const c=setup(l,()=>new Response(new ReadableStream({start(x){ctl=x;entered.resolve();},cancel(){cancelled=true;}}),{status:kindName==='error'?429:200,headers:{'content-type':kindName==='SSE'?'text/event-stream':'application/json','retry-after':'60'}}));
 const work=outcome(run(l));await entered.promise;await delay(10);reset();let observed;try{observed=await bounded(work);}finally{try{ctl.close();}catch{}await bounded(work);}
 assert.notEqual(observed,'deadline');assert.ok(observed.error);assert.match(observed.error.message,/取消/);assert.equal(cancelled,true);assert.equal(c.chats().length,1);assert.equal(l.modelRateLimitRemainingMs(),0);
});
test('queued chat from old epoch must not be sent after reset',async()=>{
 const l=load(),entered=deferred(),release=deferred();let n=0;const c=setup(l,async()=>{if(++n===2)entered.resolve();if(n<=2)await release.promise;return response(good);});const a=outcome(run(l)),b=outcome(run(l)),q=outcome(run(l));await entered.promise;reset();let observed;try{observed=await bounded(q);}finally{release.resolve();await Promise.all([a,b,q]);}assert.notEqual(observed,'deadline');assert.ok(observed.error);assert.equal(c.chats().length,2);assert.equal(await run(l),'ok');assert.equal(c.chats().length,3);
});
test('queued connection test from old epoch must not send after reset',async()=>{
 const l=load(),entered=deferred(),release=deferred();let n=0;const c=setup(l,async()=>{if(++n===2)entered.resolve();if(n<=2)await release.promise;return response(good);});const a=outcome(run(l)),b=outcome(run(l)),q=outcome(l.testConnection(config));await entered.promise;reset();let observed;try{observed=await bounded(q);}finally{release.resolve();await Promise.all([a,b,q]);}assert.notEqual(observed,'deadline');assert.ok(observed.error);assert.equal(c.chats().length,2);
});
test('cancelled error-body read does not install stale rate-limit backoff',async()=>{
 const l=load(),entered=deferred(),controller=new AbortController();let ctl;const c=setup(l,()=>new Response(new ReadableStream({start(x){ctl=x;entered.resolve();}}),{status:429,headers:{'content-type':'application/json','retry-after':'60'}}));const p=outcome(run(l,{signal:controller.signal}));await entered.promise;await delay(10);controller.abort();let observed;try{observed=await bounded(p);}finally{try{ctl.close();}catch{}await bounded(p);}assert.notEqual(observed,'deadline');assert.match(observed.error?.message||'',/取消/);assert.equal(l.modelRateLimitRemainingMs(),0);assert.equal(c.chats().length,1);
});
test('connection test reset while reading cannot report success',async()=>{
 const l=load(),entered=deferred();let ctl;const c=setup(l,()=>new Response(new ReadableStream({start(x){ctl=x;x.enqueue(new TextEncoder().encode(JSON.stringify(good)));entered.resolve();}}),{headers:{'content-type':'application/json'}}));const p=outcome(l.testConnection(config));await entered.promise;await delay(10);reset();let observed;try{observed=await bounded(p);}finally{try{ctl.close();}catch{}await bounded(p);}assert.notEqual(observed,'deadline');assert.ok(observed.error);assert.equal(c.chats().length,1);
});
for(const [name,make] of [['partial JSON',()=>response(good,206)],['partial SSE',()=>new Response(firstFrame+doneFrame,{status:206,headers:{'content-type':'text/event-stream'}})],['invisible JSON',()=>response({choices:[{message:{content:'\u200b\u2060'},finish_reason:'stop'}]})],['invisible SSE',()=>sse('data: {"choices":[{"delta":{"content":"\\u200b\\u2060"}}]}\n\n'+doneFrame)]])test('client independently rejects '+name,async()=>{const l=load();const c=setup(l,make);await assert.rejects(run(l));assert.equal(c.chats().length,1);});
test('connection test independently rejects partial HTTP success',async()=>{const l=load();const c=setup(l,()=>response(good,206));await assert.rejects(l.testConnection(config));assert.equal(c.chats().length,1);});
test('connection test independently rejects invisible JSON',async()=>{const l=load();const c=setup(l,()=>response({choices:[{message:{content:'\u200b'},finish_reason:'stop'}]}));await assert.rejects(l.testConnection(config));assert.equal(c.chats().length,1);});
for(const format of ['json','sse'])test('client retains legitimate formatting and emoji '+format,async()=>{const l=load(),text='👩‍💻你好\u200b';const c=setup(l,()=>format==='json'?response({choices:[{message:{content:text},finish_reason:'stop'}]}):sse('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n'+doneFrame));assert.equal(await run(l),text);assert.equal(c.chats().length,1);});

test('cancelled rate response does not discard other queued valid actions',async()=>{
 const l=load(),rateEntered=deferred(),otherEntered=deferred(),releaseOther=deferred(),controller=new AbortController();let n=0,rateBody;const c=setup(l,async()=>{if(++n===1)return new Response(new ReadableStream({start(x){rateBody=x;rateEntered.resolve();}}),{status:429,headers:{'content-type':'application/json','retry-after':'60'}});if(n===2){otherEntered.resolve();await releaseOther.promise;}return response(good);});const first=outcome(run(l,{signal:controller.signal})),other=outcome(run(l)),queued=outcome(run(l));await Promise.all([rateEntered.promise,otherEntered.promise]);await delay(10);controller.abort();let one,two,three;try{one=await bounded(first);releaseOther.resolve();[two,three]=await Promise.all([bounded(other),bounded(queued)]);}finally{releaseOther.resolve();try{rateBody.close();}catch{}await Promise.all([first,other,queued]);}assert.ok(one.error);assert.equal(two.value,'ok');assert.equal(three.value,'ok');assert.equal(c.chats().length,3);assert.equal(l.modelRateLimitRemainingMs(),0);
});
test('reset inside final JSON onDelta prevents logical success and allows new action',async()=>{
 const l=load();const c=setup(l,()=>response(good));await assert.rejects(run(l,{onDelta:()=>reset()}));assert.equal(c.chats().length,1);assert.equal(await run(l),'ok');assert.equal(c.chats().length,2);
});
test('default-disabled legacy direct path does not inherit gateway epoch abort',async()=>{
 const l=load(''),entered=deferred(),release=deferred();let calls=0;global.fetch=async()=>{calls++;entered.resolve();await release.promise;return response(good);};const p=run(l);await entered.promise;reset();release.resolve();assert.equal(await p,'ok');assert.equal(calls,1);
});
// Real two-hop HTTP, actual compiled client, and a synthetic local provider.
const {createServer}=require('node:http');const {once}=require('node:events');
async function local(t,handler,options={}){const requests=[];const upstream=createServer((req,res)=>{req.resume();requests.push({req,res});handler(req,res,requests.length);});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});const base='http://127.0.0.1:'+upstream.address().port+'/v1';const {startServer}=await import('../server/server.mjs');const g=await startServer({providerAllowlist:[base],sessionSecret:'synthetic-round4-loopback-secret',logger:()=>{},fetchImpl:originalFetch,providerTimeoutMs:2000,...options});t.after(async()=>{g.server.closeAllConnections();await g.close();});const l=load(g.url);global.fetch=originalFetch;const model={...config,baseUrl:base};return{g,l,model,requests,states:()=>g.db.prepare('SELECT status FROM attempts ORDER BY rowid').all().map(r=>r.status)};}
async function eventually(predicate,ms=1000){const end=Date.now()+ms;while(Date.now()<end){if(predicate())return true;await delay(10);}return predicate();}
test('real HTTP: reset cancels two running chats and prevents old queued third',async t=>{
 const entered=deferred();const {g,l,model,requests,states}=await local(t,(_req,res,n)=>{if(n<=2){res.writeHead(200,{'content-type':'text/event-stream'});res.write(firstFrame);if(n===2)entered.resolve();}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(good));}});const jobs=[0,1,2].map(()=>outcome(run(l,{config:model})));await entered.promise;reset();const results=await bounded(Promise.all(jobs),1000);assert.notEqual(results,'deadline');assert.ok(results.every(x=>x.error));assert.equal(requests.length,2);assert.equal(await eventually(()=>states().length===2&&states().every(x=>x==='aborted')),true);assert.equal(await run(l,{config:model}),'ok');assert.equal(requests.length,3);assert.deepEqual(states(),['aborted','aborted','ok']);assert.equal(g.db.prepare('SELECT SUM(used) AS n FROM quota_daily').get().n,3);
});
test('real HTTP: reset after first delta prevents terminal frame success',async t=>{
 const {g,l,model,requests,states}=await local(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(firstFrame+doneFrame);});const r=await bounded(outcome(run(l,{config:model,onDelta:()=>reset()})),1000);assert.notEqual(r,'deadline');assert.ok(r.error);assert.equal(requests.length,1);assert.equal(await eventually(()=>states()[0]==='aborted'),true);assert.equal(g.db.prepare('SELECT SUM(used) AS n FROM quota_daily').get().n,1);
});
test('real HTTP: partial status cannot be promoted into successful chat',async t=>{
 const {g,l,model,requests,states}=await local(t,(_req,res)=>{res.writeHead(206,{'content-type':'application/json','content-range':'bytes 0-47/100'});res.end(JSON.stringify(good));});await assert.rejects(run(l,{config:model}));assert.equal(requests.length,1);assert.deepEqual(states(),['upstream_error']);assert.equal(g.db.prepare('SELECT SUM(used) AS n FROM quota_daily').get().n,1);
});
