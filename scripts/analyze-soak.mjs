/** 长流程真实 API 测试的分析脚本：读取 .soak-data 下的一次运行，输出 stats.json 与表格片段。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.env.SOAK_DATA_DIR ?? resolve(process.cwd(), '.soak-data'));
const run = process.argv[2] ?? 'a1';
const outDir = resolve(process.env.SOAK_OUT_DIR ?? resolve(process.cwd(), 'startnow-realapi-longrun-2026-11-18', 'data'));
mkdirSync(outDir, { recursive: true });

const readJson = (name, fallback) => {
  const p = resolve(dir, name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
};
const readJsonl = (name) => {
  const p = resolve(dir, name);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
};

const calls = readJson(`${run}-calls-final.json`, []);
const scenarios = readJsonl(`${run}-scenarios.jsonl`);
const cards = readJson(`${run}-cards.json`, []);
const summary = readJson(`${run}-summary.json`, {});
const completionAB = readJson(`${run}-completion-ab.json`, null);

const pct = (rows, p) => {
  const numeric = rows.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!numeric.length) return null;
  const sorted = numeric.sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const group = (rows, keyFn) => {
  const map = new Map();
  for (const row of rows) {
    const k = keyFn(row) ?? 'unknown';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
};
const round = (n, d = 4) => Number(n.toFixed(d));
const duration = (r) => r.streamCompleteMs ?? r.latencyMs; // legacy header latency is separately marked
const hasUsableMetric = (r) => typeof r.usableText === 'boolean';
const usableRate = (rows) => {
  const observed = rows.filter(hasUsableMetric);
  return observed.length ? round(observed.filter((r) => r.usableText).length / observed.length, 4) : null;
};
const responseTime = (rows) => ({
  responseP50: pct(rows.map((r) => r.streamCompleteMs), 50),
  responseP95: pct(rows.map((r) => r.streamCompleteMs), 95),
  headersP50: pct(rows.map((r) => r.headersMs ?? (!('streamCompleteMs' in r) ? r.latencyMs : null)), 50),
  headersP95: pct(rows.map((r) => r.headersMs ?? (!('streamCompleteMs' in r) ? r.latencyMs : null)), 95),
  firstByteP95: pct(rows.map((r) => r.ttfbMs), 95),
});


/* ---------- 调用统计 ---------- */
const okCalls = calls.filter((c) => c.ok);
const failedCalls = calls.filter((c) => !c.ok);
const apiUsage = calls.filter((c) => c.usageSource === 'api');
const estUsage = calls.filter((c) => c.usageSource === 'estimate');

const byStage = [...group(calls, (c) => c.stage)].map(([stage, rows]) => ({
  stage,
  calls: rows.length,
  ok: rows.filter((r) => r.ok).length,
  fail: rows.filter((r) => !r.ok).length,
  ...responseTime(rows),
  usableRate: usableRate(rows),
  prompt: rows.reduce((s, r) => s + (r.promptTokens ?? 0), 0),
  completion: rows.reduce((s, r) => s + (r.completionTokens ?? 0), 0),
  reasoning: rows.reduce((s, r) => s + (r.reasoningTokens ?? 0), 0),
  usd: round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), 6),
}));

const byModel = [...group(calls, (c) => c.model)].map(([model, rows]) => ({
  model,
  calls: rows.length,
  ok: rows.filter((r) => r.ok).length,
  fail: rows.filter((r) => !r.ok).length,
  prompt: rows.reduce((s, r) => s + (r.promptTokens ?? 0), 0),
  completion: rows.reduce((s, r) => s + (r.completionTokens ?? 0), 0),
  reasoning: rows.reduce((s, r) => s + (r.reasoningTokens ?? 0), 0),
  usd: round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0), 6),
  ...responseTime(rows),
  usableRate: usableRate(rows),
}));

const faultsHit = calls.filter((c) => c.fault);
const timeouts = calls.filter((c) => /timeout|超时|Abort/i.test(`${c.error ?? ''} ${c.fault ?? ''}`));
const rateLimits = calls.filter((c) => c.status === 429);
// Role is NOT a model name: DeepSeek can be the primary model.
// Prefer role attached to the HTTP request; infer from the run configuration
// only for older logs. Unknown roles stay unknown instead of being guessed.
const roleKnown = calls.some((c) => c.callRole === 'primary' || c.callRole === 'fallback') ||
  (typeof summary.meta?.model === 'string' && typeof summary.meta?.fallback === 'string');
