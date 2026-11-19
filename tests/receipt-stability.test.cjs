/** Based on the 2026-11-17 integration receipt. No additional npm dependencies. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), { fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }
).outputText,file);
const load = (file) => require(path.join(__dirname,'..','src','lib',file+'.ts'));
const { isGroundedCompletionReaction } = load('completionReaction');
const { completedActionAnchor } = load('completionReaction');
const { canRequestSmallerComment } = load('freeTextShrink');
const { boundaryRequest } = load('dialogue');
const { proposeSmallerComment, tickCards } = load('cards');
const { defaultPersonas, mockCardText } = load('personas');
const { defaultSettings, importBundle } = load('store');
const personas=defaultPersonas();
const persona=personas.find((p)=>p.id==='weini');
const now=Date.now();
const comment={id:'source-comment',authorId:'weini',authorKind:'persona',text:'先补简历里最近一段经历的两行结果',at:now,origin:'model'};
const card=(origin)=>({id:'legacy',authorId:'me',authorKind:'player',authorName:'我',
 text:'最近一直不敢处理自己的简历',createdAt:now,status:'advised',arrivals:['weini'],plan:[],pending:[],comments:[comment],
 advice:{text:comment.text,fromPersonaId:'weini',sourceCommentId:comment.id,at:now,accepted:false,
   ...(origin !== undefined ? {origin} : {})}});
const config={providerId:'mock',baseUrl:'',model:'',apiKey:''};
const settings={paused:false,maxArrivals:2,aiCardLimit:0,dailyCalls:10,maxCallsPerTick:2,speed:6,baselineExtra:''};

test('完成回应中的疑问句不能冒充动作已经完成',()=>{
 for(const line of ['你已经打开简历了吗？','简历打开了？','你是不是已经打开简历了。','你有没有打开简历？','简历打开了么。']) {
   assert.equal(isGroundedCompletionReaction(line,'打开简历'),false,line);
 }
});
test('完成回应中独立的肯定陈述仍然有效',()=>{
 assert.equal(isGroundedCompletionReaction('简历打开了。我的病理第三章还在等我。','打开简历'),true);
 assert.equal(isGroundedCompletionReaction('简历打开了。你要喝水吗？','打开简历'),true);
});
test('旧存档只接受同一角色的真实评论来源，不按缺失 origin 直接放行',()=>{
 for (const origin of [undefined,'curated','adopted']) assert.equal(canRequestSmallerComment(card(origin)),true);
 assert.equal(canRequestSmallerComment(card('demo')),false);
 const a=card();
 assert.equal(canRequestSmallerComment({...a,advice:{...a.advice,sourceCommentId:'missing'}}),false);
 assert.equal(canRequestSmallerComment({...a,advice:{...a.advice,text:'先投三十份简历'}}),false);
 assert.equal(canRequestSmallerComment({...a,comments:[{...comment,authorKind:'helper'}]}),false);
 assert.equal(canRequestSmallerComment({...a,comments:[{...comment,origin:'boundary'}]}),false);
 assert.equal(canRequestSmallerComment({...a,advice:{...a.advice,actionId:'resume-1'}}),false);
 assert.equal(canRequestSmallerComment({...a,advice:{...a.advice,accepted:true}}),false);
});
test('旧存档再小一步只提议新评论，不自动替换原便签、伪造 actionId',async()=>{
 for(const origin of [undefined,'curated']){
   const c=card(origin), snapshot=JSON.stringify(c);
   const out=await proposeSmallerComment({card:c,persona,config,settings,now:now+1000});
   assert.equal(out.error,undefined);
   assert.equal(out.comment.kind,'advice');
   assert.equal(out.comment.replyTo,comment.id);
   assert.equal(out.comment.parentAdviceSource,comment.id);
   assert.equal(out.comment.origin,'simulated');
   assert.equal(out.comment.shrinkDepth,1);
   assert.equal(JSON.stringify(c),snapshot);
   assert.equal(c.advice.actionId,undefined);
 }
});
test('暂停时调试按钮先提示，再触发排期；生产 tick 的暂停语义不变',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','src','App.tsx'),'utf8');
 const region=app.split('const fireNextBrag = () => {')[1]?.split('const cancelBrags =')[0];
 assert.ok(region);
 assert.match(region,/if \(settings\.paused\) \{ setToast\('[^']*取消暂停/);
 assert.ok(region.indexOf('settings.paused')<region.indexOf('triggerNextBrag'));
});
test('便签页与卡片详情均依赖真实来源判定',()=>{
 for(const filename of ['StepBoard.tsx','CardDetail.tsx']){
   const src=fs.readFileSync(path.join(__dirname,'..','src','components',filename),'utf8');
   assert.match(src,/canRequestSmallerComment/);
   assert.match(src,/onRequestSmaller/);
   assert.match(src,/先留着这条/);
 }
});
test('标签问句不能冒充完成确认',()=>{
 for(const line of ['你已经打开简历了，对吧','简历打开了，是吧','简历打开了，对不对','简历打开了，好吗']) {
   assert.equal(isGroundedCompletionReaction(line,'打开简历'),false,line);
 }
 assert.equal(isGroundedCompletionReaction('简历打开了。你要喝水吗？','打开简历'),true);
});
test('第三方微信叙述不是向 AI 索取联系方式',()=>{
 for(const text of [
   '喜欢一个女生，不知道怎么开口搭讪，加了微信也不会聊',
   '我加了她的微信，她一直不回我',
   '她加了我微信，但我不知道怎么聊',
   '体育课上看到一个女生好心动 好想要她的微信 但是不好意思',
   '想要一个女生的微信',
   '我想要她微信',
 ]) assert.equal(boundaryRequest(text),null,text);
 for(const text of ['能加你微信吗','加我微信吧','给我你的微信号','我想要你的微信','她让我加你微信']) {
   assert.equal(boundaryRequest(text),'contact',text);
 }
});
test('完成锚点跳过语气词，长建议退回泛化锚点',()=>{
 assert.equal(completedActionAnchor({text:'哦，把书翻开'}),'把书翻开');
 assert.equal(completedActionAnchor({
   text:'哦，是我会错意了。那个女生我不认识，也不在那边——微信都加了的话，可以先从她说过的一句具体的接，别一上来就要东西。。',
 }),'刚才那件小事');
});
test('演示模式同一角色不会复读完全相同的句子',async()=>{
 const c={id:'repeat',authorId:'me',authorName:'我',authorKind:'player',kind:'worry',
   text:'最近有点低落',createdAt:now-2000,status:'talking',arrivals:['weini'],plan:[],
   pending:[{personaId:'weini',phase:'reply',at:now-1}],
   comments:[{id:'old',authorId:'weini',authorKind:'persona',text:'嗯……先不用逼自己好起来。',at:now-1000}]};
 const out=await tickCards({cards:[c],personas,settings:{...settings,aiCardLimit:0},config,now});
 const rows=out.cards[0].comments.filter((row)=>row.authorId==='weini');
 assert.equal(rows.length,2);
 assert.notEqual(rows[1].text,rows[0].text);
});
test('演示模式的新卡不会与同角色近期卡重复',()=>{
 const p=personas.find((row)=>row.id==='miaoze');
 const first=mockCardText(p,3);
 assert.notEqual(mockCardText(p,3,[first]),first);
});
test('默认自动发卡频率为每 24 小时 8 张（约每 3 小时一张）',()=>{
 assert.equal(defaultSettings.aiCardLimit,8);
});
test('魏霓金融学、杨槔风景园林学，旧存档空专业会迁移',()=>{
 assert.equal(personas.find((p)=>p.id==='weini').major,'金融学');
 assert.equal(personas.find((p)=>p.id==='yanggao').major,'风景园林学');
 const bundle=importBundle(JSON.stringify({
   version:3,exportedAt:now,cards:[],world:{},settings:defaultSettings,
   identity:{id:'me',name:'我',avatarKey:'moon',bio:''},todos:[],
   personas:[
     {id:'weini',background:'水华木大学大四，22 岁，住校四人寝，专业暂未定；',major:''},
     {id:'yanggao',background:'临南学院大一，19 岁，住校',major:''},
   ],
 }));
 const w=bundle.personas.find((p)=>p.id==='weini');
 const y=bundle.personas.find((p)=>p.id==='yanggao');
 assert.equal(w.major,'金融学');
 assert.match(w.background,/金融学/);
 assert.equal(y.major,'风景园林学');
 assert.match(y.background,/风景园林学/);
});
