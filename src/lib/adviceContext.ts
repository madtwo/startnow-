import type { Card } from '../types';

export type AdviceContextReason = 'no-followup' | 'unanswered-question';
export type AdviceStart = 'started' | 'busy' | 'blocked';

export interface AdviceContextCheck {
  thin: boolean;
  reason?: AdviceContextReason;
}

/** The player's own, actionable follow-ups; ignore advice written under another person's card. */
export function playerFollowups(card: Card): string[] {
  if (card.authorKind !== 'player' || card.authorId !== 'me') return [];
  const selected = card.comments
    .filter((comment) => comment.authorKind === 'player' && comment.kind !== 'advice' &&
      comment.text.trim().length >= 4)
    .slice(-3)
    .map((comment) => comment.text.trim().slice(0, 120));
  // Do not truncate the oldest fragment to squeeze in more context: preserve the
  // newest statements intact, dropping older ones when the 300-char cap is hit.
  while (selected.reduce((sum, text) => sum + text.length, 0) > 300) selected.shift();
  return selected;
}

/** Read-only context for intent matching and the existing advice picker. */
export function adviceContextText(card: Card): string {
  const followups = playerFollowups(card);
  if (!followups.length) return card.text;
  return `楼主后续补充：\n${followups.map((text) => `- ${text}`).join('\n')}\n\n原帖：\n${card.text}`;
}

export function adviceContextCheck(card: Card): AdviceContextCheck {
  if (card.authorKind !== 'player' || card.authorId !== 'me' || card.intro || card.playerIntro ||
    (card.kind !== undefined && card.kind !== 'worry') || card.advice ||
    card.status === 'noted' || card.status === 'done' || card.status === 'handled' ||
    card.material || card.materialCaptureStep || playerFollowups(card).length) {
    return { thin: false };
  }

  const lastPlayerCommentAt = card.comments
    .filter((comment) => comment.authorKind === 'player' && comment.kind !== 'advice')
    .reduce((max, comment) => Math.max(max, comment.at), -Infinity);
  const unanswered = card.comments.some((comment) =>
    comment.authorKind === 'persona' && comment.origin !== 'system' &&
    comment.origin !== 'boundary' && /[?？]$/.test(comment.text.trim()) &&
    comment.at > lastPlayerCommentAt);
  return { thin: true, reason: unanswered ? 'unanswered-question' : 'no-followup' };
}
