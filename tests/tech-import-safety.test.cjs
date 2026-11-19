'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');
const {install}=require('./tech-loader.cjs');install();
const memory=new Map();global.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
const {importBundle}=require('../src/lib/store.ts');
const now=Date.now();
const card=(id,changes={})=>({id,authorId:'me',authorName:'我',authorKind:'player',text:'我有一份学习材料',
  image:'data:image/png;base64,aQ==',createdAt:now,status:'stuck',arrivals:[],plan:[],pending:[],comments:[],...changes});
const material={kind:'assignment',anchors:[{id:'a1',label:'第2题',quote:'第2题有误差来源'}],excerpt:'联系邮箱 abc@example.com',confidence:'high'};
const asBundle=(cards)=>JSON.stringify({version:3,cards,personas:[],world:{},settings:{},identity:{id:'me',name:'我'},goals:[],schedule:[],summaries:[]});
test('import accepts redacted visible extraction only for player image cards',()=>{
  const loaded=importBundle(asBundle([card('image',{material})]));
  assert.equal(loaded.cards.length,1);assert.equal(loaded.cards[0].material.anchors[0].label,'第2题');
  assert.equal(loaded.cards[0].material.excerpt.includes('abc@example.com'),false);
});
test('import cannot fabricate material on card with no picture or another persona',()=>{
  const loaded=importBundle(asBundle([card('none',{image:undefined,material}),
    card('persona',{authorId:'shenmo',authorKind:'persona',material})]));
  assert.ok(loaded.cards.every(c=>!c.material));
});
test('import rejects manipulative persona prose and strips manipulative persona comments',()=>{
  const rows=[card('bad',{authorId:'shenmo',authorKind:'persona',text:'只有你能救我'}),
    card('good',{comments:[{id:'x',authorId:'shenmo',authorKind:'persona',text:'你不回我我就走',at:now},
      {id:'y',authorId:'shenmo',authorKind:'persona',text:'这题我也卡了一下',at:now}]})];
  const out=importBundle(asBundle(rows));
  assert.equal(out.cards.length,1);assert.equal(out.cards[0].comments.length,1);
});
test('import cannot insert fake material with invalid anchor IDs, unknown enums, or no anchors',()=>{
  for(const edited of [{kind:'scan'},{anchors:[]},{anchors:[{id:'<unsafe>',label:'第2题',quote:'第2题'}]}]){
    const out=importBundle(asBundle([card('a',{material:{...material,...edited}})]));
    assert.equal(out.cards[0].material,undefined);
  }
});
test('import sanitizes source flags for references and preserves valid historical marks',()=>{
  const loaded=importBundle(asBundle([card('a',{comments:[
    {id:'1',authorId:'me',authorKind:'player',text:'hello',at:now,growthReference:true},
    {id:'2',authorId:'miaoze',authorKind:'persona',text:'上次你让我只读摘要',at:now,growthReference:true}]})]));
  assert.equal(loaded.cards[0].comments[0].growthReference,false);
  assert.equal(loaded.cards[0].comments[1].growthReference,true);
});

test('import drops forged material advice provenance unless action matches a real saved anchor',()=>{
  const bogus={text:'打开文档',origin:'material',materialAnchorId:'a1',fromPersonaId:'miaoze',at:now,accepted:true};
  const good={...bogus,text:'圈出「第2题」对应的要求。',accepted:false};
  const loaded=importBundle(asBundle([
    card('no-image',{image:undefined,advice:good}),
    card('fake-advice',{material,advice:bogus}),
    card('wrong-anchor',{material,advice:{...good,materialAnchorId:'not-exists'}}),
    card('valid',{material,advice:good}),
  ]));
  for(const id of ['no-image','fake-advice','wrong-anchor'])
    assert.equal(loaded.cards.find(c=>c.id===id).advice,undefined,id);
  assert.equal(loaded.cards.find(c=>c.id==='valid').advice.materialAnchorId,'a1');
});
