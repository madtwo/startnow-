import type { Card, Comment, Goal, GoalSource, GoalStep, Persona, ScheduleItem } from '../types';
import { containsCrisis } from './submissionGuard';
import { dateKeyLocal } from './schedule';

const DAY = 86_400_000;
const VALID_KINDS = new Set<GoalStep['kind']>(['research', 'draft', 'review', 'admin', 'other']);
export interface StepInput { text: string; kind?: GoalStep['kind']; minutes?: number; dueAt?: number }

export function goalProgress(goal: Goal) {
  const total = goal.steps.length;
  const done = goal.steps.filter((s) => s.status === 'done').length;
  return { total, done, remaining: total - done };
}

export function makeGoal(input: {
  title: string; detail?: string; source: GoalSource; steps: StepInput[];
  dueAt?: number; ownerId?: string; now?: number;
}, existing: readonly Goal[] = []): Goal {
  const now = input.now ?? Date.now();
  const title = input.title.trim();
  if (!title || title.length > 120 || input.detail && input.detail.length > 2000 ||
      containsCrisis([title, input.detail, ...input.steps.map((step) => step.text)])) {
    throw new Error('目标内容无效或包含需要人工支持的高风险表达');
  }
  if (existing.filter((g) => g.ownerId === (input.ownerId ?? 'me') && g.status === 'active').length >= 50) {
    throw new Error('进行中的目标已达到 50 个，请先归档旧目标');
  }
  if (input.steps.length < 1 || input.steps.length > 12) throw new Error('目标需要 1–12 个步骤');
  const id = crypto.randomUUID();
  const dueAt = Number.isFinite(input.dueAt) && input.dueAt! > now - DAY ? input.dueAt : undefined;
  return {
    id, ownerId: input.ownerId ?? 'me', title, detail: input.detail?.trim() || undefined,
    source: input.source, createdAt: now, dueAt, status: 'active', visibility: 'private',
    steps: input.steps.map((s) => {
      const text = s.text.trim();
      if (!text || text.length > 180 || containsCrisis([text])) throw new Error('步骤内容无效');
      const minutes = s.minutes;
      if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 120)) {
        throw new Error('每步预计时长需为 1–120 分钟');
      }
      if (s.dueAt && (!Number.isFinite(s.dueAt) || s.dueAt < now - DAY ||
          (dueAt !== undefined && s.dueAt > dueAt + DAY))) throw new Error('步骤日期不合法');
      return {
        id: crypto.randomUUID(), goalId: id, text,
        kind: VALID_KINDS.has(s.kind ?? 'other') ? (s.kind ?? 'other') : 'other',
        estimateMin: minutes, dueAt: s.dueAt, status: 'todo' as const,
      };
    }),
  };
}

export function createGoalCard(goal: Goal, authorName = '我', now = Date.now()): Card {
  if (goal.ownerId !== 'me') throw new Error('只能分享自己的目标');
  const progress = goalProgress(goal);
  const next = goal.steps.find((step) => step.status !== 'done');
  return {
    id: crypto.randomUUID(), authorId: 'me', authorName, authorKind: 'player',
    kind: 'goal', goalId: goal.id, title: goal.title,
    text: `目标：${goal.title}\n第一步：${next?.text ?? '已完成'}\n进度 ${progress.done}/${progress.total}${goal.dueAt ? ` · 截止 ${new Date(goal.dueAt).toLocaleDateString('zh-CN')}` : ''}`,
    createdAt: now, status: 'talking', arrivals: [], plan: [], pending: [], comments: [],
    likes: 0, cheerCount: 0, cheeredByMe: false,
  };
}

export function shareGoal(goal: Goal, cards: readonly Card[], authorName = '我', now = Date.now()) {
  if (goal.sharedAt && now - goal.sharedAt < DAY) throw new Error('同一目标 24 小时内只能分享一次');
  if (cards.some((card) => card.goalId === goal.id && card.kind === 'goal' && now - card.createdAt < DAY)) {
    throw new Error('这项目标今天已经分享到论坛');
  }
  const card = createGoalCard(goal, authorName, now);
  return { goal: { ...goal, visibility: 'forum' as const, sharedCardId: card.id, sharedAt: now }, card };
}

