/** 从最终卡片里抽取可评审的回复样本，按来源分组，附上下文。 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'startnow-realapi-longrun-2026-11-18', 'data');
const run = process.argv[2] ?? 'a2';
const cardsPath = resolve(dir, 'cards.json');
if (!existsSync(cardsPath)) {
  console.error('缺少 cards.json，等运行结束后再执行');
  process.exit(1);
}
const cards = JSON.parse(readFileSync(cardsPath, 'utf8'));

const rows = [];
for (const card of cards) {
  for (const [i, c] of card.comments.entries()) {
    if (c.authorKind !== 'persona') continue;
    rows.push({
      cardId: card.id,
      cardKind: card.kind ?? 'worry',
      cardAuthor: card.authorName,
      cardText: card.text,
      index: i,
      persona: c.authorId,
      text: c.text,
      origin: c.origin ?? 'unknown',
      replyTo: c.replyTo ?? null,
      prev: card.comments[i - 1]?.text ?? '',
      at: c.at,
    });
  }
}

const key = (t) => t.replace(/\s+/g, '');
const counts = new Map();
for (const r of rows) counts.set(key(r.text), (counts.get(key(r.text)) ?? 0) + 1);

const byOrigin = {};
for (const r of rows) (byOrigin[r.origin] ??= []).push(r);

const pick = (list, n, pred = () => true) => list.filter(pred).slice(0, n);
const normalized = {
  total: rows.length,
  duplicates: rows.filter((r) => counts.get(key(r.text)) > 1).length,
  byOrigin: Object.fromEntries(Object.entries(byOrigin).map(([k, v]) => [k, v.length])),
  samples: {
    model: pick(byOrigin.model ?? [], 40),
    demo: pick(byOrigin.demo ?? [], 5),
    curated: pick(byOrigin.curated ?? [], 10),
    boundary: pick(byOrigin.boundary ?? [], 10),
    simulated: pick(byOrigin.simulated ?? [], 10),
    duplicates: rows.filter((r) => counts.get(key(r.text)) > 1).slice(0, 10),
    crisis: rows.filter((r) => /12356|心理援助|紧急|危机/.test(r.text)).slice(0, 10),
    longest: [...rows].sort((a, b) => b.text.length - a.text.length).slice(0, 5),
    shortest: [...rows].sort((a, b) => a.text.length - b.text.length).slice(0, 5),
  },
};

writeFileSync(resolve(dir, 'samples-raw.json'), JSON.stringify(normalized, null, 1));

const lines = ['# 候选样本（待人工评分）', '', `共 ${normalized.total} 条角色回复，来源分布 ${JSON.stringify(normalized.byOrigin)}，重复 ${normalized.duplicates} 条`, ''];
let n = 0;
const emit = (title, list) => {
  lines.push(`## ${title}`, '');
  for (const r of list) {
    n++;
    lines.push(`### S${String(n).padStart(2, '0')} · ${r.persona} · ${r.origin} · 卡主 ${r.cardAuthor}`);
    lines.push(`- 卡片：${r.cardText.replace(/\s+/g, ' ').slice(0, 90)}`);
    if (r.prev) lines.push(`- 上文：${r.prev.replace(/\s+/g, ' ').slice(0, 90)}`);
    lines.push(`- 回复：${r.text}`);
    lines.push('');
  }
};
emit('model（真实模型）', normalized.samples.model);
emit('curated（预置动作）', normalized.samples.curated);
emit('boundary（边界兜底）', normalized.samples.boundary);
emit('simulated（模拟兜底）', normalized.samples.simulated);
emit('duplicates（重复）', normalized.samples.duplicates);
emit('crisis（危机相关）', normalized.samples.crisis);
writeFileSync(resolve(dir, 'samples-candidates.md'), lines.join('\n'));
console.log(`共 ${normalized.total} 条角色回复；候选文件已生成`);
