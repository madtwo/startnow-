import type { Goal, GoalStep, ScheduleItem } from '../types';
import { containsCrisis } from './submissionGuard';

export function dateKeyLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseLocalDate(key: unknown): number | undefined {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
  const [y, m, d] = key.split('-').map(Number);
  const at = new Date(y, m - 1, d);
  if (at.getFullYear() !== y || at.getMonth() + 1 !== m || at.getDate() !== d) return;
  return at.getTime();
}
export const MAX_SCHEDULE_ITEMS = 2000;
export const scheduleRetention = (items: readonly ScheduleItem[], now = Date.now()): ScheduleItem[] => {
  // Never silently evict future deadlines (or unfinished historical items).
  const floor = new Date(now); floor.setHours(0, 0, 0, 0); floor.setDate(floor.getDate() - 180);
  return [...items].filter((i) => i.status !== 'done' || (parseLocalDate(i.dateKey) ?? 0) >= floor.getTime())
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.startMin ?? -1) - (b.startMin ?? -1));
};
function checkedSchedule(items: readonly ScheduleItem[], now: number): ScheduleItem[] {
  const next = scheduleRetention(items, now);
  if (next.length > MAX_SCHEDULE_ITEMS) throw new Error('日程总数已达到上限，请先备份并清理不再需要的事项');
  return next;
}
export function addManualSchedule(items: readonly ScheduleItem[], title: string, dateKey: string,
  startMin?: number, now = Date.now()): ScheduleItem[] {
  if (!title.trim() || title.length > 180 || containsCrisis([title]) || parseLocalDate(dateKey) === undefined ||
      (startMin !== undefined && (!Number.isInteger(startMin) || startMin < 0 || startMin > 1439))) {
    throw new Error('请填写有效的日程标题、日期与时间');
  }
  return checkedSchedule([...items, {
    id: crypto.randomUUID(), ownerId: 'me', title: title.trim(), dateKey,
    startMin, status: 'todo', source: 'manual', createdAt: now,
  }], now);
}
export function scheduleGoal(goal: Goal, items: readonly ScheduleItem[], now = Date.now()): ScheduleItem[] {
  const out = [...items];
  goal.steps.forEach((step) => {
    if (!step.dueAt || out.some((item) => item.goalId === goal.id && item.stepId === step.id)) return;
    const dateKey = dateKeyLocal(step.dueAt);
    out.push({ id: crypto.randomUUID(), ownerId: goal.ownerId, goalId: goal.id,
      stepId: step.id, title: step.text, dateKey, status: step.status === 'done' ? 'done' : 'todo',
      source: 'goal', createdAt: now });
  });
  return checkedSchedule(out, now);
}
export function setStepDone(goals: readonly Goal[], items: readonly ScheduleItem[], stepId: string, done: boolean,
  now = Date.now(), goalId?: string): { goals: Goal[]; schedule: ScheduleItem[] } {
  // Legacy callers may omit goalId only when the step has exactly one owner.
  const matches = goals.filter(goal => (!goalId || goal.id === goalId) && goal.steps.some(step => step.id === stepId));
  if (matches.length !== 1) return { goals: [...goals], schedule: [...items] };
  const owner = matches[0];
  const goalsNext = goals.map((goal) => {
    if (goal.id !== owner.id) return goal;
    const steps: GoalStep[] = goal.steps.map((step) => step.id === stepId ? {
      ...step, status: done ? 'done' : 'todo', completedAt: done ? (step.completedAt ?? now) : undefined,
    } : step);
    return { ...goal, steps, status: steps.every((step) => step.status === 'done') ? 'done' as const : 'active' as const };
  });
  return { goals: goalsNext, schedule: items.map((item) => item.goalId === owner.id && item.stepId === stepId && item.ownerId === owner.ownerId ?
    { ...item, status: done ? 'done' as const : 'todo' as const } : item) };
}
export function setScheduleDone(goals: readonly Goal[], items: readonly ScheduleItem[], itemId: string, done: boolean,
  now = Date.now()) {
  const item = items.find((row) => row.id === itemId);
  if (!item) return { goals: [...goals], schedule: [...items] };
  if (item.stepId && item.goalId) {
    const owner = goals.find(goal => goal.id === item.goalId && goal.ownerId === item.ownerId);
    if (!owner) return { goals: [...goals], schedule: [...items] };
    return setStepDone(goals, items, item.stepId, done, now, owner.id);
  }
  return { goals: [...goals], schedule: items.map((row) => row.id === itemId ?
    { ...row, status: done ? 'done' as const : 'todo' as const } : row) };
}
export function goalStreak(goals: readonly Goal[], now = Date.now()): number {
  const days = new Set(goals.filter(g => g.ownerId === 'me').flatMap((g) => g.steps.filter(step => step.status === 'done').map((step) => step.completedAt)
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
