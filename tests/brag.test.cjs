/** 2026-11-17 round 3: accepted advice -> durable, safe, fictional brag cards. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(output.outputText, filename);
};
const lib = (file) => require(path.join(__dirname, '..', 'src', 'lib', `${file}.ts`));
const {
  estimateBragDelayMs, bragActionKind, scheduleAcceptedBrag, cancelBragsForNewWorry,
  cancelBragsForPersona, advanceBragMinutes, triggerNextBrag, isGroundedBrag,
  isNewerPersonaWorry, fallbackBragText,
} = lib('brag');
const { tickCards, closeCard } = lib('cards');
const { defaultPersonas } = lib('personas');
const { saveCards, loadCards, exportBundle, importBundle, emptyWorld, defaultSettings } = lib('store');
const people = defaultPersonas();
const config = { providerId: 'mock', apiKey: '', model: '', baseUrl: '' };
const settings = { ...defaultSettings, aiCardLimit: 0, maxCallsPerTick: 2, speed: 6 };
const now = Date.now() - 1000;
const ms = 60_000;
const me = '只打开招聘网站，看一个岗位的要求，先别投简历';
function source(id='source', personaId='shenmo', action=me) {
  const persona = people.find((p) => p.id === personaId);
  return {
    id, authorId: persona.id, authorName: persona.name, authorKind: 'persona', kind: 'worry',
    text: '打开招聘网站我就想关掉，岗位要求都不敢看。', createdAt: now - ms,
    status: 'talking', arrivals: [], plan: [], pending: [{personaId, phase:'decide', at:now-1, sourceCommentId:'c'}],
    comments: [{id:'c', authorId:'me', authorKind:'player', kind:'advice', at:now-1, text:action}],
  };
}
function accepted(base, date=now) {
  const c={...base,status:'advised',pending:[],advice:{text:base.comments[0].text,fromPersonaId:'me',
    accepted:true,at:date,sourceCommentId:'c'}};
  return scheduleAcceptedBrag(c,[c],date,()=>0.5);
}
function run(cards, date=now) {
  return tickCards({cards,personas:people,settings,config,now:date});
}
const oldRandom = Math.random;
async function decide(input, value=0.1) {
  Math.random=()=>value;
  try { return await run([input]); }
  finally { Math.random=oldRandom; }
}

test('动作时长：跑步、走路、看网页、写三行有分层，抖动独立',()=>{
  const atMid=(s,id)=>estimateBragDelayMs(s,id,()=>.5);
  const run=atMid('去跑两圈'), walk=atMid('下楼走两步'),web=atMid('打开招聘网页'),write=atMid('写三行字');
  assert.ok(run>walk && run>web && run>write);
  assert.ok(walk >= 2*ms && walk <= 7*ms);
  assert.ok(run >= 8*ms);
  assert.notEqual(estimateBragDelayMs('去跑两圈',undefined,()=>0),estimateBragDelayMs('去跑两圈',undefined,()=>.95));
  assert.ok(estimateBragDelayMs('不知道',undefined,()=>0)>=2*ms);
  assert.ok(estimateBragDelayMs('不知道',undefined,()=>.9)<=20*ms);
  assert.ok(atMid('吃一顿饭','run-3')>=10*ms,'优先行动库 actionId=run-3');
  assert.equal(bragActionKind('给辅导员问一下'),'ask');
  assert.equal(bragActionKind('先打开招聘网站只看岗位要求，不投简历'),'web');
  assert.doesNotMatch(fallbackBragText(people[0],me),/最后只发了一条|投出去/);
});

test('接受建议时安排一次独立任务，来源评论和动作原文不丢',async()=>{
  const result=await decide(source());
  const c=result.cards.find((x)=>x.id==='source');
  assert.equal(c.status,'advised');
  assert.ok(c.pendingBrag);
  assert.equal(c.advice.sourceCommentId,'c');
  assert.equal(c.pendingBrag.sourceCommentId,'c');
  assert.equal(c.pendingBrag.adviceText,me);
  assert.ok(c.pendingBrag.dueAt>now+2*ms);
  assert.equal(c.comments.length,2,'只有接受/拒绝回复，没在原卡追加炫耀评论');
  assert.match(result.logs.join(' '),/brag scheduled/);
});

test('到期后生成一张新的 persona brag，原卡 done，不新增 FOLLOW_LINES 评论',async()=>{
  const original=accepted(source());
  const pre=await run([original],original.pendingBrag.dueAt-1);
  assert.equal(pre.cards.filter((c)=>c.kind==='brag').length,0);
  const fired=await run(pre.cards,original.pendingBrag.dueAt+1);
  const brags=fired.cards.filter((c)=>c.kind==='brag');
  assert.equal(brags.length,1);
  assert.equal(brags[0].authorId,original.authorId);
  assert.equal(brags[0].origin,'simulated');
  assert.equal(brags[0].sourceCardId,'source');
  assert.equal(brags[0].sourceCommentId,'c');
  assert.equal(brags[0].sourceAdviceText,me);
  assert.equal(brags[0].pending.length,0);
  assert.equal(brags[0].comments.length,0);
  assert.equal(brags[0].createdAt,original.pendingBrag.dueAt+1);
  assert.ok(brags[0].text.includes('招聘网站'));
  assert.ok(/页面|岗位|要求/.test(brags[0].text));
  const parent=fired.cards.find((c)=>c.id==='source');
  assert.equal(parent.status,'done');
  assert.equal(parent.comments.length,1);
  assert.equal(parent.bragCardId,brags[0].id);
  assert.equal(parent.pendingBrag,undefined);
  const again=await run(fired.cards,original.pendingBrag.dueAt+30*ms);
  assert.equal(again.cards.filter((c)=>c.kind==='brag').length,1,'重复 tick 不重发');
});

test('掉线 / 关闭页面一天后恢复，不回填发帖时间，也不会自动补旧模板',async()=>{
  const original=accepted(source());
  const late=original.pendingBrag.dueAt+36*60*ms;
  const fired=await run([original],late);
  const brag=fired.cards.find((c)=>c.kind==='brag');
  assert.ok(brag);
  assert.equal(brag.createdAt,late);
  assert.equal(fired.cards.find((c)=>c.id==='source').comments.length,1);
});

test('新烦恼比源卡新：到期前检查并取消旧 brag，不重复重试',async()=>{
  const old=accepted(source());
  const newer={...source('newer'),id:'newer',createdAt:old.createdAt+1,comments:[],pending:[]};
  assert.equal(isNewerPersonaWorry([old,newer],old),true);
  const fired=await run([old,newer],old.pendingBrag.dueAt+1);
  assert.equal(fired.cards.filter((c)=>c.kind==='brag').length,0);
  assert.equal(fired.cards.find((c)=>c.id==='source').pendingBrag,undefined);
  assert.match(fired.logs.join(' '),/cancelled: newer worry/);
});

test('模拟新烦恼发生时立即清理任务；另一角色新卡不触发取消',()=>{
  const old=accepted(source());
  const different={...source('different','weini'),createdAt:old.createdAt+10};
  assert.ok(cancelBragsForNewWorry([old],different).cards[0].pendingBrag);
  const newer={...source('newer'),id:'newer',createdAt:old.createdAt+10};
  const {cards,cancelled}=cancelBragsForNewWorry([old],newer,now);
  assert.deepEqual(cancelled,['source']);
  assert.equal(cards[0].pendingBrag,undefined);
  assert.equal(cards[0].status,'handled');
  assert.equal(cancelBragsForNewWorry(cards,newer,now).cancelled.length,0);
});

test('来源卡已经关闭、危机、无记忆、被拒绝或是用户发的卡都不安排',async()=>{
  const c=accepted(source());
  assert.equal(closeCard(c).pendingBrag,undefined);
  const closed=closeCard(c);
  const out=await run([closed],c.pendingBrag.dueAt+1);
  assert.equal(out.cards.filter((row)=>row.kind==='brag').length,0);
  assert.equal(scheduleAcceptedBrag({...c,noMemory:true,pendingBrag:undefined},[c],now).pendingBrag,undefined);
  assert.equal(scheduleAcceptedBrag({...c,status:'handled',pendingBrag:undefined},[c],now).pendingBrag,undefined);
  assert.equal(scheduleAcceptedBrag({...c,kind:'brag',pendingBrag:undefined},[c],now).pendingBrag,undefined);
  assert.equal(scheduleAcceptedBrag({...c,advice:{...c.advice,accepted:false},pendingBrag:undefined},[c],now).pendingBrag,undefined);
  assert.equal(scheduleAcceptedBrag({...c,authorKind:'player',pendingBrag:undefined},[c],now).pendingBrag,undefined);
  const crisis={...source('crisis'),comments:[{...source().comments[0],text:'我想自杀'}]};
  const blocked=await decide(crisis);
  assert.equal(blocked.cards.filter((row)=>row.kind==='brag').length,0);
  assert.equal(blocked.cards[0].pendingBrag,undefined);
  const noMem=await decide({...source('nm'),noMemory:true});
  assert.equal(noMem.cards[0].pendingBrag,undefined);
});

test('不安全建议不会安排也不会发卡；拒绝建议不会安排',async()=>{
  for (const unsafe of ['加我微信直接告诉我账号','自行停药再说']) {
    const result=await decide(source(`unsafe-${unsafe}`,'shenmo',unsafe));
    assert.equal(result.cards[0].pendingBrag,undefined);
    assert.equal(result.cards.filter((row)=>row.kind==='brag').length,0);
  }
  const refused=await decide(source('refused'),0.98);
  assert.equal(refused.cards[0].pendingBrag,undefined);
  assert.equal(refused.cards.filter((row)=>row.kind==='brag').length,0);
});

test('4 个角色兜底不同、包含建议和细节；不接受空泛模型文案',()=>{
  const texts=people.slice(0,4).map((p)=>fallbackBragText(p,'下楼走两步'));
  assert.equal(new Set(texts).size,4);
  texts.forEach((text)=>{ assert.ok(text.includes('下楼走两步')); assert.ok(text.includes('路口')||text.includes('楼下')); });
  assert.equal(isGroundedBrag('我做到了，没那么难。',me),false);
  assert.equal(isGroundedBrag('今天有进步，很开心，希望对你有帮助。',me),false);
  assert.equal(isGroundedBrag('我把招聘网站打开了，加载三次才成功，第一条岗位要求太长，只看了一半。',me),true);
  assert.equal(isGroundedBrag('我把微信号码发给你了，我们学校见面。',me),false);
});

test('作者后台: 分钟级只调 dueAt, 下一条到期, 指定角色取消队列',()=>{
  const a=accepted(source('a'));
  const b=accepted(source('b','weini'));
  const advanced=advanceBragMinutes([a,b],10);
  assert.equal(advanced[0].createdAt,a.createdAt);
  assert.equal(advanced[0].pendingBrag.dueAt,a.pendingBrag.dueAt-10*ms);
  assert.equal(advanced[0].pendingBrag.acceptedAt,a.pendingBrag.acceptedAt);
  assert.equal(advanced[0].comments.length,a.comments.length);
  const fired=triggerNextBrag([a,b],now);
  assert.equal(fired.filter((c)=>c.pendingBrag.dueAt===now-1).length,1);
  const cancelled=cancelBragsForPersona([a,b],'shenmo',now);
  assert.deepEqual(cancelled.cancelled,['a']);
  assert.equal(cancelled.cards[1].pendingBrag.dueAt,b.pendingBrag.dueAt);
});

test('v6 存档 / 导入导出保持 pending 和来源，完成后写回不重复',async()=>{
  const saved=new Map();
  const prior=global.localStorage;
  global.localStorage={getItem:(k)=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:(k)=>saved.delete(k)};
  try {
    const scheduled=accepted(source());
    saveCards([scheduled]);
    const loaded=loadCards();
    assert.equal(loaded[0].pendingBrag.adviceText,me);
    assert.equal(loaded[0].pendingBrag.sourceCommentId,'c');
    const fired=await run(loaded,scheduled.pendingBrag.dueAt+1);
    saveCards(fired.cards);
    const refreshed=loadCards();
    assert.equal(refreshed.find((c)=>c.sourceCardId==='source').sourceAdviceText,me);
    const again=await run(refreshed,scheduled.pendingBrag.dueAt+5000);
    assert.equal(again.cards.filter((c)=>c.kind==='brag').length,1);
    const json=exportBundle({cards:refreshed,personas:people,world:emptyWorld(),settings,identity:{id:'me',name:'我',avatarKey:'petal',bio:''},todos:[]});
    assert.equal(importBundle(json).cards.find((c)=>c.sourceCardId==='source').sourceCommentId,'c');
    const corrupt={...scheduled,pendingBrag:{...scheduled.pendingBrag,personaId:'not-a-role'}};
    saveCards([corrupt]);
    assert.equal(loadCards()[0].pendingBrag,undefined,'corrupted archive job discarded');
    const closed=closeCard(scheduled); saveCards([closed]);
    assert.equal(loadCards()[0].pendingBrag,undefined);
  } finally {global.localStorage=prior;}
});

test('模型网络失败时发有来源的动作兜底，不会冒充模型',async()=>{
  const savedFetch=global.fetch;
  global.fetch=async()=>{ throw new Error('simulated offline'); };
  const src=accepted(source());
  try {
    const result=await tickCards({cards:[src],personas:people,settings,now:src.pendingBrag.dueAt+1,
      config:{providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini',apiKey:'demo-not-real'}});
    assert.equal(result.cards.find((c)=>c.kind==='brag').origin,'simulated');
    assert.match(result.logs.join(' '),/fallback/);
    assert.equal(result.calls,1);
  } finally {global.fetch=savedFetch;}
});

test('本轮变动仅卡片论坛，不改 room 入口的关键源码',()=>{
  const root=path.join(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'src','App.tsx'),'utf8');
  const cards=fs.readFileSync(path.join(root,'src','lib','cards.ts'),'utf8');
  assert.ok(!cards.includes('const FOLLOW_LINES'));
  assert.ok(!app.includes('personaBrag('),'不再使用无关联的五小时随机炫耀');
  assert.ok(app.includes('onAdvanceBragMinutes'));
  assert.ok(app.includes('sourceCardId'));
  assert.ok(app.includes("setView('room')"),'群聊入口并入主站视图');
  assert.ok(!app.includes("window.location.href = '/room.html'"),'不再跳出到独立群聊页');
});

test('bragOnly 作者调试只结算炫耀，不生成烦恼、到场、helper 或回复',async()=>{
  const posted=accepted(source());
  const due=posted.pendingBrag.dueAt +1;
  const second={...source('another','weini','下楼走两步'),
    createdAt: now-400000, plan:[{personaId:'yanggao',at:now-1}],
    pending:[{personaId:'yanggao',phase:'reply',at:now-1}], helperAt:now-1};
  const out=await tickCards({cards:[posted,second],personas:people,
    settings:{...settings,aiCardLimit:4,maxCallsPerTick:3},config,now:due,bragOnly:true});
  assert.equal(out.cards.filter((c)=>c.kind==='brag').length,1);
  assert.equal(out.cards.filter((c)=>c.kind!=='brag').length,2,'无任何自动额外帖');
  const original=out.cards.find((c)=>c.id==='another');
  assert.equal(original.comments.length,1);
  assert.equal(original.plan.length,1);
  assert.equal(original.pending.length,1);
  assert.equal(original.helperAt,now-1);
});

test('模型成功返回具体动作+结果时标 model；系统规则和低信任历史分层',async()=>{
  const old=global.fetch;
  const content='我把招聘网站打开了，第一次没刷出来，刷新后看完第一条岗位要求，第二条暂时没点。';
  let body;
  global.fetch=async(_url,opts)=>{
    body=JSON.parse(opts.body);
    return new Response(JSON.stringify({choices:[{message:{content}}]}),{
      status:200,headers:{'content-type':'application/json'},
    });
  };
  const src=accepted(source());
  try {
    const output=await tickCards({cards:[src],personas:people,settings,now:src.pendingBrag.dueAt+1,
      config:{providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'some-model',apiKey:'demo-not-real'}});
    const brag=output.cards.find((c)=>c.kind==='brag');
    assert.equal(brag.origin,'model');
    assert.equal(brag.text,content);
    assert.equal(body.messages[0].role,'system');
    assert.equal(body.messages[1].role,'user');
    assert.ok(body.messages[1].content.includes(me));
    assert.ok(!body.messages[0].content.includes(me),'建议不能上升为 system 内容');
  } finally {global.fetch=old;}
});

test('TSX 新增入口和卡片展示至少通过 TypeScript 语法编译',()=>{
  for (const name of ['App.tsx','components/AdminPanel.tsx']) {
    const full=path.join(__dirname,'..','src',name);
    const result=ts.transpileModule(fs.readFileSync(full,'utf8'),{
      fileName:full,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext},
    });
    assert.deepEqual(result.diagnostics.filter((d)=>d.category===ts.DiagnosticCategory.Error),[],name);
  }
});