export function toggleCheer(card: Card): Card {
  const prev = card.cheeredByMe === true;
  return {
    ...card, cheeredByMe: !prev,
    cheerCount: Math.max(0, (card.cheerCount ?? 0) + (prev ? -1 : 1)),
  };
}

export function personaCheer(card: Card, persona: Persona, text: string, origin: Comment['origin'], now = Date.now()): Card {
  // At most one cheer from a given persona to a specific card.
  if (card.authorId !== 'me' || card.authorKind !== 'player' ||
      !['goal', 'progress'].includes(card.kind ?? '') ||
      card.comments.some((row) => row.authorId === persona.id && row.peer === 'goal-cheer')) return card;
  if (!text.trim() || containsCrisis([text])) return card;
  return { ...card, cheerCount: (card.cheerCount ?? 0) + 1,
    comments: [...card.comments, {
      id: crypto.randomUUID(), authorId: persona.id, authorKind: 'persona',
      text: text.trim().slice(0, 120), kind: 'comment', at: now, origin, peer: 'goal-cheer',
    }],
  };
}

export function progressCard(goal: Goal, authorName: string, feeling: string, now = Date.now()): Card {
  if (containsCrisis([feeling])) throw new Error('这段感受暂不适合直接发帖');
  const { total, done } = goalProgress(goal);
  return { id: crypto.randomUUID(), authorId: 'me', authorName, authorKind: 'player',
    title: `${goal.title} · 进度`, kind: 'progress', goalId: goal.id,
    text: `完成 ${done}/${total} 步。${feeling.trim().slice(0, 300)}`, createdAt: now,
    status: 'talking', arrivals: [], plan: [], pending: [], comments: [], cheerCount: 0, likes: 0,
  };
}

/** Leaves linked calendar entries unchanged unless the user explicitly chooses to remove them. */
export function deleteGoal(goals: readonly Goal[], items: readonly ScheduleItem[], goalId: string, removeCalendar = false) {
  return { goals: goals.filter((g) => g.id !== goalId),
    schedule: removeCalendar ? items.filter((item) => item.goalId !== goalId) : items.map((item) =>
      item.goalId === goalId ? { ...item, goalId: undefined, stepId: undefined, source: 'manual' as const } : item),
  };
}


/** Fictional persona goals: domain-only helpers. Local templates feed the pure
 * personaGoals scheduler; a planned outcome is a simulated story, never a real act.
 */
const personaDay = (now: number) => dateKeyLocal(now);
const hashGoal = (text: string): number => [...text].reduce((h, char) =>
  (Math.imul(h, 33) + char.charCodeAt(0)) >>> 0, 5381);

export function planPersonaOutcome(goal: Goal, now = Date.now()): Goal {
  if (goal.ownerId === 'me' || goal.source !== 'ai') throw new Error('只有虚构 AI 目标可以计划剧情结果');
  if (goal.postPlan) return goal;
  const hash = hashGoal(`${goal.ownerId}:${goal.title}:${personaDay(now)}`);
  const sampled: NonNullable<Goal['postPlan']>['outcome'] =
    hash % 5 <= 1 ? 'done' : hash % 5 <= 3 ? 'partial' : 'missed';
  const outcome = sampled === 'partial' && goal.steps.length === 1 ? 'missed' : sampled;
  const dueAt = now + (2 + (hash % 5)) * 3_600_000;
  return { ...goal, postPlan:{outcome,dueAt} };
}

