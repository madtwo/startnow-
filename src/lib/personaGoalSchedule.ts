import type { Card, Goal } from '../types';

export const PERSONA_GOAL_CHECK_MS = 60_000;

/** 首次检查立即执行；暂停、专用炫耀 tick 和未满间隔均跳过。 */
export function shouldCheckPersonaGoals(lastAt: number, now: number,
  paused: boolean, bragOnly = false): boolean {
  return !paused && !bragOnly && (lastAt === 0 || now - lastAt >= PERSONA_GOAL_CHECK_MS);
}

/** 在异步 tick 的 revision 和两份快照均仍当前时才可以提交。 */
export function canCommitPersonaGoals(input: {
  revisionCurrent: boolean;
  baseCards: readonly Card[];
  currentCards: readonly Card[];
  baseGoals: readonly Goal[];
  currentGoals: readonly Goal[];
}): boolean {
  return input.revisionCurrent && input.baseCards === input.currentCards &&
    input.baseGoals === input.currentGoals;
}

/** 只把新发布的模拟卡合入，不覆盖同一张卡已经产生的打气/评论。 */
export function mergeNewPersonaCards(current: readonly Card[], candidate: readonly Card[]): Card[] {
  const seen = new Set(current.map((card) => card.id));
  const added = candidate.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
  return added.length ? [...added, ...current] : [...current];
}
