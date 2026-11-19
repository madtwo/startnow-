const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = path.resolve(__dirname, '..', 'scripts', 'analyze-soak.mjs');
function analyze({ meta, calls, cards = [], scenarios = [], completionAB = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-quality-report-'));
  const inp = path.join(dir, 'in'); const out = path.join(dir, 'out');
  fs.mkdirSync(inp); fs.mkdirSync(out);
  fs.writeFileSync(path.join(inp, 'fake-calls-final.json'), JSON.stringify(calls));
  fs.writeFileSync(path.join(inp, 'fake-cards.json'), JSON.stringify(cards));
  fs.writeFileSync(path.join(inp, 'fake-scenarios.jsonl'), scenarios.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(inp, 'fake-summary.json'), JSON.stringify({ meta, finishedAt: '2026-11-18' }));
  if (completionAB) fs.writeFileSync(path.join(inp, 'fake-completion-ab.json'), JSON.stringify(completionAB));
  try {
    execFileSync(process.execPath, [script, 'fake'], { env: {
      ...process.env, SOAK_DATA_DIR: inp, SOAK_OUT_DIR: out,
    }, stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(out, 'stats.json'), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const call = (id, model, costUsd, more = {}) => ({
  callId: id, chainId: id, operationId: String(id), model, ok: true, usableText: true,
  promptTokens: 100, completionTokens: 50, reasoningTokens: 0,
  costUsd, usageSource: 'api', streamCompleteMs: 250,
  startedReal: `2026-11-18T00:00:0${id}.000Z`, completedReal: `2026-11-18T00:00:0${id}.250Z`,
  ...more,
});
const playerDoneCard = (id) => ({
  id, authorKind: 'player', authorId: 'me', text: '卡住了', createdAt: 0,
  comments: [{ id: id + '-done', authorKind: 'player', authorId: 'me', text: '做到了：打开简历。' },
    { id: id + '-reply', authorKind: 'persona', authorId: 'shenmo', origin: 'model',
      text: '简历打开了。', replyTo: id + '-done' }],
});

test('主模型为 DeepSeek 且关闭备用时，DeepSeek 调用不能算备用', () => {
  const stats = analyze({ meta: { model: 'deepseek-v4.1-flash', fallback: '' },
    calls: [call(1, 'deepseek-v4.1-flash', .012, { callRole: 'primary' }),
      call(2, 'deepseek-v4.1-flash', .004)], cards: [playerDoneCard('a'), playerDoneCard('b')],
    scenarios: [{ chain: 1, stage: 'done' }, { chain: 2, stage: 'done' }] });
  assert.equal(stats.faults.fallbackCalls, 0);
  assert.equal(stats.unitCosts.completedPlayerCards, 2);
  assert.equal(stats.unitCosts.perPlayerCompletedCard, .008);
  assert.equal(stats.unitCosts.perCompletionScenarioChain, .008);
});

test('按角色身份或当次运行配置识别备用，不通过模型名字硬编码', () => {
  const stats = analyze({ meta: { model: 'hy4-flash-free', fallback: 'deepseek-v4.1-flash' },
    calls: [call(1, 'hy4-flash-free', 0, { callRole: 'primary' }),
      call(2, 'deepseek-v4.1-flash', .002, { callRole: 'fallback' })] });
  assert.equal(stats.faults.fallbackCalls, 1);
});

test('旧日志缺少运行配置时，备用调用数应标未知而不是猜一个模型', () => {
  const stats = analyze({ meta: {}, calls: [call(1, 'deepseek-v4.1-flash', .001)] });
  assert.equal(stats.faults.fallbackCalls, null);
  assert.equal(stats.faults.fallbackRoleKnown, false);
});

test('剔除故障注入后报告正常正文率，不混同 HTTP 200', () => {
  const stats = analyze({ meta: { model: 'deepseek-v4.1-flash', fallback: '' }, calls: [
    call(1, 'deepseek-v4.1-flash', .001, { usableText: true }),
    call(2, 'deepseek-v4.1-flash', .001, { usableText: false, fault: '500', ok: false }),
  ] });
  assert.equal(stats.calls.usableRate, .5);
  assert.equal(stats.calls.cleanUsableRate, 1);
  assert.equal(stats.calls.cleanCalls, 1);
  assert.equal(stats.calls.successRate, .5);
});

test('模型 A/B 只计完整配对，分开模型采用率、花费与兜底原因', () => {
  const rows = [
    { pairId: 0, caseId: 'resume', context: 'clean', model: 'hy4-flash-free', primaryAdopted: false,
      fallbackReason: 'reasoning_budget', costUsd: 0, requestCount: 1, elapsedMs: 500 },
    { pairId: 0, caseId: 'resume', context: 'clean', model: 'deepseek-v4.1-flash', primaryAdopted: true,
      costUsd: .004, requestCount: 1, elapsedMs: 300 },
    { pairId: 1, caseId: 'water', context: 'distracting', model: 'hy4-flash-free', primaryAdopted: false,
      fallbackReason: 'invalid_action', costUsd: 0, requestCount: 2, elapsedMs: 600 },
    { pairId: 1, caseId: 'water', context: 'distracting', model: 'deepseek-v4.1-flash', primaryAdopted: true,
      costUsd: .004, requestCount: 1, elapsedMs: 280 },
    { pairId: 2, caseId: 'paper', context: 'clean', model: 'hy4-flash-free', primaryAdopted: false,
      costUsd: 0, requestCount: 1, elapsedMs: 450 },
  ];
  const stats = analyze({ meta: { scenario: 'completion-ab', models: ['hy4-flash-free', 'deepseek-v4.1-flash'] },
    calls: [call(1, 'hy4-flash-free', 0)], completionAB: { syntheticFixtures: true, results: rows } });
  assert.equal(stats.completionAB.validPairs, 2);
  assert.equal(stats.completionAB.samples, 5);
  const ds = stats.completionAB.models.find((x) => x.model === 'deepseek-v4.1-flash');
  assert.equal(ds.adoptionRate, 1);
  assert.equal(ds.usd, .008);
  const hy = stats.completionAB.models.find((x) => x.model === 'hy4-flash-free');
  assert.equal(hy.adoptionRate, 0);
  assert.equal(hy.fallbackReasons.invalid_action, 1);
});
