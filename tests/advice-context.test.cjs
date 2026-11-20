/** Advice context reminder and follow-up integration, offline-only. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('./_ts-loader.cjs');
const root = path.join(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const { playerFollowups, adviceContextText, adviceContextCheck } = require('../src/lib/adviceContext.ts');
const { createOperationGate } = require('../src/lib/operationGate.ts');
const budget = require('../src/lib/shortTaskBudgets.ts').SHORT_TASK_TOKEN_BUDGETS;
const now = 1795000000000;
const mkCard = (overrides = {}) => ({
  id: 'player-card', authorId: 'me', authorKind: 'player', authorName: '玩家', kind: 'worry',
  text: '高数看不进去', createdAt: now - 60_000, status: 'talking',
  arrivals: ['shenmo'], plan: [], pending: [], comments: [], ...overrides,
});
const msg = (text, more = {}) => ({
  id: `msg${Math.random()}`, authorId: 'me', authorKind: 'player',
  kind: 'comment', text, at: now, ...more,
});
const question = (text = '你试过哪一步？', more = {}) =>
  msg(text, { authorId: 'shenmo', authorKind: 'persona', origin: 'model', ...more });

// Pure, storage-free domain checks.
test('own worry with no follow-up always asks once even with a long original post', () => {
  assert.deepEqual(adviceContextCheck(mkCard()), { thin: true, reason: 'no-followup' });
  assert.deepEqual(adviceContextCheck(mkCard({ text: '长'.repeat(1000) })),
    { thin: true, reason: 'no-followup' });
});
test('valid player reply removes the reminder; a short acknowledgement does not', () => {
  assert.deepEqual(adviceContextCheck(mkCard({ comments: [msg('最卡的是不知道从哪做')] })), { thin: false });
  assert.deepEqual(adviceContextCheck(mkCard({ comments: [msg('嗯')] })),
    { thin: true, reason: 'no-followup' });
});
test('fresh persona question triggers unanswered-question, with either question mark', () => {
  for (const mark of ['?', '？']) {
    const card = mkCard({ comments: [question(`你具体卡在哪${mark}`, { at: now + 2 })] });
    assert.deepEqual(adviceContextCheck(card), { thin: true, reason: 'unanswered-question' });
    assert.deepEqual(adviceContextCheck({ ...card, comments: [...card.comments, msg('最卡在第三道题', {at:now+3})] }),
      { thin: false });
  }
});
test('a later short reply cancels unanswered-question without making it a valid supplement', () => {
  const c = mkCard({ comments: [question('能说具体点吗？', {at:now+1}), msg('嗯', {at:now+2})] });
  assert.deepEqual(adviceContextCheck(c), { thin: true, reason: 'no-followup' });
});
test('system/boundary questions are not eligible for unanswered-question', () => {
  for (const origin of ['system', 'boundary']) {
    const c = mkCard({ comments: [question('你还好吗？', {origin, at:now+5})] });
    assert.deepEqual(adviceContextCheck(c), { thin: true, reason: 'no-followup' });
  }
});
test('material and capture step both bypass the reminder', () => {
  assert.deepEqual(adviceContextCheck(mkCard({material:{anchors:[]}})), {thin:false});
  assert.deepEqual(adviceContextCheck(mkCard({materialCaptureStep:{text:'动作',anchorId:'1',source:'model',personaId:'shenmo'}})), {thin:false});
});
test('unrelated card kinds, guide, persona, intros and closed cards never warn', () => {
  for (const kind of ['brag','life','guide','goal','progress'])
    assert.deepEqual(adviceContextCheck(mkCard({kind})), {thin:false});
  for (const flags of [{intro:true},{playerIntro:true},{authorId:'other'},
    {authorId:'shenmo',authorKind:'persona'},{status:'noted'}, {status:'done'},
    {status:'handled'}, {advice:{text:'已经有了'}}])
    assert.deepEqual(adviceContextCheck(mkCard(flags)), {thin:false});
  assert.equal(adviceContextCheck(mkCard({kind:undefined})).thin, true);
});
test('only player non-advice comments on own card count as follow-ups', () => {
  const comments = [msg('我是在给别人递建议',{kind:'advice'}),question('请具体说说？'),
    msg('   '),msg('我正在看第六章')];
  assert.deepEqual(playerFollowups(mkCard({comments})), ['我正在看第六章']);
  assert.deepEqual(playerFollowups(mkCard({comments,authorId:'shenmo',authorKind:'persona'})), []);
});
test('last three, each <= 120 and total <= 300; older content dropped rather than truncated', () => {
  const c = mkCard({comments:[msg('旧记录永不入选'), ...[1,2,3].map(n=>msg(String(n).repeat(120)))]});
  assert.deepEqual(playerFollowups(c), [String(2).repeat(120), String(3).repeat(120)]);
  assert.ok(playerFollowups(mkCard({comments:[msg('x'.repeat(1000))]}))[0].length===120);
  const three = mkCard({comments:[msg('a'.repeat(70)),msg('b'.repeat(100)),msg('c'.repeat(120))]});
  assert.deepEqual(playerFollowups(three).map(t=>t.length),[70,100,120]);
});
test('newest follow-ups lead the context, long original stays last; no follow-ups is byte-identical', () => {
  const original = '先说今天的原帖' + 'x'.repeat(1000);
  assert.equal(adviceContextText(mkCard({text:original})),original);
  const text = adviceContextText(mkCard({text:original,comments:[msg('最卡的是开头一段'),msg('准备先改第一段')] }));
  assert.match(text,/^楼主后续补充：\n- 最卡的是开头一段\n- 准备先改第一段\n\n原帖：\n/);
  assert.equal(text.endsWith(original),true);
});
test('all domain helpers preserve their input, including nested comment objects', () => {
  const card = mkCard({comments:[msg(' 我还在盯着第二题  '),question()]});
  const before = structuredClone(card);
  Object.freeze(card); Object.freeze(card.comments); card.comments.forEach(Object.freeze);
  playerFollowups(card); adviceContextText(card); adviceContextCheck(card);
  assert.deepEqual(card,before);
});

// Dependencies not included in the user's partial source snapshot are isolated
// at the module boundary. This does NOT claim a full repository integration run.
let lastActionContext = null;
const defaultAction = {id:'lab-unit',label:'核对单位',line:'先核对一列单位',minutes:5};
const fakeModules = {
  '../config/providers': {isMock:(config)=>config.providerId==='mock'},
  './safety': {findCrisis:()=>false,isHeavyShare:()=>false},
  './submissionGuard': {hasPlayerCrisis:()=>false},
  './support': {needsHelpSeeking:()=>false, HELP_SEEKING_ACTIONS:[]},
  './actions': {
    inferTrouble:(text)=>{lastActionContext = text; return 'study';},
    pickActions:(_hour,_count,_trouble,context)=>{lastActionContext = context;return [defaultAction];},
    recentActionUses:()=>[], selectActionLine:()=>defaultAction.line,
  },
  './curatedUsage': {chooseCuratedActionLine:()=>({text:defaultAction.line,useAlternate:false,priorCards:0})},
  './mind': {mindAfterReply:(persona)=>persona.mind},
  './memory': {addMemory:(records)=>records,sanitizeMemoryText:(text)=>text,inferWeight:()=>1},
  './prompts': {systemFor:()=> '只选候选动作',withUntrustedHistory:(text)=>text},
  './llm': {
    LlmError:Error, describeError:(err)=>String(err),
    scopedOpenCodeSessionId:(key)=>key,
    streamChat:async({messages,maxTokens,lowEffort,sessionId,onTelemetry})=>{
      const response = await global.fetch('https://local.invalid/advice', {
        method:'POST',body:JSON.stringify({messages,max_tokens:maxTokens,reasoning_effort:lowEffort?'low':'medium',sessionId}),
      });
      const parsed=await response.json();
      onTelemetry?.({outcome:'ok',finishReason:'stop',requestedMaxTokens:maxTokens,
        visibleChars:parsed.choices[0].message.content.length,completionTokens:2,
        reasoningTokens:0,reasoningBudgetExhausted:false});
      return parsed.choices[0].message.content;
    },
  },
};
const originalLoad = Module._load;
Module._load = function(request,parent,isMain) {
  if (parent?.filename?.endsWith(`${path.sep}src${path.sep}lib${path.sep}cards.ts`) &&
    request !== './adviceContext' && request !== './shortTaskBudgets') {
    if (fakeModules[request]) return fakeModules[request];
    return new Proxy({}, {get:(_,key)=> key === '__esModule' ? true : () => undefined});
  }
  return originalLoad.call(this,request,parent,isMain);
};
const { askForAdvice, addPlayerComment } = require('../src/lib/cards.ts');
Module._load = originalLoad;
const people=[{id:'shenmo',name:'沈默',mind:{},memory:[],intimacy:10}];
const adviceInput = (card,config={providerId:'compatible'}) => ({
  cards:[card],cardId:card.id,now,personas:people,settings:{baselineExtra:'',dailyCalls:5},config,personaId:'shenmo',
});
async function fakeFetch(handler,fn) {
  const saved=global.fetch; const requests=[];
  global.fetch=async(_url,opts)=> {const body=JSON.parse(opts.body);requests.push(body);
    return new Response(JSON.stringify({choices:[{message:{content:handler(body)}}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {return {result:await fn(),requests};}
  finally {global.fetch=saved;}
}

test('real askForAdvice implementation selects candidates from follow-up context and makes one 900-token model call',async()=>{
  const supplement='最卡的是实验数据的单位核对';
  const original=mkCard({text:'原帖只有笼统的实验问题',comments:[msg(supplement)]});
  const {result,requests}=await fakeFetch(()=>defaultAction.id,()=>askForAdvice(adviceInput(original)));
  assert.equal(requests.length,1);
  assert.equal(requests[0].max_tokens,budget.advice);
  assert.equal(requests[0].reasoning_effort,'low');
  assert.equal(requests[0].sessionId,'shenmo:player-card');
  const prompt=requests[0].messages[1].content;
  assert.ok(prompt.includes('楼主后续补充：'));
  assert.ok(prompt.includes(supplement));
  assert.ok(lastActionContext.startsWith('楼主后续补充：'));
  assert.equal(result.calls,1);
  assert.equal(result.cards[0].advice.actionId,defaultAction.id);
  assert.doesNotMatch(result.logs.join(' '),/最卡的是实验数据的单位核对/);
});
test('legacy no-comment advice prompt remains unchanged; mock has zero network calls',async()=>{
  const original=mkCard({text:'只有原帖，没有补充'});
  const {requests}=await fakeFetch(()=>defaultAction.id,()=>askForAdvice(adviceInput(original)));
  assert.equal(requests.length,1);
  assert.match(requests[0].messages[1].content,/^卡片：只有原帖，没有补充\n\nlab-unit/);
  assert.doesNotMatch(requests[0].messages[1].content,/楼主后续补充/);
  const offline=await fakeFetch(()=>{throw Error('mock must not fetch');},()=>askForAdvice(adviceInput(original,{providerId:'mock'})));
  assert.equal(offline.requests.length,0);
});
test('NONE abstention still leaves no action rather than inventing one',async()=>{
  const original=mkCard({text:'实验数据异常',comments:[msg('我已经核对了两次单位')]});
  const {result,requests}=await fakeFetch(()=> 'NONE',()=>askForAdvice(adviceInput(original)));
  assert.equal(requests.length,1);
  assert.equal(result.cards[0].advice,undefined);
  assert.match(result.logs.join(' '),/advice_choice=none/);
});
test('normal supplemental comment is visible, with no pending reply enqueued',()=>{
  const original=mkCard();
  const next=addPlayerComment(original,'最卡在第六题',now,6,'comment');
  assert.notEqual(next,original);
  assert.equal(original.comments.length,0);
  assert.equal(next.comments.length,1);
  assert.equal(next.pending.length,0);
  assert.equal(next.comments[0].kind,'comment');
  assert.equal(next.comments[0].peer,undefined);
});

test('both UI entries call the same gate; only adviceNow owns advice lock',()=>{
  const app=source('src/App.tsx');
  assert.match(app,/onAdvice=\{\(card\) => requestAdvice\(card\)\}/);
  assert.match(app,/onAdvice=\{\(personaId\) => requestAdvice\(detailCard, personaId\)\}/);
  const match=app.match(/const requestAdvice = \(card: Card.*?\n  \};/s);
  assert.ok(match);
  assert.match(match[0],/guardSubmission/);
  assert.match(match[0],/adviceContextCheck\(current\)/);
  assert.doesNotMatch(match[0],/gate\.current\.start/);
  const nowBlock=app.match(/const adviceNow = async \(card: Card.*?\n  \};/s);
  assert.ok(nowBlock);
  assert.equal((nowBlock[0].match(/gate\.current\.start\('advice'\)/g)||[]).length,1);
  assert.ok(nowBlock[0].indexOf('setCards(nextCards)')<nowBlock[0].indexOf('await askForAdvice'));
  assert.ok(nowBlock[0].indexOf('const revision = gate.current.revision()')>nowBlock[0].indexOf('setCards(nextCards)'));
  assert.match(nowBlock[0],/cards: nextCards, personas: nextPersonas/);
  assert.doesNotMatch(nowBlock[0],/latest\.current\.cards !== cur\.cards\)\s*\{/);
});
test('dialog has both copy variants, all buttons, accessiblity and mobile affordances',()=>{
  const component=source('src/components/AdviceContextDialog.tsx');
  const css=source('src/styles.css');
  for (const snippet of ['现在就要下一步？','先回一句，再要下一步？','补上，再要下一步',
    '仍然直接要','先等等','先补一句（可选）','这句话会作为评论出现在卡片里。',
    'aria-modal="true"','role="dialog"','aria-label="关闭"','useDialogFocus','maxLength={120}',
    'data-autofocus']) assert.ok(component.includes(snippet),snippet);
  assert.match(css,/\.sheet\.advice-context-sheet/);
  assert.match(css,/\.advice-context-sheet textarea/);
  assert.match(css,/white-space: normal/);
  assert.match(source('src/App.tsx'),/adviceBypassed\.current\.add\(adviceGate\.cardId\)/);
  assert.match(source('src/App.tsx'),/key=\{adviceGate\.cardId\}/);
});
test('helper and dialog do not access storage or network; integration does not touch other features',()=>{
  const helpers=[source('src/lib/adviceContext.ts'),source('src/components/AdviceContextDialog.tsx')].join('\n');
  assert.doesNotMatch(helpers,/localStorage|sessionStorage|fetch\(|XMLHttpRequest|streamChat/);
  assert.doesNotMatch(source('src/App.tsx'),/onAdvice=\{\(card\) => void advice\(card\)\}/);
  assert.ok(source('package.json').includes('tests/advice-context.test.cjs'));
});

// Run the actual App handlers, extracted from their unmodified TypeScript AST,
// with a deterministic state + revision scheduler. We do not need React or a
// browser to test the sequence (and do not claim that this tests layout).
function extractAppHandlers(deps) {
  const content=source('src/App.tsx');
  const sf=ts.createSourceFile('App.tsx',content,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const names=new Set(['adviceNow','requestAdvice']);
  const chunks=[];
  const visit=(node)=>{
    if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
      chunks.push(`const ${node.getText(sf)};`);
    }
    ts.forEachChild(node,visit);
  };
  visit(sf);
  assert.equal(chunks.length,2);
  const js=ts.transpileModule(chunks.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(deps),`${js}\nreturn {adviceNow,requestAdvice};`)(...Object.values(deps));
}
function makeAppHarness(options={}) {
  const guardEvents=[]; const requests=[]; const notices=[]; const gates=[];
  const lock=createOperationGate();
  const original=mkCard();
  const latest={current:{cards:[original],personas:people,settings:{dailyCalls:5,speed:5},
    config:{providerId:'mock'},world:{dayKey:'today',callsToday:0,logs:[]}}};
  const adviceBypassed={current:new Set()}; let adviceGate=null;
  const states={writes:0,requests,notices,gates,guardEvents,get adviceGate(){return adviceGate;}};
  let resolveModel=null;
  const model=options.deferred ? (args)=>{requests.push(args);return new Promise(resolve=>{resolveModel=resolve;});} :
    async(args)=>{requests.push(args);return {cards:args.cards,personas:args.personas,calls:0,logs:[]};};
  const deps={
    latest,
    gate:{current:lock},
    guardSubmission:(...parts)=> { if(parts.some(part=>typeof part==='string'&&part.includes('危机'))) {
      guardEvents.push('crisis');return true;} return false;},
    setToast:(message)=>notices.push(message),
    setCards:(next)=>{states.writes++;lock.change();latest.current.cards=next;},
    setPersonas:(next)=>{lock.change();latest.current.personas=next;},
    setWorld:()=>{}, setWorking:()=>{},
    addPlayerComment,
    notePlayerShare:(old)=>old,
    askForAdvice:model,
    dayKey:()=> 'today',
    modelFailureNotice:()=>null,
    adviceContextCheck,
    adviceBypassed,
    setAdviceGate:(value)=>{adviceGate=value;},
  };
  return { ...extractAppHandlers(deps),latest,lock,states,adviceBypassed,
    resolve:(out)=>resolveModel?.(out),get adviceGate(){return adviceGate;} };
}
test('UI asks for context before spending quota; repeated click still asks until bypass',()=>{
  const h=makeAppHarness();
  h.requestAdvice(h.latest.current.cards[0]);
  assert.equal(h.adviceGate.reason,'no-followup');
  assert.equal(h.states.requests.length,0);
  h.requestAdvice(h.latest.current.cards[0]);
  assert.equal(h.adviceGate.reason,'no-followup');
  assert.equal(h.states.requests.length,0);
});
test('supplement is inserted before advice call, persisted in input, and starts without awaiting the model',async()=>{
  const h=makeAppHarness({deferred:true});
  const result=await h.adviceNow(h.latest.current.cards[0],undefined,'卡在第三道练习题');
  assert.equal(result,'started');
  assert.equal(h.states.writes,1);
  assert.equal(h.states.requests.length,1);
  assert.equal(h.states.requests[0].cards[0].comments[0].text,'卡在第三道练习题');
  assert.equal(h.latest.current.cards[0].pending.length,0);
  h.resolve({cards:h.states.requests[0].cards,personas:people,calls:0,logs:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.lock.running(),null);
});
test('busy advice operation does not write a comment or start an advice request',async()=>{
  const h=makeAppHarness(); const ticket=h.lock.start('tick');
  assert.equal(await h.adviceNow(h.latest.current.cards[0],undefined,'卡在第三道练习题'),'busy');
  assert.equal(h.states.writes,0);
  assert.equal(h.states.requests.length,0);
  assert.match(h.states.notices.join(' '),/正在处理另一条消息/);
  h.lock.finish(ticket);
});
test('crisis supplement blocks before card writes or advice calls',async()=>{
  const h=makeAppHarness();
  assert.equal(await h.adviceNow(h.latest.current.cards[0],undefined,'这是一段危机补充'),'blocked');
  assert.deepEqual(h.states.guardEvents,['crisis']);
  assert.equal(h.states.writes,0);
  assert.equal(h.states.requests.length,0);
});
test('old reply cannot overwrite a newer user edit; the supplement itself remains',async()=>{
  const h=makeAppHarness({deferred:true});
  const status=await h.adviceNow(h.latest.current.cards[0],undefined,'最卡的是第二题');
  assert.equal(status,'started');
  h.lock.change();
  const edited={...h.latest.current.cards[0],title:'玩家后来改了标题'};
  h.latest.current.cards=[edited];
  h.resolve({cards:[{...edited,advice:{text:'旧建议'}}],personas:people,calls:0,logs:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.latest.current.cards[0].advice,undefined);
  assert.equal(h.latest.current.cards[0].comments[0].text,'最卡的是第二题');
  assert.match(h.states.notices.join(' '),/新消息/);
});
test('card becomes unavailable while dialog is open: adviceNow blocks cleanly',async()=>{
  const h=makeAppHarness();
  h.latest.current.cards=[{...h.latest.current.cards[0],status:'noted'}];
  assert.equal(await h.adviceNow(mkCard(),undefined,'我还没开始第三题'),'blocked');
  assert.equal(h.states.writes,0);
  assert.equal(h.states.requests.length,0);
});
test('bypassed card requests advice directly, other card still shows context reminder',async()=>{
  const h=makeAppHarness();
  h.adviceBypassed.current.add('player-card');
  h.requestAdvice(h.latest.current.cards[0]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.states.requests.length,1);
  h.latest.current.cards=[mkCard({id:'second-card'})];
  h.requestAdvice(h.latest.current.cards[0]);
  assert.equal(h.adviceGate.cardId,'second-card');
});
