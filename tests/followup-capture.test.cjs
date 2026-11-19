'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {install,state}=require('./tech-loader.cjs');install();
const {captureFirstStep,parseCapturedMaterial}=require('../src/lib/materialCapture.ts');
const {parseMaterialExtraction}=require('../src/lib/materialVision.ts');
const {validateMaterialStep}=require('../src/lib/materialAdvice.ts');
const cfg={providerId:'compatible',apiKey:'fake-test',baseUrl:'https://example.test/v1',model:'vision',visionModel:'vision'};
const image='data:image/png;base64,aQ==';
const persona={id:'miaoze',name:'苗泽'};
const make=(overrides={})=>({kind:'error',title:'MATLAB',anchors:[{id:'a1',label:'Undefined function',quote:"Undefined function 'calcX' for input arguments of type 'double'."}],excerpt:'Undefined function',confidence:'high',step:{text:'抄下「Undefined function」报错。',anchorId:'a1'},...overrides});
const savedFetch=global.fetch;
after(()=>{global.fetch=savedFetch;});
const opts=()=>({config:cfg,imageDataUrl:image,persona,now:Date.now()});
const payload=(value)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(value)}}]})});
test('one multimodal call yields extraction AND safe anchored step, uses model budget and session',async()=>{
  state.isMock=false;
  let count=0,body;
  global.fetch=async(_url,request)=>{count++;body=JSON.parse(request.body);
    assert.match(request.headers['x-opencode-session'],/session/);
    assert.equal(body.messages[1].content[1].type,'image_url');
    assert.match(body.messages[1].content[0].text,/英文报错/);
    return payload(make());};
  const result=await captureFirstStep({...opts(),onModelAttempt:()=>{}});
  assert.equal(count,1);assert.equal(result.ok,true);assert.equal(result.step.source,'model');
  assert.equal(result.step.anchorId,'a1');assert.equal(result.retried,false);
  assert.equal(body.max_tokens,1600);assert.equal(body.reasoning_effort,'low');
  assert.equal(validateMaterialStep(result.step.text,result.extraction).ok,true);
});
test('invalid step format retries same image once then returns validated model result',async()=>{
  state.isMock=false;
  const calls=[];
  global.fetch=async(_url,{body})=>{calls.push(JSON.parse(body));
    return payload(make({step:calls.length===1?{text:'先想一想',anchorId:'a1'}:make().step}));};
  const result=await captureFirstStep(opts());
  assert.equal(result.ok,true);assert.equal(result.retried,true);assert.equal(result.step.source,'model');
  assert.equal(calls.length,2);
  assert.equal(calls[0].messages[1].content[1].image_url.url,calls[1].messages[1].content[1].image_url.url);
});
test('after two invalid steps, returns a checked template on a valid material anchor',async()=>{
  state.isMock=false;
  let count=0;
  global.fetch=async()=>{count++;return payload(make({step:{text:'你一定能成功',anchorId:'a1'}}));};
  const result=await captureFirstStep(opts());
  assert.equal(result.ok,true);assert.equal(result.step.source,'template');assert.equal(result.retried,true);
  assert.equal(validateMaterialStep(result.step.text,result.extraction).ok,true);assert.equal(count,2);
});
test('unsafe or absent visual anchors do not get fabricated or saved',async()=>{
  state.isMock=false;
  let count=0;
  global.fetch=async()=>{count++;return payload(make({anchors:[]}));};
  const result=await captureFirstStep(opts());
  assert.equal(result.ok,false);assert.equal(result.code,'no_anchor');assert.equal(count,2);
  global.fetch=async()=>payload(make({excerpt:'我想自杀'}));
  assert.equal((await captureFirstStep(opts())).code,'unsafe_output');
});
test('PII in proposed step rejected even if the anchor parser has redacted itself',()=>{
  const parsed=parseCapturedMaterial(JSON.stringify(make({step:{text:'抄下手机号 13800138000',anchorId:'a1'}})));
  assert.equal(parsed.ok,false);assert.equal(parsed.code,'advice_invalid');
  assert.equal(parseMaterialExtraction(JSON.stringify(make())).extraction.anchors[0].label,'Undefined function');
});
test('cancel aborts network request and will not retry or produce a delayed cached step',async()=>{
  state.isMock=false;
  let seen=false,callCount=0;
  global.fetch=async(_url,{signal})=>{callCount++;return new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>{seen=true;reject(Object.assign(new Error('cancelled'),{name:'AbortError'}));},{once:true});
  });};
  const controller=new AbortController();
  const waiting=captureFirstStep({...opts(),signal:controller.signal});
  controller.abort();
  const result=await waiting;
  assert.equal(result.ok,false);assert.equal(result.code,'cancelled');assert.equal(seen,true);assert.equal(callCount,1);
});
test('invalid image, missing model, and 429 stop without retry',async()=>{
  state.isMock=false;
  let calls=0;
  global.fetch=async()=>{calls++;return {ok:false,status:429,text:async()=> 'limit'};};
  assert.equal((await captureFirstStep({...opts(),imageDataUrl:'data:image/gif;base64,aQ=='})).code,'invalid_image');
  assert.equal((await captureFirstStep({...opts(),config:{...cfg,visionModel:''}})).code,'vision_unsupported');
  assert.equal((await captureFirstStep(opts())).code,'rate_limit');assert.equal(calls,1);
});
test('budget callback invoked per actual call; budget denial safely uses validated template',async()=>{
  state.isMock=false;let budget=0;
  global.fetch=async()=>payload(make({step:{text:'想清楚',anchorId:'a1'}}));
  const result=await captureFirstStep({...opts(),onModelAttempt:()=>{if(++budget>1)throw Error('exhausted');}});
  assert.equal(result.ok,true);assert.equal(result.step.source,'template');assert.equal(budget,2);
});
