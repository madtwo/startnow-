import type { Card } from '../types';
import { isVagueComfortAdvice } from './brag';
import { likelyFreeTextAction } from './freeTextShrink';

const NEXT_STEP_KINDS = new Set<NonNullable<Card['kind']>>(['worry', 'goal', 'progress']);

/** Brag/life/guide cards only collect reactions; they never enter the note/completion chain. */
export const canUseNextStep = (card: Pick<Card, 'kind'>): boolean =>
  !card.kind || NEXT_STEP_KINDS.has(card.kind);

/** A persona's empathy/question is a comment, not an executable next step. */
const GENERIC_REPLY = /(?:我也刚来|不太会接|我也说不好|我可能也说不好|你想从哪讲起|先说是哪一件|你先说|我在听|我听着|我看到了|展开说说|你想说什么|我其实也不太懂)/u;

export function isActionableStepText(text: string): boolean {
  const clean = text.normalize('NFKC').trim();
  if (!clean || GENERIC_REPLY.test(clean) || isVagueComfortAdvice(clean)) return false;
  return likelyFreeTextAction(clean);
}
