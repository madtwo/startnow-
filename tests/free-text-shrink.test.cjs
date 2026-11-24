/** P0-C: adopted free text -> proposed comment -> explicit re-adoption. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);
const load=(n)=>require(path.join(__dirname,'..','src','lib',n+'.ts'));
const {adoptCommentAdvice,proposeSmallerComment,acceptAdvice,shrinkAdvice}=load('cards');
const {defaultPersonas}=load('personas');
const {fallbackSmallerText,validSmallerText,MAX_FREE_TEXT_SHRINK}=load('freeTextShrink');
const {importBundle,exportBundle}=load('store');
const people=defaultPersonas(); const p=people.find((x)=>x.id==='weini');
const now=Date.now()-10000;
const model={providerId:'compatible',baseUrl:'https://example.test/v1',model:'test',apiKey:'test-key'};
const mock={providerId:'mock',baseUrl:'',model:'',apiKey:''};
const settings={paused:false,maxArrivals:2,aiCardLimit:0,dailyCalls:20,maxCallsPerTick:2,speed:6,baselineExtra:''};
const advice='先补简历里最近一段经历的两行结果，别改整份';
const card=()=>({id:'me-1',authorId:'me',authorName:'我',authorKind:'player',kind:'worry',text:'不敢补自己的简历',createdAt:now,status:'talking',arrivals:['weini'],plan:[],pending:[],comments:[{id:'c0',authorId:'weini',authorKind:'persona',text:advice,at:now}]});
const adopted=()=>adoptCommentAdvice(card(),'c0',people,now).card;
const run=(c,config=mock)=>proposeSmallerComment({card:c,persona:p,config,settings,now:now+1000});
const modelResult=(text)=>new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200,headers:{'content-type':'application/json'}});

test('采用自由文本没有捏造 actionId，仍能走独立缩小提议',async()=>{
 const base=adopted(); assert.equal(base.advice.actionId,undefined);
 assert.equal(shrinkAdvice(base),base,'旧动作链函数不会偷偷覆盖');
 const result=await run(base);
 assert.equal(result.error,undefined);assert.equal(result.calls,0);
 assert.equal(result.comment.kind,'advice'); assert.equal(result.comment.origin,'simulated');
 assert.equal(result.comment.replyTo,'c0'); assert.equal(result.comment.parentAdviceSource,'c0');
 assert.match(result.comment.text,/简历/); assert.ok(result.comment.text.length<=20);
 assert.equal(base.advice.text,advice,'生成提议不会修改原 advice');
 assert.equal(base.comments.length,1,'生成提议不会直接写入原卡');
 const withReply={...base,comments:[...base.comments,result.comment]};
 const manual=adoptCommentAdvice(withReply,result.comment.id,people,now+1200).card;
 assert.equal(manual.advice.text,result.comment.text);
 assert.equal(manual.advice.sourceCommentId,result.comment.id);
 assert.equal(manual.advice.parentAdviceSource,'c0');
 assert.equal(manual.advice.shrinkDepth,1);
 assert.equal(manual.advice.actionId,undefined);
 const noted=acceptAdvice(manual,now+1300);
 assert.equal(noted.note.text,result.comment.text);
 assert.equal(noted.note.sourceCommentId,result.comment.id);
});

test('两级缩小后停止，并阻止同一源建议重复生成',async()=>{
 const base=adopted(); const first=await run(base);
 const withReply={...base,comments:[...base.comments,first.comment]};
 assert.match((await run(withReply)).error,/已经在评论里/);
 const a1=adoptCommentAdvice(withReply,first.comment.id,people).card;
 const second=await run(a1);
 assert.equal(second.comment.shrinkDepth,MAX_FREE_TEXT_SHRINK);
 assert.notEqual(second.comment.text,first.comment.text);
 const a2=adoptCommentAdvice({...a1,comments:[...a1.comments,second.comment]},second.comment.id,people).card;
 assert.match((await run(a2)).error,/最小/);
});

test('对话安慰不能被假装拆成动作，危险输入被拒绝',async()=>{
 for(const s of ['嗯，我在听。','你应该停药，先改药','加我微信号我再告诉你']) {
   const base=card();base.comments[0].text=s;
   const accepted=adoptCommentAdvice(base,'c0',people);
   if(accepted.error) continue;
   assert.ok((await run(accepted.card)).error);
 }
 assert.equal(fallbackSmallerText('嗯，我在听',0),null);
 assert.equal(validSmallerText('先停药看看',advice),false);
 assert.equal(validSmallerText('到你宿舍来找你',advice),false);
});

test('模型只给合法且同主题的一句话时标 model；离题/越界则是模拟 fallback',async()=>{
 const old=global.fetch;
 try {
   global.fetch=async()=>modelResult('先把简历文件打开');
   const valid=await run(adopted(),model);
   assert.equal(valid.calls,1); assert.equal(valid.comment.origin,'model');
   for (const text of ['先出门跑步','先加微信联系我','先把简历打开然后投十份']) {
     global.fetch=async()=>modelResult(text);
     const r=await run(adopted(),model);
     assert.equal(r.calls,1); assert.equal(r.comment.origin,'simulated');
     assert.match(r.comment.text,/简历/);
   }
 } finally {global.fetch=old;}
});

test('模型失败保留原建议、来源为 simulated，不写长期记忆',async()=>{
 const old=global.fetch;global.fetch=async()=>{throw new TypeError('offline')};
 try {
   const c=adopted();const before=JSON.stringify(c);
   const r=await run(c,model);
   assert.equal(r.calls,1);assert.equal(r.comment.origin,'simulated');
   assert.equal(JSON.stringify(c),before);
 } finally {global.fetch=old;}
});

test('新小步的来源在存档导入导出后保留，旧存档不需要这些字段',()=>{
 const base=adopted();const newComment={id:'c1',authorKind:'persona',authorId:p.id,at:now+1,
   text:'先只把简历文件打开',parentAdviceSource:'c0',replyTo:'c0',shrinkDepth:1,origin:'simulated'};
 const chosen=adoptCommentAdvice({...base,comments:[...base.comments,newComment]},'c1',people).card;
 const bundle={cards:[chosen],personas:people,world:{dayKey:'x',callsToday:0,lastTickAt:now,logs:[]},
 settings,identity:{id:'me',name:'我',avatarKey:'moon',bio:''},todos:[]};
 const imported=importBundle(exportBundle(bundle));
 const row=imported.cards.find((x)=>x.id===chosen.id);
 assert.equal(row.advice.parentAdviceSource,'c0');
 assert.equal(row.comments[1].shrinkDepth,1);
 assert.equal(row.comments[1].parentAdviceSource,'c0');
 assert.equal(row.advice.sourceCommentId,'c1');
});

test('UI 两个入口有显式确认、不自动调用 adopt，动作链继续直接 shrinkAdvice',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','src/App.tsx'),'utf8');
 const step=fs.readFileSync(path.join(__dirname,'..','src/components/StepBoard.tsx'),'utf8');
 const detail=fs.readFileSync(path.join(__dirname,'..','src/components/CardDetail.tsx'),'utf8');
 assert.match(step,/onRequestSmaller/); assert.match(step,/先留着这条/);
 assert.match(detail,/onRequestSmaller/); assert.match(detail,/先留着这条/);
 assert.match(detail,/用这条作为下一步/);
 assert.match(app,/proposeSmallerComment/);
 assert.match(app,/gate\.current\.start\('advice'\)/);
 const before={...adopted(),advice:{text:'先把书翻到要考的那一章，暂时不看别的。',actionId:'book-3',fromPersonaId:'weini',accepted:false,at:now}};
 assert.notEqual(shrinkAdvice(before),before,'actionId 分支应继续使用原动作库');
});

test('回执修复：同主题但任务量更大的建议不算更小一步', () => {
  for (const line of [
    '先投十份简历', '先改完整份简历', '先把所有简历改完',
    '先提交两份简历', '先把简历改三行', '先把简历改两行',
    '先投一百份简历', '先投十几份简历',
  ]) assert.equal(validSmallerText(line, advice), false, line);
  assert.equal(validSmallerText('先把简历文件打开', advice), true);
  assert.equal(validSmallerText('先补简历一行经历', advice), true);
  assert.equal(validSmallerText('先补简历四行经历', advice), false);
});

test('回执修复：模型给出更大动作时回退安全的模拟建议', async () => {
  const old = global.fetch;
  global.fetch = async () => modelResult('先投十份简历');
  try {
    const response = await run(adopted(), model);
    assert.equal(response.calls, 1);
    assert.equal(response.comment.origin, 'simulated');
    assert.match(response.comment.text, /简历/);
    assert.doesNotMatch(response.comment.text, /十份|投完|全部/);
  } finally { global.fetch = old; }
});
