/** 预置建议的语义重复与主题贴合审计（无 API）。输出材料给人工盲评。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const run = process.argv[2] ?? 'e1';
const root = resolve(process.cwd(), '.soak-data');
const cardsPath = resolve(root, `${run}-cards.json`);
if (!existsSync(cardsPath)) {
  console.error(`缺少 ${cardsPath}，等运行结束后再执行`);
  process.exit(1);
}
const cards = JSON.parse(readFileSync(cardsPath, 'utf8'));

const normalize = (t) => t.replace(/[\s，,。.!！?？；;：:、~～「」『』（）()【】\[\]—\-]/g, '');
const bigrams = (t) => {
  const s = normalize(t);
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};
const jaccard = (a, b) => {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

const adviceRows = [];
for (const card of cards) {
  const advice = card.advice;
  if (advice?.text) {
    adviceRows.push({
      cardId: card.id,
      cardKind: card.kind ?? 'worry',
      cardText: card.text,
      adviceText: advice.text,
      actionId: advice.actionId ?? '',
      origin: 'advice',
      at: advice.at,
    });
  }
  for (const c of card.comments) {
    if (c.authorKind === 'persona' && c.origin === 'curated' && c.text) {
      adviceRows.push({
        cardId: card.id,
        cardKind: card.kind ?? 'worry',
        cardText: card.text,
        adviceText: c.text,
        actionId: '',
        origin: 'curated-comment',
        at: c.at,
      });
    }
  }
}

// 语义近似聚类（bigram Jaccard >= 0.72 视为同一表达）
const clusters = [];
for (const row of adviceRows) {
  const hit = clusters.find((cl) => cl.rows.some((r) => jaccard(r.adviceText, row.adviceText) >= 0.72));
  if (hit) hit.rows.push(row);
  else clusters.push({ rows: [row] });
}
const repeated = clusters.filter((cl) => cl.rows.length > 1);
const semanticDupRows = repeated.reduce((sum, cl) => sum + cl.rows.length - 1, 0);

const report = {
  run,
  totalAdviceRows: adviceRows.length,
  clusters: clusters.length,
  semanticDuplicateRows: semanticDupRows,
  semanticRepeatRate: adviceRows.length ? Number((semanticDupRows / adviceRows.length).toFixed(4)) : 0,
  clustersRepeated: repeated.map((cl) => ({
    count: cl.rows.length,
    text: cl.rows[0].adviceText,
    cards: cl.rows.map((r) => r.cardText.slice(0, 40)),
  })),
  rows: adviceRows,
};
writeFileSync(resolve(root, `${run}-curated-audit.json`), JSON.stringify(report, null, 1));

// 人工盲评用：抽 24 条（尽量覆盖不同场景），带上卡片原文，供逐条打"贴题/一般/错配"
const sample = [...adviceRows]
  .sort((a, b) => (a.actionId || a.adviceText).localeCompare(b.actionId || b.adviceText))
  .filter((row, index, arr) => arr.findIndex((x) => x.adviceText === row.adviceText) === index)
  .slice(0, 24);
const md = [
  `# 预置建议人工盲评（${run}）`,
  '',
  '评分：**贴题 / 一般 / 错配**。标准：动作是否直接针对卡片里说的事，且现在就能做、不需要额外条件。',
  '',
  '| # | 卡片原文 | 建议 | 判定 | 备注 |',
  '| --- | --- | --- | --- | --- |',
  ...sample.map((row, i) => `| ${i + 1} | ${row.cardText.replace(/\s+/g, ' ').slice(0, 48)} | ${row.adviceText.replace(/\s+/g, ' ')} |  |  |`),
  '',
];
writeFileSync(resolve(root, `${run}-curated-blind-audit.md`), md.join('\n'));
console.log(JSON.stringify({
  run,
  totalAdviceRows: report.totalAdviceRows,
  semanticRepeatRate: report.semanticRepeatRate,
  semanticDuplicateRows: report.semanticDuplicateRows,
  clusters: report.clusters,
  repeatedClusters: report.clustersRepeated.length,
}, null, 1));
