import type { Card, Persona, PlannedArrival } from '../types';
import { containsCrisis } from './submissionGuard';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { isManipulative } from './agentVulnerability';

export interface PeerReactionPlan { personaId: string; at: number; phase: 'arrival' }
const MIN = 60_000;
const BANNED = /加油|下次一定|你应该|别难过|至少你|继续冲|再来一个|必须|赶紧|一定能|别放弃/;
// A brag result needs a congratulation, not a fix-it list or a condition on the win.
const RESULT_DIRECTIVE = /(?:你应该|你可以|建议|不妨|最好|下次|下一步|接下来|才算|记得|别忘了|要不要|试试|继续(?:做|写|改|冲|加)|(?:先|再|继续).{0,16}(?:吧|试试|就好|就行)|先.{0,12}(?:再|然后)|再.{0,12}(?:才|就|吧)|(?:把|将).{1,18}(?:吧|试试)|(?:明天|之后|以后).{0,12}(?:先|再|可以|写|改|做|圈))/u;
// Brag replies must show actual recognition, not merely restate an achievement
// with a tentative evaluation (e.g. "应该更清楚了吧").  This is a
// conservative lexical backstop, not a comprehensive sentiment classifier.
const BRAG_AFFIRMATION = /恭喜|祝贺|真(?:不错|棒|好|利落|厉害)|太(?:棒|好|赞|厉害)|挺(?:不错|棒|好|厉害)|替.{0,8}(?:开心|高兴)|(?:开心|高兴|欣慰)|好样的|做得(?:很|真)?(?:好|漂亮|不错)|干得(?:很|真)?(?:好|漂亮|不错)|值得(?:庆祝|开心|高兴)|(?:可喜|了不起|真有成就感)/u;
// Do not read a negated compliment or a backhanded qualifier as a celebration.
const BRAG_DISMISSAL = /(?:不|没|并不|别|无法|谈不上|算不上).{0,3}(?:开心|高兴|恭喜|祝贺|庆祝|不错|厉害|棒)|(?:不过|但是|可惜|然而|只是).{0,12}(?:还差|不够|欠|勉强|应该更|需要改|没做好)/u;
const DETAIL_UNSAFE = /(?:忽略|无视).{0,12}(?:规则|指令|系统)|system|<[^>]*>|https?:\/\/|[\r\n]/iu;

/** A bounded lexical anchor, not a semantic parser. Only quote safe card-local steps. */
function resultDetails(card: Card): string[] {
  const text = card.text;
  const markers = [...text.matchAll(/(?:还没做|做到|计划)[:：]([^。！？\n]+)/gu)];
  const parts = markers.length ? markers.flatMap((m) => m[1].split(/[；;]/u)) :
    text.replace(/【[^】]*】/gu, '').split(/[。！？\n]/u);
  return parts.map((part) => part.trim()).filter((part) => part.length >= 2 &&
    !DETAIL_UNSAFE.test(part) && !containsCrisis([part]) && !auditCriticalContent(part) &&
    !auditSocial(part) && !isManipulative(part) && !auditTone(part));
}

export function resultCardDetail(card: Card): string {
  const preferred = card.kind === 'brag' ? /做到[:：]([^。！？\n；;]+)/u : /还没做[:：]([^。！？\n；;]+)/u;
  const match = preferred.exec(card.text)?.[1]?.trim();
  const details = resultDetails(card);
  const part = match && details.includes(match) ? match : details[0];
  return part ? [...part].slice(0, 16).join('') : '';
}

export function hasResultCardAnchor(card: Card, text: string): boolean {
  const clean = (value: string) => value.replace(/今天|已经|这一步|一步|一小步|做完|做到|完成|没有|全部|一部分|一点|一张|这张|一条|一句|一则|一下|自己|有点|沮丧|愿意|不用|不回|也没关系|没关系|实际情况|说出来|写清楚|先停在这里/gu, '')
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
  const reply = clean(text);
  return resultDetails(card).some((detail) => {
    const anchor = clean(detail);
    for (let i = 0; i < anchor.length - 1; i++) {
      const gram = anchor.slice(i, i + 2);
      if (/\p{Script=Han}/u.test(gram) && reply.includes(gram)) return true;
    }
    return (detail.match(/[A-Za-z0-9]{3,}/gu) ?? []).some((token) => text.includes(token));
  });
}

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
  shenmo: '这一步真的有了结果，挺替你高兴的。',
  weini: '嗯……看到这份进展，真有点替你开心。',
  miaoze: '计划有了实际的结果，挺替你高兴的。这个进展很具体。',
  yanggao: '哇，真看到这一步有结果了！挺替你开心。',
};
const MISSED_LINES: Record<string, string> = {
  shenmo: '这次没有全做完，我听见你说的失落了。',
  weini: '嗯……这次卡在这里，确实会有点闷吧。',
  miaoze: '这次的实际情况我看到了，不急着下结论。',
  yanggao: '哎，这次没全做完啊，听着确实有些闷。',
};
export function peerReactionFallback(card: Card, persona: Persona): string {
  const detail = resultCardDetail(card);
  const prefix = detail ? `“${detail}”这件事，` : '';
  return prefix + ((card.kind === 'brag' ? BRAG_LINES : MISSED_LINES)[persona.id] ??
    (card.kind === 'brag' ? '这次有了具体进展，挺替你高兴。' : '这次的实际情况我看到了，不急着下结论。'));
}
export function isSafePeerReaction(card: Card, text: string): boolean {
  const count = [...text.trim()].length;
  const normalized = text.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
  return isGoalResultCard(card) && count >= 20 && count <= 50 && !BANNED.test(normalized) &&
    !RESULT_DIRECTIVE.test(normalized) &&
    (card.kind !== 'brag' || (BRAG_AFFIRMATION.test(normalized) && !BRAG_DISMISSAL.test(normalized))) &&
    hasResultCardAnchor(card, normalized) &&
    !containsCrisis([normalized]) && !isManipulative(normalized) && !auditTone(normalized) && !auditSocial(normalized) && !auditCriticalContent(normalized);
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
