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

const stopFrame='data: {"choices":[{"finish_reason":"stop"}]}\n\n';
const doneFrame='data: [DONE]\n\n';
const frame=v=>`data: ${JSON.stringify(v)}\n\n`;
for(const [name,part] of [['refusal',{content:'partial',refusal:'synthetic refusal'}],['wrong role',{role:'user',content:'not assistant'}],['malformed refusal',{content:'partial',refusal:[]} ]])test('client JSON rejects '+name,async()=>{const l=load();const c=setup(l,()=>response({choices:[{message:part,finish_reason:'stop'}]}));let emitted=0;await assert.rejects(run(l,{onDelta:()=>emitted++}));assert.equal(c.chats().length,1);assert.equal(emitted,0);});
for(const [name,part] of [['refusal',{refusal:'synthetic refusal'}],['wrong role',{role:'system',content:'not assistant'}],['malformed refusal',{refusal:{text:'bad'}}]])test('client SSE rejects '+name,async()=>{const l=load();const c=setup(l,()=>sse(firstFrame+frame({choices:[{delta:part}]})+doneFrame));await assert.rejects(run(l));assert.equal(c.chats().length,1);});
test('connection test refuses mixed text/refusal',async()=>{const l=load();const c=setup(l,()=>response({choices:[{message:{role:'assistant',content:'partial',refusal:'synthetic refusal'},finish_reason:'stop'}]}));await assert.rejects(l.testConnection(config));assert.equal(c.chats().length,1);});
for(const [name,value] of [['JSON',{choices:[{message:{role:'assistant',content:'ok',refusal:null},finish_reason:'stop'}]}],['SSE',frame({choices:[{delta:{role:'assistant',content:'ok',refusal:''}}]})+stopFrame+doneFrame]])test('client valid text-only '+name+' remains usable',async()=>{const l=load();const c=setup(l,()=>name==='SSE'?sse(value):response(value));assert.equal(await run(l),'ok');assert.equal(c.chats().length,1);});
test('client pending SSE read and non-cooperative cancellation do not hold a slot',async()=>{
 const l=load(),controller=new AbortController();let cancelCalled=false,streamController,releaseCancel;
 const stream=new ReadableStream({start(c){streamController=c;c.enqueue(new TextEncoder().encode(firstFrame));},cancel(){cancelCalled=true;return new Promise(r=>releaseCancel=r);}});
 const c=setup(l,()=>sse(stream));const work=run(l,{signal:controller.signal,onDelta:()=>controller.abort()}).then(()=>false,()=>true);
 let result;try{result=await Promise.race([work,new Promise(r=>setTimeout(()=>r(false),400))]);}finally{try{streamController.close();}catch{}releaseCancel?.();}
 assert.equal(result,true);assert.equal(cancelCalled,true);assert.equal(c.chats().length,1);
});
test('client invalid configured empty fragment cannot send provider credentials',async()=>{const l=load('https://gateway.example/v1#');const c=setup(l,()=>response(good));await assert.rejects(run(l),kind('config'));assert.equal(c.calls.length,0);});
// The actual TypeScript transport crosses two real loopback HTTP servers.
const {createServer}=require('node:http');const {once}=require('node:events');
async function local(t,type,data,success){let seen=0;const upstream=createServer(async(req,res)=>{for await(const chunk of req){}seen++;res.writeHead(200,{'content-type':type});res.end(data);});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});const {startServer}=await import('../server/server.mjs');const base='http://127.0.0.1:'+upstream.address().port+'/v1';const g=await startServer({providerAllowlist:[base],sessionSecret:'synthetic-round3-loopback-secret',logger:()=>{},fetchImpl:originalFetch});t.after(async()=>{g.server.closeAllConnections();await g.close();});const l=load(g.url);global.fetch=originalFetch;const work=run(l,{config:{...config,baseUrl:base}});if(success)assert.equal(await work,'ok.');else await assert.rejects(work);assert.equal(seen,1);assert.equal(g.db.prepare('SELECT status FROM attempts').get().status,success?'ok':'upstream_error');assert.equal(g.db.prepare('SELECT SUM(used) AS n FROM quota_daily').get().n,1);}
test('actual HTTP: refusal JSON cannot succeed or fall back',async t=>local(t,'application/json',JSON.stringify({choices:[{message:{role:'assistant',content:'partial',refusal:'synthetic refusal'},finish_reason:'stop'}]}),false));
test('actual HTTP: late refusal SSE cannot succeed or fall back',async t=>local(t,'text/event-stream',firstFrame+frame({choices:[{delta:{refusal:'synthetic refusal'}}]})+doneFrame,false));
test('actual HTTP: non-assistant SSE cannot succeed',async t=>local(t,'text/event-stream',frame({choices:[{delta:{role:'user',content:'bad'}}]})+doneFrame,false));
test('actual HTTP: valid SSE text-only still succeeds',async t=>local(t,'text/event-stream',frame({choices:[{delta:{role:'assistant',content:'ok.',refusal:null}}]})+stopFrame+doneFrame,true));