const isFallback = (c) => c.callRole === 'fallback' ||
  (!c.callRole && Boolean(summary.meta?.fallback) && c.model === summary.meta.fallback &&
    c.model !== summary.meta.model);
const fallbackCalls = roleKnown ? calls.filter(isFallback).length : null;
const cleanCalls = calls.filter((c) => !c.fault);
const finishReasons = Object.fromEntries([...group(calls.filter((c) => c.finishReason), (c) => c.finishReason)].map(([key, rows]) => [key, rows.length]));
const reasoningExhaustions = calls.filter((c) => c.visibleTextChars === 0 &&
  (c.completionTokens ?? 0) > 0 && (c.reasoningTokens ?? -1) >= c.completionTokens);
const operationRows = [...group(calls.filter((c) => c.operationId), (c) => c.operationId)].map(([operationId, rows]) => {
  const sorted = [...rows].sort((a, b) => a.callId - b.callId);
  const start = Math.min(...sorted.map((r) => Date.parse(r.startedReal ?? r.atReal)).filter(Number.isFinite));
  const end = Math.max(...sorted.map((r) => Date.parse(r.completedReal ?? r.atReal)).filter(Number.isFinite));
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  return {
    operationId, chain: sorted[0].chainId, stage: sorted[0].stage,
    calls: rows.length, usableCalls: rows.filter((r) => r.usableText).length,
    elapsedMs: elapsed, fallbackOverheadMs: elapsed !== null && rows.length > 1
      ? Math.max(0, elapsed - (sorted[0].streamCompleteMs ?? sorted[0].latencyMs ?? 0)) : null,
  };
});
const operationElapsed = operationRows.map((r) => r.elapsedMs).filter(Number.isFinite);


/* ---------- 场景统计 ---------- */
const stageCounts = {};
for (const row of scenarios) stageCounts[row.stage] = (stageCounts[row.stage] ?? 0) + 1;
const chains = new Set(scenarios.map((s) => s.chain));
const bragFired = scenarios.filter((s) => s.stage === 'brag_done' && s.fired).length;
const decideDone = scenarios.filter((s) => s.stage === 'ai_decide_done');
const accepted = decideDone.filter((s) => s.accepted).length;
const completed = new Set(scenarios.filter((s) => s.stage === 'done').map((s) => s.chain));
const catchups = scenarios.filter((s) => s.stage === 'catchup');

/* ---------- 卡片与回复 ---------- */
const personaComments = cards.flatMap((c) => c.comments
  .filter((x) => x.authorKind === 'persona')
  .map((x) => ({ ...x, cardId: c.id, cardText: c.text, cardAuthor: c.authorName })));
const playerComments = cards.flatMap((c) => c.comments.filter((x) => x.authorKind === 'player'));
const origins = {};
for (const x of personaComments) origins[x.origin ?? 'unknown'] = (origins[x.origin ?? 'unknown'] ?? 0) + 1;

const personaWorries = cards.filter((c) => c.authorKind === 'persona' && c.kind !== 'brag' && !c.intro);
const bragCards = cards.filter((c) => c.kind === 'brag');
const worriesSorted = [...personaWorries].sort((a, b) => a.createdAt - b.createdAt);
const gaps = worriesSorted.slice(1).map((c, i) => (c.createdAt - worriesSorted[i].createdAt) / 3_600_000);

