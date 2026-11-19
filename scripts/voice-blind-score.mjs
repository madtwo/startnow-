#!/usr/bin/env node
/** Score blind persona guesses against the hidden mapping.
 * Usage: node scripts/voice-blind-score.mjs <mapping.json> <guesses.json>
 */
import { readFileSync } from 'node:fs';

const mappingPath = process.argv[2];
const guessPath = process.argv[3];
if (!mappingPath || !guessPath) {
  console.error('usage: node scripts/voice-blind-score.mjs <mapping.json> <guesses.json>');
  process.exit(2);
}
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
const guessRaw = JSON.parse(readFileSync(guessPath, 'utf8'));
const guesses = Array.isArray(guessRaw) ? guessRaw : guessRaw.guesses ?? [];
const byId = new Map(mapping.map((row) => [row.id, row]));
const personas = ['shenmo', 'weini', 'miaoze', 'yanggao'];

let correct = 0;
const byKind = { post: { n: 0, ok: 0 }, reply: { n: 0, ok: 0 } };
const confusion = Object.fromEntries(personas.map((p) => [p, Object.fromEntries(personas.map((q) => [q, 0]))]));
const misses = [];
for (const guess of guesses) {
  const truth = byId.get(guess.id);
  if (!truth || !personas.includes(guess.personaId)) continue;
  byKind[truth.kind].n++;
  confusion[truth.personaId][guess.personaId]++;
  if (guess.personaId === truth.personaId) {
    correct++;
    byKind[truth.kind].ok++;
  } else {
    misses.push({ id: guess.id, kind: truth.kind, truth: truth.personaId, guess: guess.personaId, reason: guess.reason });
  }
}
const total = guesses.filter((g) => byId.has(g.id)).length;
const pct = (ok, n) => (n ? +(ok / n).toFixed(4) : null);
const report = {
  total, correct, accuracy: pct(correct, total),
  post: { ...byKind.post, accuracy: pct(byKind.post.ok, byKind.post.n) },
  reply: { ...byKind.reply, accuracy: pct(byKind.reply.ok, byKind.reply.n) },
  perPersona: Object.fromEntries(personas.map((p) => {
    const row = confusion[p];
    const n = Object.values(row).reduce((a, b) => a + b, 0);
    return [p, { n, correct: row[p], recall: pct(row[p], n) }];
  })),
  confusion, misses,
  pass: total >= 40 && correct / Math.max(1, total) >= 0.8,
};
console.log(JSON.stringify(report, null, 2));
