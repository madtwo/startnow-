/** Source-based regression suite: no API credentials, no paid requests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, file) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(out.outputText, file);
};
const src = (name) => require(path.join(__dirname, '..', 'src/lib', `${name}.ts`));
const { streamChat, LlmError } = src('llm');
const { completeCard, tickCards } = src('cards');
const { pickActions, inferTrouble } = src('actions');
const { defaultSettings } = src('store');
const { defaultPersonas } = src('personas');

const config = { baseUrl: 'https://example.invalid/v1', apiKey: 'test-token', model: 'hy4-flash-free', providerId: 'compatible' };
const mkOpts = (other = {}) => ({
  config, messages: [{ role:'user', content:'只回复：收到' }], maxTokens: 170,
  lowEffort: true, signal: AbortSignal.timeout(2000), onDelta: () => {}, ...other,
});
const sse = (...items) => new Response(items.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
  status:200, headers: {'content-type':'text/event-stream'},
});
const usage = (completion, reasoning) => ({
  prompt_tokens: 20, completion_tokens: completion,
  completion_tokens_details: {reasoning_tokens: reasoning},
});
async function withFetch(handler, callback) {
  const prior = global.fetch;
  global.fetch = handler;
  try { return await callback(); } finally { global.fetch = prior; }
}

test('推理用尽、零可见正文：保留输出预算和 finish_reason 诊断', async () => {
  const reports=[];
  await withFetch(async () => sse(
    {choices:[{delta:{},finish_reason:'length'}]}, {choices:[],usage:usage(170,170)},
  ), async () => {
    await assert.rejects(streamChat(mkOpts({onTelemetry:e=>reports.push(e)})),
      e=>e instanceof LlmError && e.kind==='truncated');
  });
  assert.equal(reports.length,1);
  assert.equal(reports[0].finishReason,'length');
  assert.equal(reports[0].visibleChars,0);
  assert.equal(reports[0].requestedMaxTokens,170);
  assert.equal(reports[0].reasoningBudgetExhausted,true);
});

test('有 finish_reason=stop 的中文自然短句，不因缺标点或缺 DONE 被拒绝', async () => {
  const reports=[];
  const body='data: {"choices":[{"delta":{"content":"嗯我听见了"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
  await withFetch(async()=>new Response(body,{headers:{'content-type':'text/event-stream'}}), async()=>{
    assert.equal(await streamChat(mkOpts({onTelemetry:e=>reports.push(e)})),'嗯我听见了');
  });
  assert.equal(reports[0].outcome,'ok');
  assert.equal(reports[0].finishReason,'stop');
});

test('明确 finish_reason=length 即使有正文，也不能被当成完整结果', async () => {
  const reports=[];
  await withFetch(async()=>sse(
    {choices:[{delta:{content:'先只打开简历'},finish_reason:null}]},
    {choices:[{delta:{},finish_reason:'length'}]},
    {usage:usage(600,500),choices:[]},
  ), async()=>{
    await assert.rejects(streamChat(mkOpts({onTelemetry:e=>reports.push(e)})),e=>e.kind==='truncated');
  });
  assert.equal(reports[0].visibleChars,'先只打开简历'.length);
  assert.equal(reports[0].reasoningBudgetExhausted,false);
});

test('主模型推理耗尽后备用模型正常返回，分别记录两次调用', async () => {
  const reports=[]; const called=[];
  await withFetch(async(_url,opts)=>{
    const m=JSON.parse(opts.body).model;called.push(m);
    if (m==='hy4-flash-free') return sse(
      {choices:[{delta:{},finish_reason:'length'}]}, {usage:usage(170,170),choices:[]},
    );
    return sse({choices:[{delta:{content:'明白了'},finish_reason:'stop'}]}, {usage:usage(15,0),choices:[]});
  },async()=>{
    const result=await streamChat(mkOpts({config:{...config,fallbackModel:'backup'},onTelemetry:e=>reports.push(e)}));
    assert.equal(result,'明白了');
  });
  assert.deepEqual(called,['hy4-flash-free','backup']);
  assert.deepEqual(reports.map(x=>x.outcome),['truncated','ok']);
});

test('无可见正文但有完整 usage 的 JSON 响应，归类为空正文', async () => {
  const reports=[];
  await withFetch(async()=>new Response(JSON.stringify({choices:[{message:{content:''},finish_reason:'stop'}],usage:usage(170,170)}), {
    headers:{'content-type':'application/json'},
  }), async()=>{
    await assert.rejects(streamChat(mkOpts({onTelemetry:e=>reports.push(e)})),e=>e.kind==='server' && /没有返回任何文字/.test(e.message));
  });
  assert.equal(reports[0].reasoningBudgetExhausted,true);
});

function makeNotedCard(now) {
  return {
    id:'mine',authorId:'me',authorKind:'player',authorName:'用户',text:'简历还没打开',
    createdAt:now-3600000,status:'noted',kind:'worry',arrivals:['shenmo','weini'],
    plan:[],pending:[],comments:[],
    note:{text:'把简历文件打开',actionId:'resume-2',fromPersonaId:'shenmo',at:now-1000,dueAt:now+86400000},
    advice:{text:'把简历文件打开',actionId:'resume-2',fromPersonaId:'shenmo',at:now-1000,accepted:true},
  };
}
const mockConfig={providerId:'mock',baseUrl:'',apiKey:'',model:'mock'};
test('一次完成：立即写入事实，仅排一条角色主回应且绑定完成评论', () => {
  const now=Date.now();
  const card=makeNotedCard(now);
  const done=completeCard(card,now,1);
  assert.equal(done.status,'done');
  assert.equal(done.comments.length,1);
  assert.equal(done.pending.length,1);
  assert.equal(done.pending[0].personaId,'shenmo');
  assert.equal(done.pending[0].sourceCommentId,done.comments[0].id);
  assert.equal(completeCard(done,now,1),done);
});

test('旧存档双重 reaction 只回应一次，刷新后不会再发第二条', async()=>{
  const now=Date.now();
  const done=completeCard(makeNotedCard(now),now,1);
  done.pending.push({personaId:'weini',phase:'reaction',at:now+2000});
  const settings={...defaultSettings,aiCardLimit:0,maxCallsPerTick:3,speed:1};
  const personas=defaultPersonas();
  const first=await tickCards({cards:[done],personas,settings,config:mockConfig,now:now+100000});
  const c=first.cards.find(x=>x.id==='mine');
  const replies=c.comments.filter(x=>x.authorKind==='persona'&&x.replyTo===done.comments[0].id);
  assert.equal(replies.length,1);
  assert.equal(replies[0].authorId,'shenmo');
  assert.equal(replies[0].fallbackReason,'demo');
  assert.equal(c.pending.filter(x=>x.phase==='reaction').length,0);
  const second=await tickCards({cards:first.cards,personas:first.personas,settings,config:mockConfig,now:now+200000});
  assert.equal(second.cards.find(x=>x.id==='mine').comments.filter(x=>x.authorKind==='persona').length,1);
});

test('实验异常数据不匹配数学例题，优先实验相关动作', () => {
  const text='实验数据全是异常值，重跑了两次都不行';
  assert.equal(inferTrouble(text),'study');
  const rows=pickActions(12,5,'study',text);
  assert.ok(rows.length>0);
  assert.ok(rows.some(x=>x.id.startsWith('lab-')));
  assert.ok(rows.every(x=>!x.id.startsWith('problem-')&&!x.id.startsWith('book-')));
});

test('24 小时近期同一个动作/同义文本过滤，不靠随机重复推送', () => {
  const recent=[{id:'resume-3',text:'打开简历，只改第一行'}, {text:'打开招聘软件'}];
  const rows=pickActions(12,10,'future','我在改简历',recent);
  assert.ok(rows.every(x=>x.id!=='resume-3'));
  assert.ok(rows.every(x=>x.label!=='打开招聘软件'));
});