export function makePersonaGoal(input: {
  persona: Persona; title: string; steps: StepInput[]; now?: number;
}, existing: readonly Goal[] = []): Goal {
  const now = input.now ?? Date.now();
  if (input.steps.length < 1 || input.steps.length > 3)
    throw new Error('AI 目标只允许 1–3 个微步骤');
  if (existing.some((goal) => goal.source === 'ai' && goal.ownerId === input.persona.id &&
      personaDay(goal.createdAt) === personaDay(now)))
    throw new Error('这个角色今天已经有一项目标');
  const aiToday = existing.filter((goal) => goal.source === 'ai' &&
    personaDay(goal.createdAt) === personaDay(now)).length;
  if (aiToday >= 4) throw new Error('今天的四条 AI 目标上限已满');
  const goal = makeGoal({title:input.title, source:'ai', ownerId:input.persona.id,
    steps:input.steps, now}, existing);
  return planPersonaOutcome({...goal, visibility:'forum'}, now);
}

export function createPersonaGoalCard(goal: Goal, name: string, now = Date.now()): Card {
  if (goal.ownerId === 'me' || goal.source !== 'ai' || !goal.postPlan)
    throw new Error('不是可发布的 AI 目标');
  return {
    id:crypto.randomUUID(), authorId:goal.ownerId, authorName:name,
    authorKind:'persona', kind:'goal', goalId:goal.id,
    title:`${name} · 今天想做的小事`,
    text:`${goal.title}
计划：${goal.steps.map(s=>s.text).join('；')}。`,
    origin:'simulated', createdAt:now, status:'talking',
    arrivals:[],plan:[],pending:[],comments:[],likes:0,cheerCount:0,cheeredByMe:false,
  };
}

export function publishPersonaGoal(goal: Goal, name: string, now=Date.now()): {goal:Goal;card:Card} {
  if (goal.sharedCardId) throw new Error('这项目标已发布');
  const card = createPersonaGoalCard(goal, name, now);
  return {goal:{...goal,sharedCardId:card.id,sharedAt:now},card};
}

/** Idempotent result publication: only from the persisted postPlan, and never
 * from a fabricated background job. Return null on duplicate or not-yet-due.
 */
export function resultCardForGoal(goal: Goal, cards: readonly Card[], name: string,
  now=Date.now()): {goal:Goal;card:Card} | null {
  if (goal.source !== 'ai' || goal.ownerId==='me' || !goal.postPlan ||
      now < goal.postPlan.dueAt || goal.postPlan.reportedAt || goal.resultCardId ||
      cards.some(card=>card.goalId===goal.id && (card.kind==='brag'||card.kind==='worry'))) return null;
  const planned = goal.postPlan.outcome;
  const outcome = planned==='partial' && goal.steps.length===1 ? 'missed' : planned;
  const completedCount = outcome==='done' ? goal.steps.length : outcome==='partial' ? 1 : 0;
  const steps = goal.steps.map((step,i)=>i < completedCount
    ? {...step,status:'done' as const,completedAt:now}
    : {...step,status:'todo' as const,completedAt:undefined});
  const statusText = outcome==='done' ? '今天把计划的步骤做完了' :
    outcome==='partial' ? '今天只做完一小部分，没有全部完成' :
      '今天没做完原来的计划';
  const text = `${statusText}。${
    completedCount ? `做到：${steps.slice(0,completedCount).map(s=>s.text).join('；')}。` : ''}${
    completedCount < steps.length ? `还没做：${steps.slice(completedCount).map(s=>s.text).join('；')}。` : ''}`;
  const card:Card = {id:crypto.randomUUID(),authorId:goal.ownerId,authorName:name,
    authorKind:'persona',title:`${name} · ${outcome==='done'?'小小炫耀':'今天没做完'}`,
    kind:outcome==='done'?'brag':'worry',goalId:goal.id,origin:'simulated',text,
    createdAt:now,status:'talking',arrivals:[],plan:[],pending:[],comments:[],likes:0};
  return {goal:{...goal,steps,status:outcome==='done'?'done':'active',
    resultCardId:card.id,postPlan:{...goal.postPlan,reportedAt:now}},card};
}
