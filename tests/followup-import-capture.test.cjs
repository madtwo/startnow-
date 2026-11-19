'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {install}=require('./tech-loader.cjs');install();
const m=new Map();global.localStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
const {importBundle}=require('../src/lib/store.ts');
const now=Date.now();
const material={kind:'assignment',anchors:[{id:'a1',label:'第2题',quote:'第2题有误差来源'}],excerpt:'第2题有误差来源',confidence:'high'};
const captured={text:'圈出「第2题」对应的要求。',anchorId:'a1',source:'model',personaId:'miaoze'};
const card=(id,changes={})=>({id,authorId:'me',authorName:'我',authorKind:'player',text:'作业卡片',
 image:'data:image/png;base64,aQ==',material,createdAt:now,status:'stuck',arrivals:[],plan:[],pending:[],comments:[],...changes});
const bundle=(rows)=>JSON.stringify({version:3,cards:rows,personas:[],world:{},settings:{},identity:{id:'me',name:'我'},goals:[],schedule:[],summaries:[]});
test('valid single capture survives archive import and retains provenance',()=>{
 const out=importBundle(bundle([card('ok',{materialCaptureStep:captured})]));
 assert.deepEqual(out.cards[0].materialCaptureStep,captured);
});
test('forged cached step, wrong id, unknown persona, bad action, PII are discarded',()=>{
 const rows=[
  card('no-evidence',{material:undefined,materialCaptureStep:captured}),
  card('wrong-anchor',{materialCaptureStep:{...captured,anchorId:'a999'}}),
  card('fake-id',{materialCaptureStep:{...captured,personaId:'__prototype__'}}),
  card('no-act',{materialCaptureStep:{...captured,text:'想一想如何做'}}),
  card('PII',{materialCaptureStep:{...captured,text:'抄下第2题和手机号13800138000'}}),
  card('wrong-source',{materialCaptureStep:{...captured,source:'raw'}}),
 ];
 const out=importBundle(bundle(rows));
 for(const c of out.cards)assert.equal(c.materialCaptureStep,undefined,c.id);
});
test('two-step mode archive has material but no cached step, remains compatible',()=>{
 const out=importBundle(bundle([card('legacy')]));
 assert.ok(out.cards[0].material);assert.equal(out.cards[0].materialCaptureStep,undefined);
});
