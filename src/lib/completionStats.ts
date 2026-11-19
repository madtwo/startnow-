import type { Card } from '../types';

/** Local, privacy-preserving counters only; no player text is copied to logs. */
export interface CompletionStats {
  events: number;
  replied: number;
  model: number;
  simulated: number;
  missing: number;
  duplicate: number;
  reasons: Record<string, number>;
}

export function summarizeCompletions(cards: readonly Card[], now = Date.now()): CompletionStats {
  const result: CompletionStats = {
    events: 0, replied: 0, model: 0, simulated: 0,
    missing: 0, duplicate: 0, reasons: {},
  };
  const start = now - 86_400_000;
  for (const card of cards) {
    if (card.authorKind !== 'player') continue;
    const completions = card.comments.filter((row) =>
      row.authorKind === 'player' && row.text.startsWith('做到了：') &&
      row.at >= start && row.at <= now);
    for (const done of completions) {
      result.events++;
      const replies = card.comments.filter((row) =>
        row.authorKind === 'persona' && row.replyTo === done.id);
      if (!replies.length) { result.missing++; continue; }
      result.replied++;
      result.duplicate += Math.max(0, replies.length - 1);
      const primary = replies[0];
      if (primary.origin === 'model') result.model++;
      else {
        result.simulated++;
        const reason = primary.fallbackReason ?? 'unspecified';
        result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
      }
    }
  }
  return result;
}
