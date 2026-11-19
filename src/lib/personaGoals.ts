import type { Card, Goal, Persona } from '../types';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { containsCrisis } from './submissionGuard';
import { dateKeyLocal } from './schedule';
import { makePersonaGoal, publishPersonaGoal, resultCardForGoal } from './goals';
import { PERSONA_GOAL_TEMPLATES } from './personaGoalTemplates';
import { canPublishVulnerability, createLostCard, isLostSlot, isManipulative, missedComfortLines } from './agentVulnerability';
import { planPeerReactions } from './peerReactions';

export interface PersonaGoalTickInput {
  goals: readonly Goal[];
  cards: readonly Card[];
  personas: readonly Persona[];
  now: number;
  enabled: boolean;
  dailyCap?: number;
  competition?: boolean;
  crisisAt?: number;
  introActive?: boolean;
  enableLost?: boolean;
}
export interface PersonaGoalTickResult {
  goals: Goal[];
  cards: Card[];
  createdGoals: number;
  publishedResults: number;
}

/** 与已有剧情 outcome hash 独立；在同一本地日内稳定选中同一份计划。 */
export function personaGoalHash(text: string): number {
  return [...text].reduce((hash, ch) => (Math.imul(hash, 33) + ch.charCodeAt(0)) >>> 0, 5381);
}

export function isSafePersonaGoalTemplate(input: { title: string; steps: readonly string[] }): boolean {
  if (!input.title.trim() || input.title.length > 60 ||
      input.steps.length < 1 || input.steps.length > 3 ||
      input.steps.some((step) => !step.trim() || step.length > 80)) return false;
  const lines = [input.title, ...input.steps];
  return !containsCrisis(lines) && lines.every((line) =>
    !auditSocial(line) && !auditTone(line) && !auditCriticalContent(line) &&
    !/线下见面|加微信|我一定做到|治愈|我去你宿舍/.test(line));
}

/** 纯函数：先补发到期结果，再补当天目标，不接触模型、浏览器状态或玩家待办。 */
export function tickPersonaGoals(input: PersonaGoalTickInput): PersonaGoalTickResult {
  const goals = [...input.goals];
  const cards = [...input.cards];
  if (!input.enabled || input.competition || input.introActive) return { goals, cards, createdGoals: 0, publishedResults: 0 };

  let publishedResults = 0;
  const personaNames = new Map(input.personas.map((p) => [p.id, p.name]));
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    if (goal.source !== 'ai' || goal.ownerId === 'me' || !goal.postPlan) continue;
    try {
      // A fictional missed/partial result obeys the same global/per-person cap as lost posts.
      const missed = goal.postPlan.outcome !== 'done';
      if (missed && !canPublishVulnerability({cards,personaId:goal.ownerId,kind:'missed',
        now:input.now,paused:!input.enabled,competition:input.competition,
        crisisAt:input.crisisAt,introActive:input.introActive})) continue;
      const outcome = resultCardForGoal(goal, cards, personaNames.get(goal.ownerId) ?? 'AI 同伴', input.now);
      if (!outcome) continue;
      if (missed) {
        const comfort = missedComfortLines(goals.indexOf(goal));
        const text = `${outcome.card.text}\n${comfort}`;
        if (isManipulative(text)) continue;
        outcome.card = {...outcome.card,text,vulnerability:{kind:'missed',personaId:goal.ownerId,at:input.now}};
      }
      // A result card is the sole exception to the static-goal no-peer rule.
      // The persisted plan is built once; later ticks only consume it.
      outcome.card.plan = planPeerReactions(outcome.card, input.personas, input.now);
      goals[i] = outcome.goal;
      cards.unshift(outcome.card);
      publishedResults++;
    } catch {
      // 损坏的旧 AI 目标不能阻断其他角色结算；原数据原样保留。
    }
  }

  const today = dateKeyLocal(input.now);
  const cap = Number.isInteger(input.dailyCap)
    ? Math.max(0, Math.min(4, input.dailyCap!)) : 4;
  let aiToday = goals.filter((goal) => goal.source === 'ai' &&
    dateKeyLocal(goal.createdAt) === today).length;
  let createdGoals = 0;
  const seenPersonas = new Set<string>();
  for (const persona of input.personas) {
    if (aiToday >= cap) break;
    if (persona.id === 'me' || seenPersonas.has(persona.id)) continue;
    seenPersonas.add(persona.id);
    if (goals.some((goal) => goal.source === 'ai' && goal.ownerId === persona.id &&
        dateKeyLocal(goal.createdAt) === today)) continue;
    const templates = PERSONA_GOAL_TEMPLATES[persona.id];
    if (!templates?.length) continue; // 自定义角色不借用别人生活经历。
    const template = templates[personaGoalHash(`${persona.id}${today}`) % templates.length];
    if (!isSafePersonaGoalTemplate(template)) continue;
    try {
      const goal = makePersonaGoal({ persona, title: template.title,
        steps: template.steps.map((text) => ({ text })), now: input.now }, goals);
      const published = publishPersonaGoal(goal, persona.name, input.now);
      goals.push(published.goal);
      cards.unshift(published.card);
      aiToday++;
      createdGoals++;
    } catch {
      // 本轮的一条模板不合法，只跳过这一位，不影响其他人。
    }
  }
  // Add occasional low-pressure uncertainties, without turning replies into obligations.
  if (input.enableLost && !input.introActive) {
    for (const persona of input.personas) {
      if (!isLostSlot(persona.id,input.now) || !canPublishVulnerability({
        cards,personaId:persona.id,kind:'lost',now:input.now,
        crisisAt:input.crisisAt,competition:input.competition,paused:!input.enabled,
      })) continue;
      const lost=createLostCard(persona,input.now);
      if (lost) {cards.unshift(lost);publishedResults++;}
    }
  }
  return { goals, cards, createdGoals, publishedResults };
}
