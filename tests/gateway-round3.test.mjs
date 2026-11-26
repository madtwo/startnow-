import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../server/server.mjs';
import { normalizeProviderBase } from '../server/lib/provider.mjs';
import { normalizeGatewayBase, readGatewayText } from '../src/lib/gatewayClient.ts';
const BASE='http://127.0.0.1:32123/v1', KEY='synthetic-round3-key';
const good={choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}]};
const json=(v=good,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const frame=v=>`data: ${JSON.stringify(v)}\n\n`;
const done='data: [DONE]\n\n';
const sse=v=>new Response(v,{headers:{'content-type':'text/event-stream'}});
const payload=(extra={})=>({providerBaseUrl:BASE,model:'synthetic',messages:[{role:'user',content:'hello'}],stream:false,...extra});
async function app(t,opts={}){let count=0;const g=await startServer({sessionSecret:'synthetic-round3-secret-32chars',providerAllowlist:[BASE],logger:()=>{},...opts,fetchImpl:async(...args)=>{count++;return opts.fetchImpl?opts.fetchImpl(...args):json();}});t.after(async()=>{g.server.closeAllConnections();await g.close();});return {g,count:()=>count};}
async function issue(g){const r=await fetch(g.url+'/v1/session',{method:'POST'});assert.equal(r.status,201);return r.json();}
const headers=s=>({authorization:'Bearer '+s.token,'x-provider-key':KEY,'content-type':'application/json'});
const chat=(g,s,extra={})=>fetch(g.url+'/v1/chat',{method:'POST',headers:headers(s),body:JSON.stringify(payload(extra))});
const states=g=>g.db.prepare('SELECT status FROM attempts ORDER BY rowid').all().map(r=>r.status);
async function failed(p){try{const r=await p;await r.text();return !r.ok;}catch{return true;}}
// Test two compensating corruptions outside the requesting session; total still agrees.
for(const mode of ['redistributed','orphaned']) test('per-session ledger integrity: '+mode,async t=>{const {g,count}=await app(t);const a=await issue(g),b=await issue(g),c=await issue(g);assert.equal((await chat(g,a)).status,200);assert.equal((await chat(g,b)).status,200);if(mode==='redistributed'){g.db.prepare('UPDATE quota_daily SET used=0 WHERE session_id=?').run(a.sessionId);g.db.prepare('UPDATE quota_daily SET used=2 WHERE session_id=?').run(b.sessionId);}else{g.db.prepare('UPDATE quota_daily SET session_id=? WHERE session_id=?').run('orphan-synthetic',a.sessionId);}assert.equal((await chat(g,c)).status,503);assert.equal(count(),2);assert.equal((await fetch(g.url+'/v1/health')).status,503);assert.deepEqual(states(g),['ok','ok']);});
test('normal separate subjects retain their own counts',async t=>{const {g,count}=await app(t);const a=await issue(g),b=await issue(g);for(const s of [a,b,a])assert.equal((await chat(g,s)).status,200);assert.equal(count(),3);assert.equal(g._quotaUsed(a.sessionId),2);assert.equal(g._quotaUsed(b.sessionId),1);});
function partial(g,s,length=100){let req;const response=new Promise(resolve=>{req=http.request(g.url+'/v1/chat',{method:'POST',headers:{...headers(s),'content-length':String(length)}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',()=>resolve({status:0}));});req.flushHeaders();req.write('{');return {req,response};}
const deadline=(work,ms=350)=>Promise.race([work,delay(ms).then(()=>({status:-1}))]);
test('partial authenticated upload has a bounded body deadline',async t=>{const {g,count}=await app(t,{requestBodyTimeoutMs:45});const s=await issue(g);const p=partial(g,s);let result;try{result=await deadline(p.response);}finally{p.req.destroy();}assert.equal(result.status,408);assert.equal(count(),0);assert.equal(g._quotaUsed(s.sessionId),0);assert.equal((await chat(g,s)).status,200);});
test('oversized declared length rejected before body is sent',async t=>{const {g,count}=await app(t);const s=await issue(g);const p=partial(g,s,128*1024+1);let result;try{result=await deadline(p.response);}finally{p.req.destroy();}assert.equal(result.status,413);assert.equal(count(),0);});
test('concurrent incomplete uploads have a separate cap and release on disconnect',async t=>{const {g,count}=await app(t,{maxPendingUploads:1,requestBodyTimeoutMs:1000});const a=await issue(g),b=await issue(g);const p=partial(g,a);try{await delay(35);const r=await chat(g,b);assert.equal(r.status,429);assert.equal(count(),0);}finally{p.req.destroy();}await delay(40);assert.equal((await chat(g,b)).status,200);assert.equal(count(),1);});
test('zero upload cap blocks before outbound',async t=>{const {g,count}=await app(t,{maxPendingUploads:0});const s=await issue(g);assert.equal((await chat(g,s)).status,429);assert.equal(count(),0);});
for(const opts of [{requestBodyTimeoutMs:0},{maxPendingUploads:-1}])test('bad upload configuration fails before listening '+JSON.stringify(opts),async()=>{let g;try{await assert.rejects(async()=>{g=await startServer(opts);});}finally{await g?.close();}});
for(const [name,part,expected] of [['refusal',{content:'partial',refusal:'not allowed'},422],['nonassistant',{role:'user',content:'hello'},502],['invalid refusal shape',{content:'partial',refusal:{text:'bad'}},422]])test('JSON completion rejects '+name,async t=>{const {g,count}=await app(t,{fetchImpl:async()=>json({choices:[{message:part,finish_reason:'stop'}]})});const s=await issue(g);const r=await chat(g,s);assert.equal(r.status,expected);assert.equal(count(),1);assert.deepEqual(states(g),['upstream_error']);});
for(const [name,part] of [['refusal',{refusal:'not allowed'}],['nonassistant',{role:'system',content:'bad'}],['invalid refusal shape',{refusal:[]} ]])test('SSE completion rejects '+name,async t=>{const {g,count}=await app(t,{fetchImpl:async()=>sse(frame({choices:[{delta:{role:'assistant',content:'ok'}}]})+frame({choices:[{delta:part}]})+done)});const s=await issue(g);assert.equal(await failed(chat(g,s,{stream:true})),true);assert.equal(count(),1);assert.deepEqual(states(g),['upstream_error']);});
test('explicit empty or null refusal is compatible',async t=>{const {g}=await app(t,{fetchImpl:async()=>json({choices:[{message:{role:'assistant',content:'ok',refusal:null},finish_reason:'stop'}]})});const s=await issue(g);assert.equal((await chat(g,s)).status,200);assert.deepEqual(states(g),['ok']);});
for(const u of ['https://example.test/v1?','https://example.test/v1#','http://127.0.0.1:32123/v1?','http://127.0.0.1:32123/v1#']) test('empty query/fragment is not a base URL: '+u,()=>{assert.throws(()=>normalizeProviderBase(u));assert.equal(normalizeGatewayBase(u),null);});
test('encoded question/hash in a real path is not confused with delimiter',()=>{const u='https://example.test/v1%3F%23';assert.equal(normalizeProviderBase(u),u);assert.equal(normalizeGatewayBase(u),u);});
test('bounded reader aborts even while a body read is pending',async()=>{let cancelled=false;const controller=new AbortController();const res=new Response(new ReadableStream({cancel(){cancelled=true;}}));const observed=readGatewayText(res,1024,controller.signal).then(()=>false,()=>true);controller.abort();assert.equal(await Promise.race([observed,delay(200).then(()=>false)]),true);assert.equal(cancelled,true);});

// Two independent SQLite connections, deterministically revoke between the
// last authorization read and the success UPDATE, not a timing lottery.
import { openDb, revokeSession } from '../server/lib/db.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
for (const stream of [false,true]) test('success settlement must recheck authorization atomically: '+(stream?'SSE':'JSON'),async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'gw-r3-settle-')); const file=path.join(dir,'ledger.db');
 const db=openDb(file), external=openDb(file); let armed=false, sid, injected=0;
 const wrapped={exec:sql=>db.exec(sql),prepare(sql){const stmt=db.prepare(sql);if(!sql.includes('UPDATE attempts SET status'))return stmt;return {run(...args){if(armed&&args[0]==='ok'){armed=false;injected++;revokeSession(external,sid);}return stmt.run(...args);}};}};
 let g;try{g=await startServer({db:wrapped,sessionSecret:'synthetic-round3-secret-32chars',providerAllowlist:[BASE],logger:()=>{},fetchImpl:async()=>stream?sse(frame({choices:[{delta:{content:'ok'}}]})+done):json()});const s=await issue(g);sid=s.sessionId;armed=true;
 const result=await failed(chat(g,s,{stream}));assert.equal(injected,1);assert.equal(result,true);assert.deepEqual(states({db}),['aborted']);assert.equal(g._quotaUsed(sid),1);assert.equal((await fetch(g.url+'/v1/health')).status,200);
 }finally{if(g){g.server.closeAllConnections();await g.close();}external.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('upload timeout releases pending slot, with chunked request and no reserve',async t=>{const {g,count}=await app(t,{maxPendingUploads:1,requestBodyTimeoutMs:60});const s=await issue(g);const pending=new Promise(resolve=>{const r=http.request(g.url+'/v1/chat',{method:'POST',headers:headers(s)},res=>{res.resume();res.on('end',()=>{r.destroy();resolve(res.statusCode);});});r.on('error',()=>resolve(0));r.write('{');t.after(()=>r.destroy());});assert.equal(await Promise.race([pending,delay(400).then(()=>-1)]),408);assert.equal(count(),0);assert.equal(g._quotaUsed(s.sessionId),0);assert.equal((await chat(g,s)).status,200);});
test('chunked oversized body retains original byte cap and releases upload slot',async t=>{const {g,count}=await app(t,{maxPendingUploads:1});const s=await issue(g);const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(128*1024+1));c.close();}});const r=await fetch(g.url+'/v1/chat',{method:'POST',headers:headers(s),body,duplex:'half'});assert.equal(r.status,413);await r.text();assert.equal(count(),0);assert.equal((await chat(g,s)).status,200);});
test('first refusal frame returns sanitized 422 without forwarding text',async t=>{const {g}=await app(t,{fetchImpl:async()=>sse(frame({choices:[{delta:{role:'assistant',content:'synthetic partial',refusal:'synthetic refusal'}}]})+done)});const s=await issue(g);const r=await chat(g,s,{stream:true});assert.equal(r.status,422);assert.deepEqual(await r.json(),{error:{code:'upstream_content_filtered'}});assert.deepEqual(states(g),['upstream_error']);});
for (const part of [{role:'assistant',content:'ok',refusal:''},{content:[{type:'text',text:'ok'}],refusal:null},{role:null,content:'ok'}]) test('valid SSE still succeeds '+JSON.stringify(part),async t=>{const {g}=await app(t,{fetchImpl:async()=>sse(frame({choices:[{delta:part}]})+frame({choices:[{finish_reason:'stop'}]})+done)});const s=await issue(g);const r=await chat(g,s,{stream:true});assert.equal(r.status,200);assert.match(await r.text(),/ok/);assert.deepEqual(states(g),['ok']);});
