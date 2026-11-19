'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {install,state}=require('./tech-loader.cjs');install();
const {validateMaterialStep,templateMaterialStep,smallerMaterialStep,materialFirstStep}=require('../src/lib/materialAdvice.ts');
const data={kind:'assignment',anchors:[{id:'a1',label:'第2题',quote:'第2题需写出误差来源'},{id:'a2',label:'实验方法',quote:'要求说明实验方法'}],excerpt:'',confidence:'high'};
const persona={id:'miaoze',name:'苗泽',voice:'说事实，偶尔干巴巴冷幽默'};
const cfg={providerId:'compatible',apiKey:'test',baseUrl:'https://example.test/v1',model:'test'};
test('generic action and pure cognitive action rejected',()=>{
  assert.equal(validateMaterialStep('打开文档',data).reason,'generic');
  assert.equal(validateMaterialStep('分析第2题',data).reason,'mental_only');
  assert.equal(validateMaterialStep('先看一眼',data).reason,'no_anchor');
});
test('requires exact/identifiable material anchor, restricts length and safety',()=>{
  assert.deepEqual(validateMaterialStep('抄下「第2题」的题干。',data),{ok:true,anchorId:'a1'});
  assert.equal(validateMaterialStep('抄下「第9题」的题干。',data).reason,'no_anchor');
  assert.equal(validateMaterialStep('圈出第2题然后加微信',data).reason,'unsafe');
  assert.equal(validateMaterialStep('抄下第2题'.repeat(20),data).reason,'too_long');
});
test('template and shrink retain anchor ID, never invent requirements',()=>{
  const step=templateMaterialStep(data);assert.equal(step.source,'template');assert.equal(step.anchorId,'a1');
  const small=smallerMaterialStep(step,data);assert.equal(small.anchorId,'a1');assert.notEqual(small.text,step.text);
  assert.equal(smallerMaterialStep({text:'抄下',anchorId:'fake'},data),null);
});
test('mock mode consumes no model call',async()=>{
  state.isMock=true;state.streamCalls=0;
  const result=await materialFirstStep({extraction:data,persona,config:cfg,now:Date.now()});
  assert.equal(result.source,'template');assert.equal(state.streamCalls,0);
});
test('bad JSON -> retry, grounded action wins',async()=>{
  state.isMock=false;state.streamCalls=0;
  state.streamReply=()=>state.streamCalls===1?'not-json':JSON.stringify({step:'抄下「第2题」的题干。',anchorId:'a1'});
  const result=await materialFirstStep({extraction:data,persona,config:cfg,now:Date.now()});
  assert.deepEqual(result,{text:'抄下「第2题」的题干。',anchorId:'a1',source:'model'});
  assert.equal(state.streamCalls,2);
});
test('unsafe or fabricated output returns validated local template',async()=>{
  state.isMock=false;state.streamCalls=0;state.streamReply=JSON.stringify({step:'添加微信后抄第2题',anchorId:'a1'});
  const result=await materialFirstStep({extraction:data,persona,config:cfg,now:Date.now()});
  assert.equal(result.source,'template');assert.equal(state.streamCalls,1);
});
test('mismatched anchor ID never passes',async()=>{
  state.isMock=false;state.streamCalls=0;state.streamReply=JSON.stringify({step:'抄下第2题的题干。',anchorId:'a2'});
  const result=await materialFirstStep({extraction:data,persona,config:cfg,now:Date.now()});
  assert.equal(result.source,'template');
});
test('25 supplied fixture text cases give template anchor match (not OCR accuracy)',()=>{
  const fixtures=require('../fixtures/tech-material-cases.json');assert.equal(fixtures.length,25);
  for(const f of fixtures){
    const quote=f.expectedAnchors.find(x=>f.text.includes(x) && f.stepMustIncludeAny.some(w=>x.includes(w)));assert.ok(quote,f.id);
    const extraction={kind:f.kind,anchors:[{id:'a1',label:quote,quote}],excerpt:quote,confidence:'low'};
    const step=templateMaterialStep(extraction);assert.ok(step, f.id);
    assert.equal(validateMaterialStep(step.text,extraction).ok,true,f.id);
    assert.ok(f.stepMustIncludeAny.some(x=>step.text.includes(x)),f.id);
  }
});

test('distinct templates for five material genres still preserve real anchor',()=>{
  for(const kind of ['assignment','schedule','paper','datasheet','error']){
    const extract={...data,kind};const result=templateMaterialStep(extract);
    assert.ok(result,kind);assert.equal(validateMaterialStep(result.text,extract).ok,true);
  }
});
