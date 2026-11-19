#!/usr/bin/env node
/** Pull displayed suggestions from one soak run for manual review.
 * Usage: node scripts/extract-run-suggestions.mjs <runId> [limit=24] [out=exports/<run>-suggestions.csv]
 * Writes card text + the suggestion actually shown. Ratings are left blank for a human;
 * an AI first pass belongs in a separate file and must be labelled as such.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const run = process.argv[2] ?? 'nr60a';
const limit = Math.max(1, Math.min(60, Number(process.argv[3] ?? 24)));
const out = resolve(process.argv[4] ?? `exports/${run}-suggestions.csv`);
const cardsPath = resolve('.soak-data', `${run}-cards.json`);
if (!existsSync(cardsPath)) {
  console.error(`missing ${cardsPath}; run the soak first`);
  process.exit(1);
}
const cards = JSON.parse(readFileSync(cardsPath, 'utf8'));
const rows = [];
for (const card of cards) {
  if (card.authorId !== 'me') continue;
  const fromAdvice = card.advice?.text ? {
    text: card.advice.text, actionId: card.advice.actionId ?? '', persona: card.advice.fromPersonaId ?? '',
    origin: 'advice', accepted: Boolean(card.advice.accepted),
  } : null;
  const fromComment = [...(card.comments ?? [])].reverse().find((c) =>
    c.authorKind === 'persona' && (c.kind === 'advice' || c.origin === 'curated'));
  const picked = fromAdvice ?? (fromComment ? {
    text: fromComment.text, actionId: fromComment.actionId ?? '', persona: fromComment.authorId ?? '',
    origin: fromComment.origin ?? 'comment', accepted: false,
  } : null);
  if (!picked?.text) continue;
  rows.push({
    cardId: card.id, cardText: (card.text ?? '').replace(/\s+/g, ' ').slice(0, 160),
    persona: picked.persona, suggestion: picked.text.replace(/\s+/g, ' ').slice(0, 120),
    actionId: picked.actionId, origin: picked.origin, accepted: picked.accepted ? 1 : 0,
  });
}
// Deterministic spread across the run instead of the first N.
const step = Math.max(1, Math.floor(rows.length / limit));
const sample = rows.filter((_, i) => i % step === 0).slice(0, limit);
const csv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const header = ['cardId', 'cardText', 'persona', 'actionId', 'origin', 'accepted', 'suggestion',
  'manualWrong_0_or_1', 'reviewerNote'];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [header.join(','),
  ...sample.map((r) => header.map((k) => csv(r[k] ?? '')).join(','))].join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ run, candidates: rows.length, sampled: sample.length, out }, null, 2));
