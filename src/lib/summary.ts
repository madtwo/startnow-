import type { Card, DailySummary, Goal, ScheduleItem } from '../types';
import { dateKeyLocal } from './schedule';

/** Fact-only fallback. Does not summarize private feelings or fabricate progress. */
export function localDailySummary(goals: readonly Goal[], cards: readonly Card[],
  schedule: readonly ScheduleItem[], now = Date.now()): string {
  const today = dateKeyLocal(now);
  const completed = goals.filter((goal) => goal.ownerId === 'me').flatMap((goal) =>
    goal.steps.filter((step) => step.status === 'done' && step.completedAt &&
    dateKeyLocal(step.completedAt) === today).map((step) => step.text));
  const posts = cards.filter((card) => card.authorId === 'me' && dateKeyLocal(card.createdAt) === today).length;
  const cheers = cards.filter((card) => card.authorId === 'me').reduce((sum, card) =>
    sum + card.comments.filter((c) => c.peer === 'goal-cheer' && dateKeyLocal(c.at) === today).length, 0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const next = schedule.find((item) => item.ownerId === 'me' && item.status === 'todo' &&
    item.dateKey === dateKeyLocal(tomorrow.getTime()));
  return [
    `今天完成：${completed.length ? completed.slice(0,4).join('；') : '暂无完成的目标步骤'}。`,
    `发过的卡：${posts} 张。今天收到的同伴打气：${cheers} 次。`,
    `明天安排：${next?.title ?? '暂无，按自己节奏来'}。`,
    '（本地统计，不代表 AI 已实际执行任何任务）',
  ].join('\n');
}
export function saveLocalSummary(current: readonly DailySummary[], goals: readonly Goal[],
  cards: readonly Card[], schedule: readonly ScheduleItem[], now = Date.now()): DailySummary[] {
  const dateKey = dateKeyLocal(now);
  const existing = current.find((item) => item.ownerId === 'me' && item.dateKey === dateKey);
  if (existing?.refreshedAt) throw new Error('今日总结已经刷新过一次，明天再生成吧');
  const summary: DailySummary = {
    id: existing?.id ?? crypto.randomUUID(), ownerId: 'me', dateKey,
    text: localDailySummary(goals,cards,schedule,now), origin:'local',
    createdAt: existing?.createdAt ?? now,
    refreshedAt: existing ? now : undefined,
  };
  return [summary, ...current.filter((item) => item.dateKey !== dateKey || item.ownerId !== 'me')]
    .filter((item) => now - (new Date(item.dateKey).getTime()) <= 60*86_400_000).slice(0,60);
}


// Free-form negative regexes cannot prove that a sentence is non-factual.
// The model may choose from reviewed, non-factual connective lines only.
const SUMMARY_CONNECTORS = [
  '停一停也可以，别急。',
  '没关系，慢慢来，今天可以停一会儿。',
  '按自己的节奏就好。',
  '不用急着安排下一件事。',
] as const;

/** Optional model adapter: the caller must reserve one API slot before invoking
 * it. Keep dates, counts and task names assembled from verified local data;
 * the model may only supply a short, non-factual connective sentence.
 */
export async function generateDailySummary(input: {
  goals: readonly Goal[]; cards: readonly Card[]; schedule: readonly ScheduleItem[];
  now?: number; generate?: (prompt: string) => Promise<string>;
}): Promise<{text:string; origin: DailySummary['origin']; fallbackReason?: string}> {
  const now = input.now ?? Date.now();
  const facts = localDailySummary(input.goals, input.cards, input.schedule, now);
  if (!input.generate) return {text:facts,origin:'local',fallbackReason:'model_not_configured'};
  try {
    // Use a generated sentence only if it is non-imperative and makes no new claims.
    const raw = (await input.generate(
      `你是虚构论坛里一位温和的同伴。根据以下【本地统计】，只从以下固定衔接句中原样选择一句，不得改写或添加内容：\n${SUMMARY_CONNECTORS.join('\n')}\n【本地统计】\n${facts}`)).trim();
    const line = SUMMARY_CONNECTORS.find(option => option === raw);
    if (!line) throw new Error('model_summary_unverifiable');
    // Model text can never change verified facts; it only adds one gentle line.
    return {text:`${facts}\n${line}`,origin:'model'};
  } catch {
    return {text:facts,origin:'local',fallbackReason:'model_unavailable_or_unverifiable'};
  }
}

/** Daily quota: first generation plus one explicit refresh, never silent retries. */
export function saveGeneratedSummary(current: readonly DailySummary[], next: {
  text:string; origin:DailySummary['origin']; now?:number;
}): DailySummary[] {
  const now = next.now ?? Date.now();
  const today = dateKeyLocal(now);
  const prior = current.find(row=>row.ownerId==='me' && row.dateKey===today);
  if (prior?.refreshedAt) throw new Error('今日总结已经刷新过一次');
  if (!next.text || next.text.length > 1200) throw new Error('今日总结内容不合法');
  const summary:DailySummary = {id:prior?.id??crypto.randomUUID(),ownerId:'me',
    dateKey:today,text:next.text,origin:next.origin,
    createdAt:prior?.createdAt??now,refreshedAt:prior?now:undefined};
  return [summary,...current.filter(row=>row.ownerId!=='me'||row.dateKey!==today)].slice(0,60);
}