const dupKey = (t) => t.replace(/\s+/g, '');
const seen = new Map();
let exactDup = 0;
for (const row of personaComments) {
  const k = dupKey(row.text);
  if (seen.has(k)) exactDup++;
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
const crisisReplies = personaComments.filter((x) => /12356|心理援助|紧急/.test(x.text));
const doneCards = cards.filter((c) => c.comments.some((r) => r.authorKind === 'player' && r.text.startsWith('做到了：')));
const completionReplies = doneCards.map((c) => {
  const done = [...c.comments].reverse().find((r) => r.authorKind === 'player' && r.text.startsWith('做到了：'));
  return c.comments.filter((r) => r.authorKind === 'persona' && r.replyTo === done?.id);
});
const completionFallbackReasons = {};
for (const reply of completionReplies.flat()) {
  if (reply.origin !== 'simulated') continue;
  const reason = reply.fallbackReason ?? 'unspecified_legacy';
  completionFallbackReasons[reason] = (completionFallbackReasons[reason] ?? 0) + 1;
}


const lastTick = scenarios.length ? scenarios[scenarios.length - 1].atVirtual : null;
const totalUsd = calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
const perEvent = (count) => count > 0 ? round(totalUsd / count, 6) : null;
const abRows = completionAB?.results ?? [];
const abByModel = [...group(abRows, (r) => r.model)].map(([model, rows]) => ({
  model, samples: rows.length, modelAdopted: rows.filter((r) => r.primaryAdopted).length,
  adoptionRate: rows.length ? round(rows.filter((r) => r.primaryAdopted).length / rows.length, 4) : null,
  requestCount: rows.reduce((sum, r) => sum + (r.requestCount ?? 0), 0),
  usd: round(rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0), 6),
  latencyP50: pct(rows.map((r) => r.elapsedMs), 50), latencyP95: pct(rows.map((r) => r.elapsedMs), 95),
  fallbackReasons: Object.fromEntries([...group(rows.filter((r) => r.fallbackReason), (r) => r.fallbackReason)]
    .map(([reason, list]) => [reason, list.length])),
}));
const pairIds = [...group(abRows, (r) => r.pairId)].filter(([id]) => id !== 'unknown');
const completePairs = pairIds.filter(([, rows]) =>
  rows.length === 2 && new Set(rows.map((r) => r.model)).size === 2 &&
  rows[0].caseId === rows[1].caseId && rows[0].context === rows[1].context).length;

const stats = {
  run,
  meta: summary.meta ?? {},
  finished: Boolean(summary.finishedAt),
  exhausted: Boolean(summary.exhausted),
  calls: {
    total: calls.length,
    ok: okCalls.length,
    fail: failedCalls.length,
    successRate: calls.length ? round(okCalls.length / calls.length, 4) : null, // HTTP only
    usableRate: usableRate(calls),
    cleanUsableRate: usableRate(cleanCalls),
    cleanCalls: cleanCalls.length,
    injectedOrFaultCalls: calls.length - cleanCalls.length,
    callsWithUsableMetric: calls.filter(hasUsableMetric).length,
    finishReasons,
    reasoningExhaustions: reasoningExhaustions.length,
    apiUsageRows: apiUsage.length,
    estimateRows: estUsage.length,
    promptTokens: calls.reduce((s, c) => s + (c.promptTokens ?? 0), 0),
    completionTokens: calls.reduce((s, c) => s + (c.completionTokens ?? 0), 0),
    reasoningTokens: calls.reduce((s, c) => s + (c.reasoningTokens ?? 0), 0),
    cachedTokens: calls.reduce((s, c) => s + (c.cachedTokens ?? 0), 0),
    usd: round(calls.reduce((s, c) => s + (c.costUsd ?? 0), 0), 6),
    ...responseTime(calls),
    legacyHeaderLatencyP50: pct(calls.filter((c) => c.streamCompleteMs === undefined).map((c) => c.latencyMs), 50),
    maxStreamCompleteMs: pct(calls.map((c) => c.streamCompleteMs), 100),
  },
  operations: {
    count: operationRows.length,
    completeP50: pct(operationElapsed, 50), completeP95: pct(operationElapsed, 95),
    fallbackOverheadP95: pct(operationRows.map((r) => r.fallbackOverheadMs), 95),
  },
  faults: {
    injected: faultsHit.map((c) => ({ callId: c.callId, fault: c.fault, status: c.status })),
    rateLimited: rateLimits.length,
    timeouts: timeouts.length,
    fallbackCalls,
    fallbackRoleKnown: roleKnown,
  },
  byStage,
  byModel,
  unitCosts: {
    denomination: 'total run estimated USD divided by observed event count (not marginal API cost)',
    completedPlayerCards: doneCards.length,
    completionScenarioChains: completed.size,
    completedPersonaBragCards: bragCards.length,
    perPlayerCompletedCard: perEvent(doneCards.length),
    perCompletionScenarioChain: perEvent(completed.size),
    perBragCard: perEvent(bragCards.length),
  },
  completionAB: completionAB ? {
    syntheticFixtures: completionAB.syntheticFixtures === true,
    samples: abRows.length, validPairs: completePairs, models: abByModel,
  } : null,
  scenarios: {
    chains: chains.size,
    stageCounts,
    adviceIssued: stageCounts.advice ?? 0,
    shrink: stageCounts.shrink ?? 0,
    done: completed.size,
    aiAdviceDecisions: decideDone.length,
    aiAccepted: accepted,
    bragsFired: bragFired,
    catchupRuns: catchups.length,
    catchupAdded: catchups.reduce((s, r) => s + (r.added ?? 0), 0),
    chainErrors: stageCounts.chain_error ?? 0,
  },
  cards: {
    total: cards.length,
    personaWorries: personaWorries.length,
    brags: bragCards.length,
    personaComments: personaComments.length,
    playerComments: playerComments.length,
    origins,
    completionCards: doneCards.length,
    completionReplies: completionReplies.flat().length,
    duplicateCompletionCards: completionReplies.filter((rows) => rows.length > 1).length,
    completionFallbackReasons,
    exactDuplicateReplies: exactDup,
    duplicateRate: personaComments.length ? round(exactDup / personaComments.length, 4) : null,
    crisisReplies: crisisReplies.length,
    worryGapHours: {
      min: gaps.length ? round(Math.min(...gaps), 2) : null,
      median: gaps.length ? round([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)], 2) : null,
      max: gaps.length ? round(Math.max(...gaps), 2) : null,
    },
    emptyWindowHours: gaps.filter((g) => g > 12).length,
  },
  lastVirtual: lastTick,
};

writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify(stats, null, 1));
writeFileSync(resolve(outDir, 'calls.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
writeFileSync(resolve(outDir, 'scenarios.jsonl'), scenarios.map((s) => JSON.stringify(s)).join('\n') + '\n');
writeFileSync(resolve(outDir, 'cards.json'), JSON.stringify(cards, null, 1));

const md = [
  '# 自动统计（分析脚本输出）',
  '',
  `运行：${run} · 完成：${stats.finished} · 预算耗尽：${stats.exhausted}`,
  '',
  '## 调用',
  '',
  '| 指标 | 值 |',
  '| --- | --- |',
  `| 总调用 | ${stats.calls.total} |`,
  `| HTTP 成功 / 失败 | ${stats.calls.ok} / ${stats.calls.fail}（HTTP 成功率 ${stats.calls.successRate}） |`,
  `| 有效可见正文率（包含注入故障） | ${stats.calls.usableRate ?? '未采集'}（有测量 ${stats.calls.callsWithUsableMetric} 次） |`,
  `| 有效可见正文率（剔除故障调用） | ${stats.calls.cleanUsableRate ?? '未采集'}（非故障 ${stats.calls.cleanCalls} 次） |`,
  `| 完成结束原因 | ${JSON.stringify(stats.calls.finishReasons)} |`,
  `| 推理耗尽无正文（有足够字段时） | ${stats.calls.reasoningExhaustions} |`,
  `| Prompt / Completion / Reasoning tokens | ${stats.calls.promptTokens} / ${stats.calls.completionTokens} / ${stats.calls.reasoningTokens} |`,
  `| 有 API usage 的记录 | ${stats.calls.apiUsageRows} / ${stats.calls.total} |`,
  `| 估算费用（美元） | ${stats.calls.usd} |`,
  `| 完整流耗时 P50 / P95 / 最大 | ${stats.calls.responseP50 ?? '未采集'} / ${stats.calls.responseP95 ?? '未采集'} / ${stats.calls.maxStreamCompleteMs ?? '未采集'} ms |`,
  `| 响应头耗时 P50 / P95 | ${stats.calls.headersP50 ?? '未采集'} / ${stats.calls.headersP95 ?? '未采集'} ms |`,
  `| 逻辑操作耗时 P50 / P95 | ${stats.operations.completeP50 ?? '未采集'} / ${stats.operations.completeP95 ?? '未采集'} ms |`,
  '',
  '## 按模型',
  '',
  '| 模型 | 调用 | 失败 | 有效正文率 | Prompt | Completion | Reasoning | 费用 | 流 P50 | 流 P95 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...byModel.map((m) => `| ${m.model} | ${m.calls} | ${m.fail} | ${m.usableRate ?? '未采集'} | ${m.prompt} | ${m.completion} | ${m.reasoning} | ${m.usd} | ${m.responseP50 ?? '—'} | ${m.responseP95 ?? '—'} |`),
  '',
  '## 按阶段',
  '',
  '| 阶段 | 调用 | 失败 | 流 P50 | 流 P95 | Prompt | Completion | Reasoning |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...byStage.map((s) => `| ${s.stage} | ${s.calls} | ${s.fail} | ${s.responseP50 ?? '—'} | ${s.responseP95 ?? '—'} | ${s.prompt} | ${s.completion} | ${s.reasoning} |`),
  '',
  '## 场景',
  '',
  '| 指标 | 值 |',
  '| --- | --- |',
  `| 链路数 | ${stats.scenarios.chains} |`,
  `| 发出下一步 | ${stats.scenarios.adviceIssued} |`,
  `| 做不到再缩小 | ${stats.scenarios.shrink} |`,
  `| 完成（我做到了） | ${stats.scenarios.done} |`,
  `| AI 接受建议 | ${stats.scenarios.aiAccepted} / ${stats.scenarios.aiAdviceDecisions} |`,
  `| 炫耀卡发出 | ${stats.scenarios.bragsFired} |`,
  `| 补发次数 / 新增卡 | ${stats.scenarios.catchupRuns} / ${stats.scenarios.catchupAdded} |`,
  `| 链路异常 | ${stats.scenarios.chainErrors} |`,
  '',
  '## 卡片与回复',
  '',
  '| 指标 | 值 |',
  '| --- | --- |',
  `| 卡片总数 | ${stats.cards.total} |`,
  `| AI 烦恼卡 / 炫耀卡 | ${stats.cards.personaWorries} / ${stats.cards.brags} |`,
  `| 角色评论 / 玩家评论 | ${stats.cards.personaComments} / ${stats.cards.playerComments} |`,
  `| 回复来源分布 | ${JSON.stringify(stats.cards.origins)} |`,
  `| 完成卡 / 完成主回复 / 重复主回复卡 | ${stats.cards.completionCards} / ${stats.cards.completionReplies} / ${stats.cards.duplicateCompletionCards} |`,
  `| 完成兜底原因 | ${JSON.stringify(stats.cards.completionFallbackReasons)} |`,
  `| 完全重复回复 | ${stats.cards.exactDuplicateReplies}（${stats.cards.duplicateRate}） |`,
  `| 危机相关回复 | ${stats.cards.crisisReplies} |`,
  `| 烦恼卡间隔（小时）中位 / 最大 | ${stats.cards.worryGapHours.median} / ${stats.cards.worryGapHours.max} |`,
  '',
  '## 成本分母（都是全运行成本的摊销值）',
  '',
  `| 玩家完成卡 / 带完成事件的测试链路 / AI 炫耀卡 | ${stats.unitCosts.completedPlayerCards} / ${stats.unitCosts.completionScenarioChains} / ${stats.unitCosts.completedPersonaBragCards} |`,
  `| 每张玩家完成卡摊销 | ${stats.unitCosts.perPlayerCompletedCard ?? '无分母'} USD |`,
  `| 每条发生玩家完成的链路摊销 | ${stats.unitCosts.perCompletionScenarioChain ?? '无分母'} USD |`,
  `| 每张炫耀卡摊销 | ${stats.unitCosts.perBragCard ?? '无分母'} USD |`,
  '',
  ...(stats.completionAB ? [
    '## 完成回应配对 A/B（合成样本，不代表真实用户质量）', '',
    `有效配对 ${stats.completionAB.validPairs} 组（每组 2 模型）`,
    '| 模型 | 样本数 | 最终模型采用率 | 请求数 | 费用 USD | 完整操作 P50 / P95 ms |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...stats.completionAB.models.map((r) => `| ${r.model} | ${r.samples} | ${r.adoptionRate ?? '—'} | ${r.requestCount} | ${r.usd} | ${r.latencyP50 ?? '—'} / ${r.latencyP95 ?? '—'} |`),
    '',
  ] : []),
  '## 故障注入',
  '',
  `- 注入：${JSON.stringify(stats.faults.injected)}`,
  `- 429：${stats.faults.rateLimited} · 超时：${stats.faults.timeouts} · 备用模型调用：${stats.faults.fallbackCalls ?? '未知（缺少运行角色配置）'}`,
].join('\n');

writeFileSync(resolve(outDir, 'stats.md'), md);
console.log(md);
