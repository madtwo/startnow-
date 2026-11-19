'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {install,state}=require('./tech-loader.cjs');install();
const {captureVisionTemplate}=require('../src/lib/materialCapture.ts');
const {extractMaterial}=require('../src/lib/materialVision.ts');
const {validateMaterialStep}=require('../src/lib/materialAdvice.ts');
const cfg={providerId:'compatible',apiKey:'fake',baseUrl:'https://example.test/v1',model:'text',visionModel:'vision'};
const image='data:image/png;base64,aQ==';
const base=(override={})=>({kind:'assignment',title:'实验报告二',deadlineText:'周五23:59',
  anchors:[{id:'a1',label:'第2题',quote:'第2题需写出误差来源'}],excerpt:'第2题',confidence:'high',...override});
const packet=(raw)=>({ok:true,json:async()=>({choices:[{message:{content:raw}}]})});
const original=global.fetch;after(()=>{global.fetch=original;});
test('template capture sends ONE vision request, no advice LLM, retains a checkable source',async()=>{
 state.isMock=false;state.streamCalls=0;let requests=0,budgets=0;
 global.fetch=async(_url,req)=>{requests++;const body=JSON.parse(req.body);
   assert.equal(body.messages[0].content[1].type,'image_url');
   assert.equal(body.max_tokens,1200);
   return packet(JSON.stringify(base()));};
 const result=await captureVisionTemplate({config:cfg,imageDataUrl:image,onModelAttempt:()=>budgets++});
 assert.equal(result.ok,true);assert.equal(requests,1);assert.equal(budgets,1);assert.equal(state.streamCalls,0);
 assert.equal(result.step.source,'template');assert.equal(result.step.anchorId,'a1');
 assert.equal(validateMaterialStep(result.step.text,result.extraction).ok,true);
 assert.ok(result.latencyMs>=0);
});
test('bad extraction JSON causes failure, without a second network retry',async()=>{
 state.isMock=false;let calls=0;
 global.fetch=async()=>{calls++;return packet('bad json')};
 const r=await captureVisionTemplate({config:cfg,imageDataUrl:image});
 assert.equal(r.ok,false);assert.equal(r.code,'format_invalid');assert.equal(calls,1);
});
test('a 503 does not retry; two-step extraction retains existing retry behavior',async()=>{
 state.isMock=false;let calls=0;
 global.fetch=async()=>{calls++;return calls===1?{ok:false,status:503,text:async()=>''}:packet(JSON.stringify(base()))};
 const r=await captureVisionTemplate({config:cfg,imageDataUrl:image});
 assert.equal(r.ok,false);assert.equal(r.code,'server');assert.equal(calls,1);
 const normal=await extractMaterial(cfg,image);
 assert.equal(normal.ok,true);assert.equal(calls,2);
});
test('bad image, absent anchor, and high-risk image text never receive a fabricated step',async()=>{
 state.isMock=false;let calls=0;
 global.fetch=async()=>{calls++;return packet(JSON.stringify(base({anchors:[]})));};
 assert.equal((await captureVisionTemplate({config:cfg,imageDataUrl:'data:image/gif;base64,aQ=='})).code,'invalid_image');
 assert.equal(calls,0);
 assert.equal((await captureVisionTemplate({config:cfg,imageDataUrl:image})).code,'no_anchor');
 assert.equal(calls,1);
 global.fetch=async()=>packet(JSON.stringify(base({excerpt:'我想自杀'})));
 assert.equal((await captureVisionTemplate({config:cfg,imageDataUrl:image})).code,'unsafe_output');
});
test('abort stops the ONE inflight network request without cached step',async()=>{
 state.isMock=false;let requestCount=0;
 global.fetch=async(_url,{signal})=>{requestCount++;return new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});
 });};
 const controller=new AbortController();const pending=captureVisionTemplate({config:cfg,imageDataUrl:image,signal:controller.signal});
 controller.abort();const result=await pending;
 assert.equal(result.ok,false);assert.equal(result.code,'cancelled');assert.equal(requestCount,1);
});
test('all 25 text fixture kinds can generate a local grounded step, not image recognition evidence',()=>{
 const cases=require('../fixtures/tech-material-cases.json');assert.equal(cases.length,25);
 const {templateMaterialStep}=require('../src/lib/materialAdvice.ts');
 for(const f of cases){
  const term=f.expectedAnchors.find(x=>f.text.includes(x)&&f.stepMustIncludeAny.some(y=>x.includes(y)));
  assert.ok(term,f.id);
  const extracted={kind:f.kind,anchors:[{id:'a1',label:term,quote:term}],excerpt:term,confidence:'high'};
  const step=templateMaterialStep(extracted);
  assert.ok(step,f.id);assert.equal(step.source,'template');
  assert.ok(f.stepMustIncludeAny.some(t=>step.text.includes(t)),f.id);
 }
});
