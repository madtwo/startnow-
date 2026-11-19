/** P0-B: author brag controls, isolated timing and archive round-trip. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const load=(file)=>require(path.join(__dirname,'..','src','lib',file+'.ts'));
const {advanceBragMinutes,triggerNextBrag,estimateBragDelayMs}=load('brag');
const {defaultPersonas}=load('personas');
const {importBundle,exportBundle,saveCards,loadCards}=load('store');
const {tickCards}=load('cards');
const people=defaultPersonas();
const now=Date.now()-5000;
const src={id:'source',authorId:'miaoze',authorName:'苗泽',authorKind:'persona',kind:'worry',text:'我一直不敢打开招聘页面',status:'advised',createdAt:now-10000,arrivals:[],plan:[],pending:[],comments:[{id:'c1',authorKind:'player',authorId:'me',at:now-1000,kind:'advice',text:'先打开招聘页面'}], advice:{text:'先打开招聘页面',accepted:true,fromPersonaId:'me',sourceCommentId:'c1',at:now-1000},pendingBrag:{personaId:'miaoze',acceptedAt:now-1000,dueAt:now+9*60_000,adviceText:'先打开招聘页面',sourceCommentId:'c1'}};
const config={providerId:'mock',model:'',apiKey:'',baseUrl:''};
const settings={paused:false,maxArrivals:2,aiCardLimit:4,dailyCalls:99,maxCallsPerTick:3,speed:6,baselineExtra:''};

test('分钟快进只调整 dueAt，作者调试不会篡改建卡时间',()=>{
  for (const n of [3,10,30]) {
    const c=advanceBragMinutes([src],n)[0];
    assert.equal(c.pendingBrag.dueAt,src.pendingBrag.dueAt-n*60_000);
    assert.equal(c.createdAt,src.createdAt);
    assert.equal(c.comments.length,src.comments.length);
  }
  assert.ok(estimateBragDelayMs('打开招聘页面',undefined,()=>.5)>=120000);
});

test('只触发一条，不推进普通到场/回复或自动发烦恼',async()=>{
 const triggered=triggerNextBrag([src],now+1000);
 const unrelated={...src,id:'other',authorId:'shenmo',authorName:'沈默',pendingBrag:undefined,
   status:'talking', pending:[{personaId:'shenmo',phase:'reply',at:now-1000}],plan:[{personaId:'yanggao',at:now-1000}]};
 const out=await tickCards({cards:[unrelated,...triggered],personas:people,settings,config,bragOnly:true,now:now+2000});
 assert.equal(out.cards.filter((c)=>c.kind==='brag').length,1);
 assert.equal(out.cards.find((c)=>c.id==='other').comments.length,1);
 assert.equal(out.cards.find((c)=>c.id==='other').plan.length,1);
 assert.equal(out.cards.filter((c)=>c.kind==='worry').length,2);
});

test('作者后台已渲染当前 App 传入的独立控制，不使用旧组件',()=>{
 const panel=fs.readFileSync(path.join(__dirname,'..','src/components/AdminPanel.tsx'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'..','src/App.tsx'),'utf8');
 for (const marker of ['pendingBrags','onAdvanceBragMinutes','onFireNextBrag','onCancelBrags','onSimulateNewWorry']){
   assert.match(panel,new RegExp(marker));assert.match(app,new RegExp(marker));
 }
 assert.match(panel,/触发下一条(?:到期)?炫耀|立刻触发下一条炫耀/);
 assert.match(panel,/3, 10, 30/);
 assert.match(app,/bragOnly/);
});

test('预跑存档：导入、持久化加载、再导出保留 brag 来源字段',()=>{
 const p=path.join(__dirname,'..','demo','startnow-judge-demo.json');
 const data=importBundle(fs.readFileSync(p,'utf8'));
 assert.ok(data,'完整 v3 bundle 导入成功');
 const brag=data.cards.find((c)=>c.kind==='brag'&&c.sourceCardId);
 assert.ok(brag); assert.ok(brag.sourceCommentId); assert.ok(brag.sourceAdviceText);
 const old=global.localStorage; const rows=new Map();
 global.localStorage={getItem:(k)=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:(k)=>rows.delete(k)};
 try {
   saveCards(data.cards);
   const loaded=loadCards().find((c)=>c.id===brag.id);
   assert.equal(loaded.sourceCardId,brag.sourceCardId);
   assert.equal(loaded.sourceCommentId,brag.sourceCommentId);
   assert.equal(loaded.sourceAdviceText,brag.sourceAdviceText);
   const archive=importBundle(exportBundle({...data,cards:loadCards()}));
   const twice=archive.cards.find((c)=>c.id===brag.id);
   assert.deepEqual([twice.sourceCardId,twice.sourceCommentId,twice.sourceAdviceText],
     [brag.sourceCardId,brag.sourceCommentId,brag.sourceAdviceText]);
 } finally {global.localStorage=old;}
});
