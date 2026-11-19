import type { Goal, GoalStep, ScheduleItem } from '../types';
import { containsCrisis } from './submissionGuard';

export function dateKeyLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseLocalDate(key: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(y, m - 1, d);
  if (at.getFullYear() !== y || at.getMonth() + 1 !== m || at.getDate() !== d) return;
  return at.getTime();
}
export const scheduleRetention = (items: readonly ScheduleItem[], now = Date.now()): ScheduleItem[] => {
  // Keep future items; limit past history to 180 days and total to 1000 entries.
  const floor = now - 180 * 86_400_000;
  return [...items].filter((i) => (parseLocalDate(i.dateKey) ?? 0) >= floor)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.startMin ?? -1) - (b.startMin ?? -1))
    .slice(0, 1000);
};
export function addManualSchedule(items: readonly ScheduleItem[], title: string, dateKey: string,
  startMin?: number, now = Date.now()): ScheduleItem[] {
  if (!title.trim() || title.length > 180 || containsCrisis([title]) || parseLocalDate(dateKey) === undefined ||
      (startMin !== undefined && (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439))) {
    throw new Error('请填写有效的日程标题、日期与时间');
  }
  return scheduleRetention([...items, {
    id: crypto.randomUUID(), ownerId: 'me', title: title.trim(), dateKey,
    startMin, status: 'todo', source: 'manual', createdAt: now,
  }], now);
}
export function scheduleGoal(goal: Goal, items: readonly ScheduleItem[], now = Date.now()): ScheduleItem[] {
  const out = [...items];
  goal.steps.forEach((step) => {
    if (!step.dueAt || out.some((item) => item.stepId === step.id)) return;
    const dateKey = dateKeyLocal(step.dueAt);
    out.push({ id: crypto.randomUUID(), ownerId: goal.ownerId, goalId: goal.id,
      stepId: step.id, title: step.text, dateKey, status: step.status === 'done' ? 'done' : 'todo',
      source: 'goal', createdAt: now });
  });
  return scheduleRetention(out, now);
}
export function setStepDone(goals: readonly Goal[], items: readonly ScheduleItem[], stepId: string, done: boolean,
  now = Date.now()): { goals: Goal[]; schedule: ScheduleItem[] } {
  const goalsNext = goals.map((goal) => {
    if (!goal.steps.some((step) => step.id === stepId)) return goal;
    const steps: GoalStep[] = goal.steps.map((step) => step.id === stepId ? {
      ...step, status: done ? 'done' : 'todo', completedAt: done ? (step.completedAt ?? now) : undefined,
    } : step);
    return { ...goal, steps, status: steps.every((step) => step.status === 'done') ? 'done' as const : 'active' as const };
  });
  return { goals: goalsNext, schedule: items.map((item) => item.stepId === stepId ?
    { ...item, status: done ? 'done' as const : 'todo' as const } : item) };
}
export function setScheduleDone(goals: readonly Goal[], items: readonly ScheduleItem[], itemId: string, done: boolean,
  now = Date.now()) {
  const item = items.find((row) => row.id === itemId);
  if (!item) return { goals: [...goals], schedule: [...items] };
  if (item.stepId) return setStepDone(goals, items, item.stepId, done, now);
  return { goals: [...goals], schedule: items.map((row) => row.id === itemId ?
    { ...row, status: done ? 'done' as const : 'todo' as const } : row) };
}
export function goalStreak(goals: readonly Goal[], now = Date.now()): number {
  const days = new Set(goals.flatMap((g) => g.steps.map((step) => step.completedAt)
    .filter((at): at is number => typeof at === 'number').map(dateKeyLocal)));
  let current = new Date(now);
  // Being inactive today should not erase a streak that was active yesterday.
  if (!days.has(dateKeyLocal(now))) current.setDate(current.getDate() - 1);
  let n = 0;
  while (n < 365 && days.has(dateKeyLocal(current.getTime()))) {
    n++;
    current.setDate(current.getDate() - 1);
  }
  return n;
}
