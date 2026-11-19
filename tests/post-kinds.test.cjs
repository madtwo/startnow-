const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const lib=n=>require(path.join(__dirname,'..','src','lib',n+'.ts'));
const {createPlayerCard}=lib('cards');
const {defaultPersonas}=lib('personas');
const {defaultSettings}=lib('store');
const now=1_800_000_000_000;
test('player can create worry, brag, life and goal cards',()=>{
  for(const kind of ['worry','brag','life','goal']){
    const card=createPlayerCard('一段话', '我', defaultPersonas(), defaultSettings, '', now, kind);
    assert.equal(card.kind,kind);
    assert.equal(card.authorKind,'player');
  }
});
test('composer exposes four type buttons and passes the selected kind',()=>{
  const form=fs.readFileSync(path.join(__dirname,'..','src','components','PostForm.tsx'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'..','src','App.tsx'),'utf8');
  for(const label of ['诉苦','炫耀','生活趣事','定下目标']) assert.match(form,new RegExp(label));
  assert.match(form,/onKind/);assert.match(app,/draftKind/);assert.match(app,/onKind=\{setDraftKind\}/);
});
