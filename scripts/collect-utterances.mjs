/** 把多轮长流程的卡片与评论整理成统一表格：每条发言的说话人、场景、回复对象、来源与时间。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '.soak-data');
const outDir = resolve(process.cwd(), 'startnow-realapi-longrun-2026-11-18', 'data');
mkdirSync(outDir, { recursive: true });

const runs = [
  { id: 'a2', primary: 'hy4-flash-free', fallback: 'deepseek-v4.1-flash' },
  { id: 'a3', primary: 'hy4-flash-free', fallback: 'deepseek-v4.1-flash' },
  { id: 'd1', primary: 'deepseek-v4.1-flash', fallback: '（关闭）' },
];

const readJson = (name, fallback) => {
  const p = resolve(root, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
};
const readJsonl = (name) => {
  const p = resolve(root, name);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
};

const rows = [];
const summaries = [];

for (const run of runs) {
  const cards = readJson(`${run.id}-cards.json`, []);
  if (!cards.length) {
    summaries.push({ run: run.id, cards: 0, notes: '数据缺失' });
    continue;
  }
  const scenarios = readJsonl(`${run.id}-scenarios.jsonl`);
  const chainText = new Map();
  const chainStage = new Map();
  for (const s of scenarios) {
    if (s.stage === 'player_post' && s.text) chainText.set(s.chain, s.text);
    chainStage.set(s.chain, s); // 最新一步，仅作时间参照
  }

  let comments = 0;
  for (const card of cards) {
    const byId = new Map(card.comments.map((c) => [c.id, c]));
    for (const [index, c] of card.comments.entries()) {
      comments++;
      const replied = c.replyTo ? byId.get(c.replyTo) : undefined;
      const addressedPeer = c.authorKind === 'player' && c.peer
        ? (card.authorId === c.peer ? '楼主' : c.peer)
        : '';
      rows.push({
        run: run.id,
        primary_model: run.primary,
        fallback_model: run.fallback,
        card_id: card.id,
        card_kind: card.kind ?? 'worry',
        card_intro: card.intro ? 'yes' : '',
        card_author_id: card.authorId,
        card_author: card.authorName,
        card_text: card.text,
        comment_index: index,
        author_id: c.authorId,
        author: c.authorName ?? c.authorId,
        author_kind: c.authorKind,
        origin: c.origin ?? '',
        fallback_reason: c.fallbackReason ?? '',
        reply_to_id: c.replyTo ?? '',
        reply_to_author: replied ? (replied.authorName ?? replied.authorId) : '',
        replied_to_player: replied?.authorKind === 'player' ? 'yes' : '',
        player_addressed_peer: addressedPeer,
        kind: c.kind ?? '',
        text: c.text,
        at_virtual: new Date(c.at).toISOString(),
        at_epoch: c.at,
        scenario_user_text: chainText.get(card.chain ?? '') ?? '',
      });
    }
  }
  summaries.push({
    run: run.id,
    primary: run.primary,
    fallback: run.fallback,
    cards: cards.length,
    comments,
    model: rows.filter((r) => r.run === run.id && r.origin === 'model').length,
    simulated: rows.filter((r) => r.run === run.id && r.origin === 'simulated').length,
    curated: rows.filter((r) => r.run === run.id && r.origin === 'curated').length,
    boundary: rows.filter((r) => r.run === run.id && r.origin === 'boundary').length,
  });
}

const cols = [
  'run', 'primary_model', 'fallback_model', 'card_id', 'card_kind', 'card_intro',
  'card_author_id', 'card_author', 'card_text', 'comment_index', 'author_id', 'author',
  'author_kind', 'origin', 'fallback_reason', 'reply_to_id', 'reply_to_author',
  'replied_to_player', 'player_addressed_peer', 'kind', 'text', 'at_virtual', 'at_epoch',
  'scenario_user_text',
];
const esc = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');

writeFileSync(resolve(outDir, 'utterances-all.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(resolve(outDir, 'utterances-all.csv'), csv);
writeFileSync(resolve(outDir, 'utterances-summary.json'), JSON.stringify(summaries, null, 1));
console.table(summaries);
console.log(`utterances: ${rows.length} rows -> data/utterances-all.csv`);
