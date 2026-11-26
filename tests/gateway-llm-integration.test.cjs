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

test('G16 safety block is classified and never falls back',async()=>{const l=load();const c=setup(l,()=>response({error:{code:'safety_blocked'}},422));await assert.rejects(run(l),e=>e.noFallback===true);assert.equal(c.chats().length,1);});
test('provider content filtering is classified and never falls back',async()=>{const l=load();const c=setup(l,()=>response({error:{code:'upstream_content_filtered'}},422));await assert.rejects(run(l),e=>e.noFallback===true);assert.equal(c.chats().length,1);});
test('quota and ledger errors are terminal, not fallback',async()=>{for(const [code,status,k] of [['quota_exhausted',429,'quota'],['ledger_unavailable',503,'config'],['provider_auth_failed',403,'auth'],['provider_quota_exhausted',402,'quota']]){const l=load();const c=setup(l,()=>response({error:{code}},status));await assert.rejects(run(l),kind(k));assert.equal(c.chats().length,1);}});
test('gateway rate response preserves Retry-After and backoff',async()=>{const l=load();const c=setup(l,()=>response({error:{code:'rate_limited'}},429,{'retry-after':'3'}));await assert.rejects(run(l),e=>e.kind==='rate'&&e.retryAfterMs===3000);assert.ok(l.modelRateLimitRemainingMs()>0);assert.equal(c.chats().length,1);});
test('G17 invalid nonempty gateway configuration cannot fall back to direct',async()=>{const l=load('http://remote.invalid');const c=setup(l,()=>response(good));await assert.rejects(run(l),kind('config'));await assert.rejects(l.testConnection(config),kind('config'));assert.equal(c.calls.length,0);});
test('only exact built-in proxy paths are mapped; custom relative route rejects',async()=>{const l=load();const c=setup(l,()=>response(good));assert.equal(await run(l,{config:{...config,baseUrl:'/api/opencode-go/v1/'}}),'ok');assert.equal(JSON.parse(c.chats()[0].init.body).providerBaseUrl,'https://opencode.ai/inference/go/openai/v1');await assert.rejects(run(l,{config:{...config,baseUrl:'/api/opencode-go/custom'}}),kind('config'));assert.equal(c.chats().length,1);});
test('model fence is checked again after session issuance',async()=>{const l=load();let permit=true,attempts=0,chats=0;global.fetch=async url=>{if(String(url).endsWith('/v1/session')){permit=false;return response({token:'t',expiresAt:Date.now()+3600000},201);}chats++;return response(good);};await assert.rejects(run(l,{storagePermit:()=>permit,onRequestAttempt:()=>attempts++}),kind('config'));assert.equal(chats,0);assert.equal(attempts,0);});
test('401 refresh cannot bypass a revoked local model fence',async()=>{const l=load();let permit=true,attempts=0;const c=setup(l,()=>{permit=false;return response({error:{code:'unauthorized'}},401);});await assert.rejects(run(l,{storagePermit:()=>permit,onRequestAttempt:()=>attempts++}),kind('config'));assert.equal(c.chats().length,1);assert.equal(attempts,1);});
test('401 refresh rechecks local quota on each actual chat POST',async()=>{const l=load();let attempts=0;const c=setup(l,()=>attempts===1?response({error:{code:'unauthorized'}},401):response(good));assert.equal(await run(l,{onRequestAttempt:()=>attempts++}),'ok');assert.equal(c.chats().length,2);assert.equal(attempts,2);});
test('gateway SSE clean EOF without a recognized terminal is rejected',async()=>{const l=load();const c=setup(l,()=>sse(firstFrame));await assert.rejects(run(l),kind('truncated'));assert.equal(c.chats().length,1);});
test('gateway SSE waits for transport completion even after DONE',async()=>{const l=load();const c=setup(l,()=>{let i=0;return sse(new ReadableStream({pull(controller){if(i++===0)controller.enqueue(new TextEncoder().encode(firstFrame+'data: [DONE]\n\n'));else return new Promise(resolve=>setTimeout(()=>{controller.error(new Error('synthetic transport failure'));resolve();},10));}}));});await assert.rejects(run(l));assert.equal(c.chats().length,1);});
test('gateway valid terminal/EOF and JSON fallback remain accepted',async()=>{for(const data of [()=>sse(firstFrame+'data: [DONE]\n\n'),()=>sse(firstFrame+'data: {"choices":[{"finish_reason":"stop"}]}\n\n'),()=>response(good)]){const l=load();const c=setup(l,data);assert.ok((await run(l)).startsWith('ok'));assert.equal(c.chats().length,1);}});
test('gateway rejects content after DONE or unsupported terminal reason',async()=>{for(const data of [firstFrame+'data: [DONE]\n\n'+firstFrame,firstFrame+'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n']){const l=load();const c=setup(l,()=>sse(data));await assert.rejects(run(l));assert.equal(c.chats().length,1);}});
test('default disabled preserves direct endpoint and markerless compatibility',async()=>{const l=load('');const c=setup(l,()=>sse(firstFrame));assert.equal(await run(l),'ok.');assert.equal(c.calls.length,1);assert.equal(c.calls[0].url,config.baseUrl+'/chat/completions');});
test('default disabled preserves direct reasoning-effort compatibility retry',async()=>{const l=load('');let n=0;const c=setup(l,()=>++n===1?response({error:{message:'unsupported reasoning_effort'}},400):response(good));assert.equal(await run(l),'ok');assert.equal(c.chats().length,2);assert.equal(JSON.parse(c.chats()[0].init.body).reasoning_effort,'low');assert.equal('reasoning_effort' in JSON.parse(c.chats()[1].init.body),false);});
test('testConnection uses gateway and checks local fence before POST',async()=>{const l=load();const c=setup(l,()=>response({...good,model:'main'}));assert.match(await l.testConnection(config),/main/);assert.equal(c.chats().length,1);});
test('second wave: a later stop cannot erase an earlier length failure',async()=>{const l=load();setup(l,()=>sse(firstFrame+'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));await assert.rejects(run(l),kind('truncated'));});
test('second wave: body after finish_reason stop fails rather than being merged',async()=>{const l=load();setup(l,()=>sse(firstFrame+'data: {"choices":[{"finish_reason":"stop"}]}\n\n'+firstFrame+'data: [DONE]\n\n'));await assert.rejects(run(l));});
test('third wave: ambiguous provider rejection is never retried via fallback',async()=>{const l=load();const c=setup(l,()=>response({error:{code:'provider_request_rejected'}},400));await assert.rejects(run(l),kind('config'));assert.equal(c.chats().length,1);});
