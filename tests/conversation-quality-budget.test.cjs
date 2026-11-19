/** Regression for 2026-11-18 real-API conversation-quality receipt.
 * All HTTP responses are local fakes; this suite never spends API tokens.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const lib = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { SHORT_TASK_TOKEN_BUDGETS: budget } = lib('shortTaskBudgets');
const { askForAdvice, proposeSmallerComment, tickCards } = lib('cards');
const { defaultPersonas } = lib('personas');
const { defaultSettings } = lib('store');
const { scheduleAcceptedBrag, isGroundedBrag } = lib('brag');
const { fallbackSmallerText } = lib('freeTextShrink');
const now = 1795000000000;
const people = defaultPersonas();
const who = (id) => people.find((p) => p.id === id);
const config = { providerId:'compatible', apiKey:'local-fixture-key', model:'deepseek-v4.1-flash', baseUrl:'https://example.test/v1' };
const settings = { ...defaultSettings, paused:false, aiCardLimit:0, maxCallsPerTick:3, speed:1 };
const card = (id, text) => ({ id, text, authorKind:'player', authorId:'me',authorName:'测试',kind:'worry',
  status:'talking',createdAt:now-60_000,arrivals:['shenmo'],plan:[],pending:[],comments:[] });
const json = (text, reason='stop', usage={prompt_tokens:75,completion_tokens:60,completion_tokens_details:{reasoning_tokens:20}}) =>
  new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content:text}}],usage}),
    { status:200, headers:{'content-type':'application/json'} });
async function fakeFetch(handler, run) {
  const old = global.fetch;
  const calls = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return handler(body);
  };
  try { const output = await run(); return { output, calls }; }
  finally { global.fetch = old; }
}

// Designed to be run serially: tests change the same process's global.fetch.
test('short-task budgets are bounded and separate from ordinary conversation', () => {
  assert.deepEqual({ ...budget }, { advice:900, shrink:450, brag:600 });
  assert.ok(Object.isFrozen(budget));
  const source = fs.readFileSync(path.join(__dirname,'..','src','lib','cards.ts'),'utf8');
  assert.match(source,/const maxTokens = \/hy4-flash\/i\.test\(ctx\.config\.model\) \? 1200 : 300/);
  assert.match(source,/1800, 20_000, `\$\{persona\.id\}:feed`/);
});

test('advice selection uses 900 max_tokens and reports metadata without saving content', async () => {
  const original = card('lab-advice','实验数据异常，我要核查一列单位');
  const { output, calls } = await fakeFetch((body) => {
    const match = body.messages[1].content.match(/^([a-z0-9-]+) \|/m);
    assert.ok(match, 'the model sees curated candidate IDs');
    return json(match[1]);
  }, () => askForAdvice({cardId:original.id,cards:[original],personas:people,settings,config,now,personaId:'shenmo'}));
  assert.equal(calls.length,1);
  assert.equal(calls[0].max_tokens,900);
  assert.equal(calls[0].reasoning_effort,'low');
  assert.equal(output.calls,1);
  assert.match(output.logs.join(' '),/short_task=advice outcome=ok finish=stop budget=900/);
  assert.match(output.logs.join(' '),/advice_choice=model/);
  assert.equal(output.cards[0].advice.origin,'curated');
  assert.ok(output.cards[0].advice.actionId.startsWith('lab-'));
  assert.doesNotMatch(output.logs.join(' '),/local-fixture-key|实验数据异常/);
});

test('NONE abstains rather than inventing an action', async () => {
  const original=card('lab-none','实验数据异常，我要核查一列单位');
  const { output } = await fakeFetch(() => json('NONE'), () =>
    askForAdvice({cardId:original.id,cards:[original],personas:people,settings,config,now,personaId:'shenmo'}));
  assert.equal(output.cards[0].advice,undefined);
  assert.match(output.logs.join(' '),/advice_choice=none/);
  assert.match(output.cards[0].comments.at(-1).text,/具体卡点/);
});

test('length/empty advice response leaves a trace and uses visibly curated local action', async () => {
  const original=card('lab-length','实验数据异常，我要核查一列单位');
  const { output, calls } = await fakeFetch(() => json('', 'length',
    {prompt_tokens:110,completion_tokens:900,completion_tokens_details:{reasoning_tokens:900}}), () =>
    askForAdvice({cardId:original.id,cards:[original],personas:people,settings,config,now,personaId:'shenmo'}));
  assert.equal(calls.length,1);
  assert.equal(calls[0].max_tokens,900);
  assert.match(output.logs.join(' '),/short_task=advice outcome=truncated finish=length budget=900/);
  assert.match(output.logs.join(' '),/reasoningExhausted=true/);
  assert.match(output.logs.join(' '),/advice_choice=local_fallback/);
  assert.equal(output.cards[0].advice.origin,'curated');
});

test('streaming SSE reasoning-only length is distinguished from a usable reply', async () => {
  const original=card('lab-sse-length','实验数据异常，我要核查一列单位');
  const sse=[
    'data: {"choices":[{"delta":{"content":""},"finish_reason":"length"}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":900,"completion_tokens_details":{"reasoning_tokens":900}}}',
    '',
    'data: [DONE]', '',
  ].join('\n');
  const {output,calls}=await fakeFetch(() => new Response(sse,
    {status:200, headers:{'content-type':'text/event-stream'}}), () =>
    askForAdvice({cardId:original.id,cards:[original],personas:people,settings,config,now,personaId:'shenmo'}));
  assert.equal(calls.length,1);
  assert.equal(calls[0].max_tokens,900);
  assert.match(output.logs.join(' '),/short_task=advice outcome=truncated finish=length budget=900/);
  assert.match(output.logs.join(' '),/completionTokens=900 reasoningTokens=900 reasoningExhausted=true/);
  assert.match(output.logs.join(' '),/advice_choice=local_fallback/);
  assert.equal(output.cards[0].advice.origin,'curated');
});

function shrinkFixture() {
  const text='先打开简历文件，改第一段经历';
  return { ...card('shrink-test','简历没打开，我不知道从哪里改'),status:'advised',
    advice:{text,fromPersonaId:'shenmo',origin:'adopted',sourceCommentId:'p-1',accepted:false,at:now},
    comments:[{id:'p-1',authorId:'shenmo',authorKind:'persona',text,at:now-1000,kind:'comment'}] };
}

test('free-text shrink calls real model with a 450-token ceiling', async () => {
  const input=shrinkFixture();
  const smaller=fallbackSmallerText(input.advice.text,0);
  assert.ok(smaller);
  const {output,calls}=await fakeFetch(() => json(smaller), () =>
    proposeSmallerComment({card:input,persona:who('shenmo'),config,settings,now}));
  assert.equal(calls.length,1);
  assert.equal(calls[0].max_tokens,450);
  assert.equal(output.comment.origin,'model');
  assert.equal(output.comment.parentAdviceSource,'p-1');
  assert.match(output.logs.join(' '),/short_task=shrink outcome=ok finish=stop budget=450/);
  assert.equal(input.advice.text,'先打开简历文件，改第一段经历');
});

test('shrink model length failure keeps original advice; simulated proposal remains clearly marked', async () => {
  const input=shrinkFixture();
  const {output}=await fakeFetch(() => json('', 'length',
    {prompt_tokens:70,completion_tokens:450,completion_tokens_details:{reasoning_tokens:450}}), () =>
    proposeSmallerComment({card:input,persona:who('shenmo'),config,settings,now}));
  assert.ok(output.comment);
  assert.equal(output.comment.origin,'simulated');
  assert.match(output.logs.join(' '),/short_task=shrink outcome=truncated finish=length budget=450/);
  assert.equal(input.advice.text,'先打开简历文件，改第一段经历');
});

function bragFixture() {
  const adviceText='先打开招聘网站，只看一个岗位的要求';
  const source={id:'brag-source',kind:'worry',authorKind:'persona',authorId:'miaoze',authorName:'苗泽',
    text:'我看招聘要求就卡住，根本不敢看。',createdAt:now-120000,status:'advised',arrivals:[],plan:[],pending:[],
    comments:[{id:'c',authorKind:'player',authorId:'me',at:now-10_000,kind:'advice',text:adviceText}],
    advice:{text:adviceText,fromPersonaId:'me',accepted:true,sourceCommentId:'c',at:now-10_000}};
  const scheduled=scheduleAcceptedBrag(source,[source],now-9000,()=>0.5);
  assert.ok(scheduled.pendingBrag);
  return {...scheduled,pendingBrag:{...scheduled.pendingBrag,dueAt:now-1}};
}

test('brag generation uses 600 max_tokens and creates one distinct fictional card', async () => {
  const source=bragFixture();
  const answer='我打开招聘网站，只看了一个岗位的要求，看到第二条时就停了。岗位地点和日期我先抄下，其他还没有动。';
  assert.ok(isGroundedBrag(answer,source.advice.text));
  const {output,calls}=await fakeFetch(() => json(answer), () => tickCards({cards:[source],personas:people,settings,config,now,bragOnly:true}));
  assert.equal(calls.length,1);
  assert.equal(calls[0].max_tokens,600);
  const created=output.cards.filter((c)=>c.kind==='brag');
  assert.equal(created.length,1);
  assert.equal(created[0].origin,'model');
  assert.match(output.logs.join(' '),/short_task=brag outcome=ok finish=stop budget=600/);
  const repeat=await tickCards({cards:output.cards,personas:output.personas,settings,config,now:now+1000,bragOnly:true});
  assert.equal(repeat.cards.filter(c=>c.kind==='brag').length,1);
});

test('truncated brag remains clearly labeled simulated, never falsely recorded as real model output', async () => {
  const source=bragFixture();
  const {output,calls}=await fakeFetch(() => json('', 'length',
    {prompt_tokens:150,completion_tokens:600,completion_tokens_details:{reasoning_tokens:400}}), () =>
    tickCards({cards:[source],personas:people,settings,config,now,bragOnly:true}));
  assert.equal(calls[0].max_tokens,600);
  const brag=output.cards.find(c=>c.kind==='brag');
  assert.ok(brag);
  assert.equal(brag.origin,'simulated');
  assert.match(output.logs.join(' '),/short_task=brag outcome=truncated finish=length budget=600/);
});
