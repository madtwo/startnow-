'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {install,state}=require('./tech-loader.cjs');install();
const {parseMaterialExtraction,redactMaterialText,extractMaterial}=require('../src/lib/materialVision.ts');
const make=(more={})=>({kind:'assignment',title:'实验报告',deadlineText:'周五 23:59',anchors:[{id:'a1',label:'第2题',quote:'第2题需写出误差来源'}],excerpt:'第2题需写出误差来源',confidence:'high',...more});
const cfg={providerId:'compatible',apiKey:'test-key',baseUrl:'https://example.test/v1',model:'test',visionModel:'vision'};
const originalFetch=global.fetch;
after(()=>{global.fetch=originalFetch;});
test('parses strict anchored JSON, removes unknown keys and maintains quote',()=>{
  const parsed=parseMaterialExtraction(JSON.stringify({...make(),override:'ignore'}));
  assert.ok(parsed.extraction);assert.equal(parsed.extraction.anchors[0].quote,'第2题需写出误差来源');assert.equal(parsed.extraction.override,undefined);
});
test('PII redaction of contact, named fields and IDs',()=>{
  const s=redactMaterialText('姓名：张三 学号:2026000123 手机号 13800138000 联系人:李四 email abc@example.com 身份证号:110101199001010010');
  for(const raw of ['张三','2026000123','13800138000','李四','abc@example.com','110101199001010010'])assert.equal(s.includes(raw),false);
  assert.ok(s.includes('[已隐去]'));
});
test('format invalid, missing anchors, duplicate ids, bad enum and long excerpt rejected',()=>{
  assert.equal(parseMaterialExtraction('not json').error,'format_invalid');
  assert.equal(parseMaterialExtraction(JSON.stringify(make({anchors:[]}))).error,'no_anchor');
  assert.equal(parseMaterialExtraction(JSON.stringify(make({anchors:[make().anchors[0],make().anchors[0]]}))).error,'format_invalid');
  assert.equal(parseMaterialExtraction(JSON.stringify(make({kind:'medical'}))).error,'format_invalid');
  assert.equal(parseMaterialExtraction(JSON.stringify(make({excerpt:'x'.repeat(2801)}))).error,'format_invalid');
});
test('crisis content is not persisted',()=>assert.equal(parseMaterialExtraction(JSON.stringify(make({excerpt:'我想自杀'}))).error,'unsafe_output'));
test('invalid image is rejected before any network request',async()=>{
  let called=false;global.fetch=async()=>{called=true;throw Error('should not fetch');};
  const result=await extractMaterial(cfg,'data:image/gif;base64,aQ==');
  assert.deepEqual([result.ok,result.code,called],[false,'invalid_image',false]);
});
test('vision unsupported is explicit',async()=>{state.isMock=true;const x=await extractMaterial(cfg,'data:image/png;base64,aQ==');assert.equal(x.code,'vision_unsupported');});
test('one format retry produces validated material, vision headers, and capped generation',async()=>{
  state.isMock=false;
  let attempts=0,record;
  global.fetch=async(url,opts)=>{record=JSON.parse(opts.body);assert.match(opts.headers['x-opencode-session'],/test-session/);attempts++;
    return {ok:true,json:async()=>({choices:[{message:{content:attempts===1?'BAD':JSON.stringify(make())}}]})};};
  const x=await extractMaterial(cfg,'data:image/png;base64,aQ==');
  assert.equal(x.ok,true);assert.equal(x.retried,true);assert.equal(attempts,2);assert.equal(record.max_tokens,1200);assert.equal(record.reasoning_effort,'low');
});
test('auth, 429 and missing session preserve distinct error codes and do not retry',async()=>{
  state.isMock=false;
  for(const [status,body,code] of [[401,'denied','auth'],[429,'rate limit','rate_limit'],[400,'MissingSessionID','session_missing']]){
    let calls=0;global.fetch=async()=>{calls++;return {ok:false,status,text:async()=>body};};
    const result=await extractMaterial(cfg,'data:image/png;base64,aQ==');
    assert.equal(result.code,code);assert.equal(calls,1);
  }
});
test('aborted call and unsafe model result fail closed',async()=>{
  state.isMock=false;
  const signal=new AbortController();signal.abort();
  assert.equal((await extractMaterial(cfg,'data:image/png;base64,aQ==',{signal:signal.signal})).code,'cancelled');
  global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(make({excerpt:'我想自杀'}))}}]})});
  const result=await extractMaterial(cfg,'data:image/png;base64,aQ==');assert.equal(result.code,'unsafe_output');
});
