import type { Card } from '../types';
import { containsCrisis } from './submissionGuard';

/** One-time forum orientation. Only persisted 'done' is an override; progress is derived from cards. */
export type OpeningStage = 'reading' | 'need-intro' | 'ready';
export const OPENING_GATE_KEY = 'startnow.openingGate.v1';
export const INTRO_PERSONA_IDS = ['shenmo', 'weini', 'miaoze', 'yanggao'] as const;

export function readOpeningGate(): OpeningStage | null {
  try {
    const saved = localStorage.getItem(OPENING_GATE_KEY);
    return saved === 'reading' || saved === 'need-intro' || saved === 'done'
      ? saved === 'done' ? 'ready' : saved : null;
  } catch { return null; }
}
export function persistOpeningStage(stage: OpeningStage): void {
  try { localStorage.setItem(OPENING_GATE_KEY, stage === 'ready' ? 'done' : stage); }
  catch { /* Storage may be disabled; card flags still make progress durable if saved. */ }
}
export function clearOpeningStage(): void {
  try { localStorage.removeItem(OPENING_GATE_KEY); } catch { /* storage disabled */ }
}
export function validPlayerIntroText(text: unknown): text is string {
  if (typeof text !== 'string' || text.trim().length < 10 || text.trim().length > 2000) return false;
  return !containsCrisis([text]);
}
export function isPlayerIntro(card: Card): boolean {
  return card.playerIntro === true && card.authorKind === 'player' && card.authorId === 'me' &&
    card.kind === 'worry' && !card.image && !card.goalId && validPlayerIntroText(card.text);
}
export function isPlayerFirstCard(card: Card): boolean {
  return card.authorKind === 'player' && card.authorId === 'me' && card.kind !== 'guide';
}

/** Missing or partial old introductions must never permanently lock archived players. */
export function openingIntroCards(cards: readonly Card[]): Card[] {
  const byId = new Map<string, Card>();
  for (const card of cards) {
    if (card.intro === true && card.authorKind === 'persona' && INTRO_PERSONA_IDS.includes(card.authorId as typeof INTRO_PERSONA_IDS[number])) {
      const previous = byId.get(card.authorId);
      if (!previous || card.createdAt < previous.createdAt) byId.set(card.authorId, card);
    }
  }
  return INTRO_PERSONA_IDS.map(id => byId.get(id)).filter((card): card is Card => Boolean(card));
}
export function openingReadCount(cards: readonly Card[]): number {
  return openingIntroCards(cards).filter(card => Number.isFinite(card.seenAt) && (card.seenAt ?? 0) > 0).length;
}
export function openingStage(cards: readonly Card[], persisted: OpeningStage | null = readOpeningGate()): OpeningStage {
  const introductions = openingIntroCards(cards);
  if (introductions.length !== INTRO_PERSONA_IDS.length) return 'ready'; // old/partial saves
  if (persisted === 'ready' || cards.some(isPlayerFirstCard)) return 'ready';
  // Previously active AI story timelines were not gated; preserve access on upgrade.
  if (!persisted && cards.some(card => card.authorKind === 'persona' && card.kind === 'goal' && card.goalId)) return 'ready';
  return 'need-intro';
}
export const openingReady = (cards: readonly Card[], persisted?: OpeningStage | null): boolean =>
  openingStage(cards, persisted) === 'ready';
