import type { DailySummary, Goal, GoalStep, ScheduleItem } from '../types';
import { containsCrisis } from './submissionGuard';
import { parseLocalDate, scheduleRetention } from './schedule';

const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max &&
  !containsCrisis([s]);
const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const id = (s: unknown) => text(s,128) && !!(s as string).trim();
const kinds = ['research','draft','review','admin','other'];
const statuses = ['active','done','paused','dropped'];
const sources = ['manual','ai','image'];

/** Strict archive validation. A malformed extra entity rejects import as a whole. */
export function parseGoals(data: unknown): Goal[] | null {
  if (!Array.isArray(data) || data.length > 250) return null;
  const seen = new Set<string>();
  const result: Goal[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Partial<Goal>;
    if (!id(row.id) || seen.has(row.id!) || !text(row.title,120) || !row.title?.trim() ||
      (row.detail !== undefined && !text(row.detail,2000)) || !num(row.createdAt) ||
      (row.dueAt !== undefined && !num(row.dueAt)) || !statuses.includes(row.status ?? '') ||
      !sources.includes(row.source ?? '') || !id(row.ownerId) ||
      !['private','forum'].includes(row.visibility ?? '') ||
      (row.sharedCardId !== undefined && !id(row.sharedCardId)) ||
      (row.sharedAt !== undefined && !num(row.sharedAt)) ||
      (row.resultCardId !== undefined && !id(row.resultCardId)) ||
      (row.postPlan !== undefined && (row.source !== 'ai' || row.ownerId === 'me' ||
        !row.postPlan || !['done','partial','missed'].includes(row.postPlan.outcome) ||
        !num(row.postPlan.dueAt) || row.postPlan.dueAt < row.createdAt! ||
        (row.postPlan.reportedAt !== undefined && (!num(row.postPlan.reportedAt) ||
          row.postPlan.reportedAt < row.postPlan.dueAt)))) ||
      !Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 12) return null;
    seen.add(row.id!);
    const steps: GoalStep[] = [];
    const stepIds = new Set<string>();
    for (const rawStep of row.steps) {
      if (!rawStep || typeof rawStep !== 'object') return null;
      const st = rawStep as Partial<GoalStep>;
      if (!id(st.id) || stepIds.has(st.id!) || st.goalId !== row.id ||
        !text(st.text,180) || !st.text?.trim() || !kinds.includes(st.kind ?? '') ||
        !['todo','doing','done'].includes(st.status ?? '') ||
        (st.estimateMin !== undefined && (!Number.isInteger(st.estimateMin) || st.estimateMin < 1 || st.estimateMin > 120)) ||
        (st.dueAt !== undefined && !num(st.dueAt)) || (st.completedAt !== undefined && !num(st.completedAt))) return null;
      stepIds.add(st.id!);
      steps.push({ id:st.id!, goalId:row.id!, text:st.text!, kind:st.kind!,
        status:st.status!, estimateMin:st.estimateMin, dueAt:st.dueAt, completedAt:st.completedAt });
    }
    result.push({ id:row.id!, ownerId:row.ownerId!, title:row.title!, detail:row.detail,
      createdAt:row.createdAt!, dueAt:row.dueAt, source:row.source!, status:row.status!,
      steps, visibility:row.visibility!, sharedCardId:row.sharedCardId, sharedAt:row.sharedAt,
      postPlan:row.postPlan, resultCardId:row.resultCardId });
  }
  if (result.filter((g) => g.status === 'active' && g.ownerId === 'me').length > 50) return null;
  return result;
}
export function parseSchedule(data: unknown): ScheduleItem[] | null {
  if (!Array.isArray(data) || data.length > 2000) return null;
  const result: ScheduleItem[] = []; const seen = new Set<string>();
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Partial<ScheduleItem>;
    if (!id(row.id) || seen.has(row.id!) || !id(row.ownerId) || !text(row.title,180) ||
      !row.title?.trim() || !row.dateKey || parseLocalDate(row.dateKey) === undefined ||
      !['todo','done'].includes(row.status ?? '') ||
      !['goal','todo','manual','ai'].includes(row.source ?? '') || !num(row.createdAt) ||
      (row.goalId !== undefined && !id(row.goalId)) || (row.stepId !== undefined && !id(row.stepId)) ||
      (row.startMin !== undefined && (!Number.isInteger(row.startMin) || row.startMin < 0 || row.startMin > 1439)) ||
      (row.endMin !== undefined && (!Number.isInteger(row.endMin) || row.endMin < 0 || row.endMin > 1439))) return null;
    seen.add(row.id!);
    result.push({ id:row.id!, ownerId:row.ownerId!, title:row.title!, dateKey:row.dateKey,
      status:row.status!, source:row.source!, createdAt:row.createdAt!, goalId:row.goalId,
      stepId:row.stepId, startMin:row.startMin, endMin:row.endMin });
  }
  const steps = new Set<string>();
  for (const item of result) if (item.stepId) {
    if (steps.has(item.stepId)) return null;
    steps.add(item.stepId);
  }
  return scheduleRetention(result);
}
export function parseSummaries(data: unknown): DailySummary[] | null {
  if (!Array.isArray(data) || data.length > 120) return null;
  const out: DailySummary[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Partial<DailySummary>;
    if (!id(row.id) || !id(row.ownerId) || !row.dateKey || parseLocalDate(row.dateKey) === undefined ||
        !text(row.text,1200) || !['local','model'].includes(row.origin ?? '') ||
        !num(row.createdAt) || (row.refreshedAt !== undefined && !num(row.refreshedAt))) return null;
    out.push({ id:row.id!, ownerId:row.ownerId!, dateKey:row.dateKey, text:row.text!,
      origin:row.origin!, createdAt:row.createdAt!, refreshedAt:row.refreshedAt });
  }
  return out;
}
