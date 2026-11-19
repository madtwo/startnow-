/**
 * Conservative cross-card accounting for local, curated action recommendations.
 * This module never touches model-generated replies or changes action routing.
 *
 * `24h` is an explicit proxy for a run: the app does not persist a run ID.
 * Test harnesses with a shorter or longer run can override `windowMs`.
 */
export interface CuratedAction {
  id: string;
  line: string;
  alternateLine?: string;
}

export interface CuratedUsageCard {
  id: string;
  advice?: { actionId?: string; origin?: string; at?: number };
  comments?: ReadonlyArray<{
    actionId?: string;
    authorKind?: string;
    origin?: string;
    at: number;
    text: string;
  }>;
}

export interface CuratedChoice {
  text: string;
  useAlternate: boolean;
  priorCards: number;
}

const DAY_MS = 86_400_000;
const within = (at: number | undefined, now: number, duration: number): boolean =>
  typeof at === 'number' && Number.isFinite(at) && at <= now && at >= now - duration;

/** One *card* counts once, even if its advice is repeated in a visible comment. */
export function curatedActionUsesAcrossCards(
  cards: readonly CuratedUsageCard[],
  actionId: string,
  now: number,
  exceptCardId?: string,
  windowMs = DAY_MS,
): number {
  if (!actionId || !Number.isFinite(now) || windowMs <= 0) return 0;
  let count = 0;
  for (const card of cards) {
    if (card.id === exceptCardId) continue;
    const advice = card.advice;
    const matchingAdvice = advice?.actionId === actionId &&
      // A missing origin is a legacy value; treat as potentially curated,
      // never silently rewrite the persisted object.
      (advice.origin === 'curated' || advice.origin == null) &&
      within(advice.at, now, windowMs);
    const matchingComment = (card.comments ?? []).some((comment) =>
      comment.actionId === actionId &&
      comment.authorKind === 'persona' &&
      (comment.origin === 'curated' || comment.origin == null) &&
      within(comment.at, now, windowMs));
    if (matchingAdvice || matchingComment) count++;
  }
  return count;
}

/**
 * Two cards may use the same curated action: vary the copy on the second.
 * A third card must choose another eligible action or abstain. `null` is not
 * permission to hallucinate a new action ID.
 */
export function chooseCuratedActionLine(
  action: CuratedAction,
  cards: readonly CuratedUsageCard[],
  now: number,
  currentCardId: string,
  preferredLine = action.line,
  maxCards = 2,
): CuratedChoice | null {
  const priorCards = curatedActionUsesAcrossCards(cards, action.id, now, currentCardId);
  if (maxCards <= 0 || priorCards >= maxCards) return null;
  if (priorCards === 0) {
    const text = preferredLine === action.alternateLine && action.alternateLine
      ? action.alternateLine : action.line;
    return { text, useAlternate: Boolean(action.alternateLine && text === action.alternateLine), priorCards };
  }
  // Second appearance deliberately uses the alternate (if supplied) to
  // prevent exact repeated phrasing. Without a reviewed alternate, abstain.
  if (!action.alternateLine) return null;
  const previous = cards.find((card) => card.id !== currentCardId && (
    (card.advice?.actionId === action.id &&
      (card.advice.origin === 'curated' || card.advice.origin == null) &&
      within(card.advice.at, now, DAY_MS)) ||
    (card.comments ?? []).some((c) => c.actionId === action.id &&
      c.authorKind === 'persona' && (c.origin === 'curated' || c.origin == null) &&
      within(c.at, now, DAY_MS))));
  const previousText = previous?.comments?.find((c) => c.actionId === action.id &&
    (c.origin === 'curated' || c.origin == null) && within(c.at, now, DAY_MS))?.text;
  const text = previousText === action.alternateLine ? action.line : action.alternateLine;
  return { text, useAlternate: text === action.alternateLine, priorCards };
}
