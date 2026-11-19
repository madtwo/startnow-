import type { Card } from '../types';

/** History is a view, not a migration or deletion. Sort copies, never mutate React state. */
export const isHistoryCard = (card: Card): boolean => card.kind === 'goal' || card.kind === 'progress';
export function splitForumCards(cards: readonly Card[]): { main: Card[]; history: Card[] } {
  const visible = cards.filter(card => card.kind !== 'guide');
  const newestFirst = (a: Card, b: Card) => b.createdAt - a.createdAt;
  return {
    main: visible.filter(card => !isHistoryCard(card)).sort(newestFirst),
    history: visible.filter(isHistoryCard).sort(newestFirst),
  };
}
