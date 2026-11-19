const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const harness = fs.readFileSync(path.join(__dirname, '..', 'src', 'soak', 'harness.ts'), 'utf8');

function loadSection(startMarker, endMarker, named) {
  const start = harness.indexOf(startMarker);
  const end = harness.indexOf(endMarker, start);
  assert.ok(start !== -1 && end > start, 'Could not find tested metrics implementation');
  const js = ts.transpileModule(harness.slice(start, end) + `\nexports.value=${named};`, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports.value;
}
const responseMeta = loadSection('const responseMeta = ', 'const originalFetch', 'responseMeta');
const priceFor = loadSection('const PRICES:', '/* ---------- 请求预留预算', 'priceFor');

test('流式 SSE 结束、usage 和可见正文分开统计', () => {
  const body = [
    'data: {"choices":[{"delta":{"content":"简历"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{"content":"打开了"},"finish_reason":"stop"}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":300,"completion_tokens_details":{"reasoning_tokens":295}}}',
    '',
    'data: [DONE]', '',
  ].join('\n');
  const r = responseMeta(body,'text/event-stream');
  assert.equal(r.visibleTextChars,5);
  assert.equal(r.finishReason,'stop');
  assert.equal(r.sseDone,true);
  assert.equal(r.usage.completion_tokens_details.reasoning_tokens,295);
});

test('没有空行的兼容 SSE 也可以读出多条独立 data JSON', () => {
  const raw = 'data: {"choices":[{"delta":{"content":"嗯"},"finish_reason":null}]}\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n';
  const r = responseMeta(raw,'text/event-stream');
  assert.equal(r.visibleTextChars,1);
  assert.equal(r.finishReason,'length');
});

test('JSON 返回正文和 usage，HTTP 200 不等同于可用正文', () => {
  const r=responseMeta(JSON.stringify({choices:[{message:{content:''},finish_reason:'length'}],
    usage:{prompt_tokens:20,completion_tokens:600,completion_tokens_details:{reasoning_tokens:600}}}),
    'application/json');
  assert.equal(r.visibleTextChars,0);
  assert.equal(r.finishReason,'length');
  assert.equal(r.usage.completion_tokens,600);
});

test('价格缺失时拒绝继续，不能默认为免费', () => {
  assert.throws(()=>priceFor('unknown-paid-model'),/SOAK_UNKNOWN_MODEL_PRICE/);
  assert.equal(priceFor('hy4-flash-free').free,true);
  assert.equal(priceFor('deepseek-v4.1-flash').out,0.6);
});

test('新的分析脚本区分真实流时延与历史头时延，并统计完成事件',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'startnow-meter-'));
  const inp=path.join(tmp,'in');const out=path.join(tmp,'out');
  fs.mkdirSync(inp);
  const calls=[
    {callId:1,chainId:1,operationId:'one',model:'hy4-flash-free',stage:'done',ok:true,usableText:false,
      streamCompleteMs:240,headersMs:30,ttfbMs:50,latencyMs:240,visibleTextChars:0,finishReason:'length',
      promptTokens:20,completionTokens:170,reasoningTokens:170,cachedTokens:0,costUsd:0,usageSource:'api',
      startedReal:'2026-11-18T00:00:00.000Z',completedReal:'2026-11-18T00:00:00.240Z',atReal:'2026-11-18T00:00:00.000Z'},
    {callId:2,chainId:1,operationId:'one',model:'deepseek-v4.1-flash',stage:'done',ok:true,usableText:true,
      streamCompleteMs:470,headersMs:50,ttfbMs:80,latencyMs:470,visibleTextChars:14,finishReason:'stop',
      promptTokens:20,completionTokens:60,reasoningTokens:0,cachedTokens:0,costUsd:0.001,usageSource:'api',
      startedReal:'2026-11-18T00:00:00.240Z',completedReal:'2026-11-18T00:00:00.710Z',atReal:'2026-11-18T00:00:00.240Z'},
  ];
  const done='done-comment';
  const cards=[{id:'card',kind:'worry',authorKind:'player',authorId:'me',text:'简历',createdAt:0,
    comments:[{id:done,authorKind:'player',text:'做到了：打开简历。'},
      {id:'reply',replyTo:done,authorKind:'persona',origin:'simulated',fallbackReason:'reasoning_budget',text:'简历打开了'}]}];
  fs.writeFileSync(path.join(inp,'fake-calls-final.json'),JSON.stringify(calls));
  fs.writeFileSync(path.join(inp,'fake-cards.json'),JSON.stringify(cards));
  fs.writeFileSync(path.join(inp,'fake-scenarios.jsonl'),'');
  fs.writeFileSync(path.join(inp,'fake-summary.json'),JSON.stringify({finishedAt:'today'}));
  const script=path.resolve(__dirname,'..','scripts','analyze-soak.mjs');
  execFileSync(process.execPath,[script,'fake'],{env:{...process.env,SOAK_DATA_DIR:inp,SOAK_OUT_DIR:out}});
  const stats=JSON.parse(fs.readFileSync(path.join(out,'stats.json'),'utf8'));
  assert.equal(stats.calls.successRate,1);
  assert.equal(stats.calls.usableRate,0.5);
  assert.equal(stats.calls.responseP95,470);
  assert.equal(stats.calls.headersP95,50);
  assert.equal(stats.calls.reasoningExhaustions,1);
  assert.equal(stats.operations.completeP95,710);
  assert.equal(stats.cards.duplicateCompletionCards,0);
  assert.deepEqual(stats.cards.completionFallbackReasons,{reasoning_budget:1});
  fs.rmSync(tmp,{recursive:true,force:true});
});
