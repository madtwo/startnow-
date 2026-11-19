import type { Card, DailySummary, Goal, ScheduleItem } from '../types';
import { dateKeyLocal } from './schedule';

/** Fact-only fallback. Does not summarize private feelings or fabricate progress. */
export function localDailySummary(goals: readonly Goal[], cards: readonly Card[],
  schedule: readonly ScheduleItem[], now = Date.now()): string {
  const today = dateKeyLocal(now);
  const completed = goals.filter((goal) => goal.ownerId === 'me').flatMap((goal) =>
    goal.steps.filter((step) => step.completedAt &&
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
      `你是虚构论坛里一位温和的同伴。根据以下【本地统计】，只写一句不超过32字的自然衔接话，不增加人名、行动、数字或事实；不要照搬用户原文，不要说成长/蜕变，不要命令他继续努力。\n【本地统计】\n${facts}`)).trim();
    const line = raw.split(/[\r\n]/).map(row=>row.trim()).filter(Boolean)[0] ?? '';
    const unsafe = !line || line.length > 32 ||
      /(?:成长|蜕变|保证|必须|应该|一定要|你已|完成了|已经做|共|沈默|魏霓|苗泽|杨槔|张三|李四|王五|小王|小李|小张|[A-Z][a-z]{1,}|[0-9０-９]|[零〇一二三四五六七八九十百千万两]+(?:个|次|张|步|天|小时|项|条|件|页|份|段|分钟))/.test(line) ||
      (line.match(/[。！？!?]/g) ?? []).length > 1;
    if (unsafe) throw new Error('model_summary_unverifiable');
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
