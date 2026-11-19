import type { Card, Persona, PlannedArrival } from '../types';
import { containsCrisis } from './submissionGuard';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { isManipulative } from './agentVulnerability';

export interface PeerReactionPlan { personaId: string; at: number; phase: 'arrival' }
const MIN = 60_000;
const BANNED = /加油|下次一定|你应该|别难过|至少你|继续冲|再来一个|必须|赶紧|一定能|别放弃/;
const hash = (value: string): number => [...value].reduce((h, ch) => (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0, 5381);

export function isGoalResultCard(card: Card): boolean {
  return Boolean(card.goalId) && card.origin === 'simulated' && card.authorKind === 'persona' &&
    (card.kind === 'brag' || card.kind === 'worry') && !containsCrisis([card.text, card.title ?? '']);
}
export function existingPeerCount(card: Card): number {
  if (!isGoalResultCard(card)) return 0;
  return new Set(card.comments.filter(c => c.authorKind === 'persona' && c.authorId !== card.authorId)
    .map(c => c.authorId)).size;
}

/** Deterministic 1..2 different peers and genuine wall-clock 1..4 minute deadlines. */
export function planPeerReactions(card: Card, personas: readonly Persona[], now: number,
  options: { max?: 1 | 2; delayMinMs?: number } = {}): PeerReactionPlan[] {
  if (!isGoalResultCard(card) || !Number.isFinite(now) || existingPeerCount(card) > 0) return [];
  const unique = new Map(personas.filter(p => p.id !== card.authorId && p.id !== 'me').map(p => [p.id, p]));
  const ranked = [...unique.values()].sort((a, b) => hash(`${card.id}:${a.id}`) - hash(`${card.id}:${b.id}`) || a.id.localeCompare(b.id));
  const total = Math.min(ranked.length, options.max ?? (card.kind === 'worry' ? 1 : 1 + hash(card.id) % 2), 2);
  const firstDelay = Math.max(MIN, Math.min(4 * MIN, options.delayMinMs ?? MIN));
  // Finish a scheduled arrival by minute 4; leave time for a 60s poll and a 12s model timeout.
  const windowMs = Math.max(1, 4 * MIN - firstDelay + 1);
  return ranked.slice(0, total).map(p => ({personaId:p.id, at:now + firstDelay + hash(`${card.id}:${p.id}:delay`) % windowMs, phase:'arrival'}));
}

/** Imported queues are untrusted: reject arbitrary peers, stale/early times and duplicates. */
export function validPeerPlans(card: Card, personas: readonly Persona[]): PlannedArrival[] {
  if (!isGoalResultCard(card) || existingPeerCount(card) > 0) return [];
  const allowed = new Set(personas.map(p => p.id).filter(id => id !== card.authorId && id !== 'me'));
  const seen = new Set<string>();
  return card.plan.filter(item => {
    if (item.phase !== 'arrival' || !allowed.has(item.personaId) || seen.has(item.personaId) ||
        card.arrivals.includes(item.personaId) || !Number.isFinite(item.at) ||
        item.at < card.createdAt + MIN || item.at > card.createdAt + 6 * MIN) return false;
    seen.add(item.personaId);
    return true;
  }).slice(0, 2);
}

const BRAG_LINES: Record<string, string> = {
  shenmo: '看到你真的把这一步做完了，挺替你高兴的。先好好歇一歇，今天已经有进展了。',
  weini: '嗯……看到这里真的有点替你开心。把这一小步做出来就很好，不用再证明什么。',
  miaoze: '从计划到实际完成，中间那一步最难。现在有了结果，这个进展值得记一下。',
  yanggao: '哇！你是真把它做出来了啊！我先替你高兴一下，今天这一步值得纪念。',
};
const MISSED_LINES: Record<string, string> = {
  shenmo: '没做完也有很累的时候。看你已经把情况写清楚了，今天先停在这里也没关系。',
  weini: '嗯……没做完会有点闷吧。你愿意把实际情况说出来就很好，先不用急着解释。',
  miaoze: '计划和实际有偏差，不等于这一整天都作废了。先记着这个结果就可以。',
  yanggao: '哎呀，今天没做完就是没做完嘛。先把这口气缓一缓，不用现在就交新计划。',
};
export function peerReactionFallback(card: Card, persona: Persona): string {
  return (card.kind === 'brag' ? BRAG_LINES : MISSED_LINES)[persona.id] ??
    (card.kind === 'brag'
      ? '看见你真的把这一小步完成了，这份进展值得记下来，也值得好好歇一下。'
      : '没完成也可以如实记下来。这不是要交给谁的作业，先不用逼自己解释。');
}
export function isSafePeerReaction(card: Card, text: string): boolean {
  const count = [...text.trim()].length;
  return isGoalResultCard(card) && count >= 20 && count <= 50 && !BANNED.test(text) &&
    !containsCrisis([text]) && !isManipulative(text) && !auditTone(text) && !auditSocial(text) && !auditCriticalContent(text);
}

/** Offline fallback for when API is missing/over quota. Never schedules follow-up jobs. */
export function settlePeerReactionsLocally(cards: readonly Card[], personas: readonly Persona[], now: number): { cards: Card[]; settled: number } {
  let settled = 0;
  const rows = cards.map(card => {
    if (!isGoalResultCard(card) || card.status === 'handled' || card.status === 'done') return card;
    const plan = validPeerPlans(card, personas);
    if (!plan.length) return card;
    const due = plan.find(row => row.at <= now);
    if (!due) return card;
    const author = personas.find(p => p.id === due.personaId);
    if (!author) return card;
    settled++;
    return {
      ...card,
      plan: [],
      arrivals: [...new Set([...card.arrivals, author.id])],
      comments: [...card.comments, {
        id: crypto.randomUUID(), authorId: author.id, authorKind: 'persona' as const,
        at:now, text:peerReactionFallback(card, author), origin:'curated' as const,
      }],
    };
  });
  return { cards: settled ? rows : [...cards], settled };
}
