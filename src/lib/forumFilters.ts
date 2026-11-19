import type { Card } from '../types';
import { dateKeyLocal } from './schedule';

export const FORUM_VIEWS = ['全部', '今天', '目标', '失败', '成功', '诉苦'] as const;
export type ForumView = (typeof FORUM_VIEWS)[number];

const failureText = (card: Card) =>
  card.kind === 'worry' && card.origin === 'simulated' &&
  /(?:没做完|没做到|没完成)/.test(`${card.title ?? ''}${card.text}`);

const isFailure = (card: Card) => card.vulnerability?.kind === 'missed' || failureText(card);

/** Type filters are orthogonal to the existing topic filters. */
export function matchesForumView(card: Card, view: ForumView, now = Date.now()): boolean {
  switch (view) {
    case '今天': return dateKeyLocal(card.createdAt) === dateKeyLocal(now);
    case '目标': return card.kind === 'goal' || card.kind === 'progress';
    case '失败': return isFailure(card);
    case '成功': return card.kind === 'brag';
    case '诉苦': return card.kind === 'worry' && !isFailure(card);
    default: return true;
  }
}
