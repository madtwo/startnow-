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
for(const [name,handler] of [
 ['unknown transport error',()=>{throw new TypeError('synthetic connection loss')}],
 ['ambiguous HTTP 502',()=>response({error:{code:'upstream_failed'}},502)],
 ['ambiguous timeout',()=>response({error:{code:'upstream_timeout'}},504)],
 ['non-JSON reverse proxy error',()=>new Response('private note from gateway',{status:500})],
 ['malformed first SSE frame',()=>sse('data: {bad}\n\n')],
 ['empty terminal stream',()=>sse(doneFrame)],
])test('gateway never automatically duplicates possibly metered attempts: '+name,async()=>{const l=load();const c=setup(l,handler);await assert.rejects(run(l),e=>!String(e.message).includes('private note from gateway'));assert.equal(c.chats().length,1);});
for(const [name,data] of [
 ['missing terminal',{choices:[{message:{content:'ok'}}]}],
 ['multiple choices',{choices:[...good.choices,...good.choices]}],
 ['tool call',{choices:[{message:{content:'ok',tool_calls:[{index:0}]},finish_reason:'stop'}]}],
 ['oversized JSON metadata',{...good,extra:'x'.repeat(2*1024*1024)}],
])test('client independently rejects invalid JSON completion: '+name,async()=>{const l=load();const c=setup(l,()=>response(data));await assert.rejects(run(l));assert.equal(c.chats().length,1);});
for(const [name,data] of [
 ['named error',firstFrame+'event: error\ndata: {"message":"private marker"}\n\n'+doneFrame],
 ['multiple choices',firstFrame+'data: {"choices":[{"finish_reason":"stop"},{"finish_reason":"stop"}]}\n\n'+doneFrame],
 ['tool call',firstFrame+'data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}\n\n'+doneFrame],
 ['byte limit',firstFrame+(':'+'x'.repeat(60000)+'\n\n').repeat(36)+doneFrame],
 ['event limit',firstFrame+':ping\n\n'.repeat(8193)+doneFrame],
])test('client independently rejects invalid SSE completion: '+name,async()=>{const l=load();const c=setup(l,()=>sse(data));await assert.rejects(run(l));assert.equal(c.chats().length,1);});
test('client refuses a 200 with wrong media type despite valid-looking SSE body',async()=>{const l=load();const c=setup(l,()=>new Response(firstFrame+doneFrame,{headers:{'content-type':'text/html'}}));await assert.rejects(run(l));assert.equal(c.chats().length,1);});
test('SSE compatible multi-data event including DONE still succeeds',async()=>{const l=load();setup(l,()=>sse(firstFrame.trimEnd()+'\ndata: [DONE]\n\n'));assert.equal(await run(l),'ok.');});
test('default direct mode still permits the original fallback behavior',async()=>{const l=load('');let n=0;const c=setup(l,()=>++n===1?response({error:{message:'provider failed'}},500):response(good));assert.equal(await run(l),'ok');assert.equal(c.chats().length,2);assert.equal(JSON.parse(c.chats()[1].init.body).model,'backup');});
test('testConnection rejects a stale permit after the response returns',async()=>{const l=load();let permit=true;const modelFence=require(path.join(out,'lib/modelFence.js'));const previous=global.localStorage;global.localStorage={};modelFence.registerModelFence(()=>()=>permit);try{setup(l,()=>{permit=false;return response(good);});await assert.rejects(l.testConnection(config),kind('config'));}finally{if(previous===undefined)delete global.localStorage;else global.localStorage=previous;}});
test('valid gateway JSON arriving after caller abort is not delivered',async()=>{const l=load();const controller=new AbortController();let deltas=0;const c=setup(l,()=>{controller.abort();return response(good);});await assert.rejects(run(l,{signal:controller.signal,onDelta:()=>deltas++}));assert.equal(c.chats().length,1);assert.equal(deltas,0);});
test('strict gateway base rejects ambiguous syntax instead of silently canonicalizing',()=>{load();const client=require(path.join(out,'lib/gatewayClient.js'));for(const base of ['https:example.com','https://example.com\\path','https://exam\tple.com'])assert.equal(client.normalizeGatewayBase(base),null);assert.equal(client.normalizeGatewayBase('https://example.com/'),'https://example.com');});
// The final integration suite uses compiled actual llm.ts, a real loopback
// gateway HTTP server, and a separate loopback-only simulated provider.
const {createServer}=require('node:http');
const {once}=require('node:events');
async function withRealLoopback(t, body, expected){
 const seen=[];const upstream=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;seen.push({url:req.url,headers:req.headers,body:JSON.parse(raw)});const value=typeof body==='function'?body():body;res.writeHead(200,{'content-type':value.type});res.end(value.data);});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
 const {startServer}=await import('../server/server.mjs');const base='http://127.0.0.1:'+upstream.address().port+'/v1';
 const g=await startServer({providerAllowlist:[base],sessionSecret:'synthetic-local-integration-secret',logger:()=>{},fetchImpl:originalFetch});t.after(async()=>{g.server.closeAllConnections();await g.close();});
 const l=load(g.url);global.fetch=originalFetch;let text,failed=false;try{text=await run(l,{config:{...config,baseUrl:base}});}catch(e){failed=true;}
 assert.equal(failed,expected.failed);if(!failed)assert.equal(text,expected.text);assert.equal(seen.length,1);assert.equal(seen[0].url,'/v1/chat/completions');assert.equal(seen[0].headers.authorization,'Bearer '+config.apiKey);
 assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n,1);assert.equal(g.db.prepare('SELECT status FROM attempts').get().status,expected.ledger);
 assert.equal(g.db.prepare('SELECT SUM(used) AS n FROM quota_daily').get().n,1);
}
test('actual llm -> HTTP gateway -> simulated HTTP provider: valid SSE',async t=>withRealLoopback(t,{type:'text/event-stream',data:firstFrame+stopFrame+doneFrame},{failed:false,text:'ok.',ledger:'ok'}));
test('actual llm -> HTTP gateway -> simulated HTTP provider: filtered SSE',async t=>withRealLoopback(t,{type:'text/event-stream',data:'data: {"error":{"code":"content_filter","message":"private marker"}}\n\n'},{failed:true,ledger:'upstream_error'}));
test('actual llm -> HTTP gateway -> simulated HTTP provider: markerless SSE',async t=>withRealLoopback(t,{type:'text/event-stream',data:firstFrame},{failed:true,ledger:'upstream_error'}));
test('actual llm -> HTTP gateway -> simulated HTTP provider: missing JSON terminal',async t=>withRealLoopback(t,{type:'application/json',data:JSON.stringify({choices:[{message:{content:'ok'}}]})},{failed:true,ledger:'upstream_error'}));
