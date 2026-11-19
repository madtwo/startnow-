/** 把落盘的 JSONL 导出为 CSV，便于用表格查看。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'startnow-realapi-longrun-2026-11-18', 'data');
const run = process.argv[2] ?? 'a1';

const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => {
  const v = r[c];
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(','))].join('\n');

const readJsonl = (name) => {
  const p = resolve(dir, name);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

const calls = readJsonl('calls.jsonl');
writeFileSync(resolve(dir, 'calls.csv'), csv(calls, [
  'callId', 'chainId', 'stage', 'persona', 'model', 'ok', 'status', 'fault', 'error',
  'latencyMs', 'usageSource', 'promptTokens', 'completionTokens', 'cachedTokens',
  'reasoningTokens', 'costUsd', 'inChars', 'outChars', 'atVirtual', 'atReal',
]));

const scenarios = readJsonl('scenarios.jsonl');
writeFileSync(resolve(dir, 'scenarios.csv'), csv(scenarios, [
  'chain', 'atVirtual', 'stage', 'ok', 'text', 'actionId', 'accepted', 'pendingBrag',
  'fired', 'hours', 'added', 'minutes', 'cards', 'error',
]));

console.log(`calls=${calls.length} scenarios=${scenarios.length}`);
