/**
 * Advice copy is untrusted model output. The curated action identity, not the
 * generated sentence, remains the executable action and deduplication key.
 */
import type { ActionItem } from './actions';
import { actionTextSimilarity } from './actions';
import { playerFacingAdviceAction, playerFacingPreferredLine } from './adviceFallbackCopy';
import { chooseCuratedActionLine, curatedActionUsesAcrossCards } from './curatedUsage';
import type { CuratedUsageCard } from './curatedUsage';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { findCrisis } from './safety';
import type { Card } from '../types';

export type AdviceChoice =
  | { kind: 'choice'; actionId: string; line: string | null; legacy: boolean }
  | { kind: 'none' }
  | { kind: 'invalid'; reason: 'json_invalid' | 'action_mismatch' };

export type AdviceLineFallbackReason =
  | 'missing' | 'too_short' | 'too_long' | 'too_many_sentences'
  | 'perspective' | 'counselor' | 'persona_name' | 'model_name'
  | 'unsafe' | 'no_anchor' | 'pure_comfort' | 'pure_question'
  | 'action_mismatch' | 'capped' | 'truncated' | 'repeated';

/** Accept exactly a JSON object or a single legacy candidate ID; never guess. */
export function parseAdviceChoice(raw: string, candidates?: readonly string[]): AdviceChoice {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: 'json_invalid' };
  let text = raw.trim();
  if (text.length > 6000) return { kind: 'invalid', reason: 'json_invalid' };
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/iu.exec(text);
  if (fence) text = fence[1].trim();
  if (/^(?:none|null)$/iu.test(text)) return { kind: 'none' };
  const permitted = (id: string) => !candidates || candidates.includes(id);
  try {
    const value: unknown = JSON.parse(text);
    if (value === null) return { kind: 'none' };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: 'invalid', reason: 'json_invalid' };
    }
    const row = value as Record<string, unknown>;
    if (typeof row.actionId !== 'string' || !/^[a-z0-9-]{2,80}$/u.test(row.actionId)) {
      return { kind: 'invalid', reason: 'json_invalid' };
    }
    if (!permitted(row.actionId)) return { kind: 'invalid', reason: 'action_mismatch' };
    return { kind: 'choice', actionId: row.actionId,
      line: typeof row.line === 'string' && row.line.trim() ? row.line.trim() : null,
      legacy: false };
  } catch {
    // Old model/test harnesses return just the ID. Restrict fallback to a
    // standalone ID or a tightly delimited "ID: ..." form, not arbitrary text.
    const match = /^(?:(?:动作(?:编号|ID)?|actionId|ID)\s*[:：]\s*)?([a-z][a-z0-9-]{1,79})$/iu.exec(text);
    if (match) {
      if (permitted(match[1])) return { kind: 'choice', actionId: match[1], line: null, legacy: true };
      return { kind: 'invalid', reason: 'action_mismatch' };
    }
    return { kind: 'invalid', reason: 'json_invalid' };
  }
}

const COMMON_NGRAMS = new Set([
  '一个','今天','现在','可以','要不','先把','先只','一下','就行','就好','不用','别的',
  '如果','然后','还是','这个','那个','自己','什么','怎么','一下子','已经','不要','先去',
  '只要','要的','事情','的事','想要','要做','只是','做完','先做','你可','以先','一件',
  '这次','时候','一点','觉得','东西','看看','就够','不必','先看','先写','下来',
]);
const normalize = (value: string): string => value.normalize('NFKC').toLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '');
const grams = (text: string, size: number): Set<string> => {
  const chars = Array.from(normalize(text));
  const out = new Set<string>();
  for (let i = 0; i + size <= chars.length; i++) {
    const part = chars.slice(i, i + size).join('');
    if (COMMON_NGRAMS.has(part) || /^(?:先|要|的|了|把|就|那|这|在|不|会|我|你|可)/u.test(part) && size === 2) continue;
    out.add(part);
  }
  return out;
};
const shares = (a: Set<string>, b: Set<string>) => [...a].filter((part) => b.has(part)).length;

// Action-scoped player-facing aliases from the reviewed synthetic set.
// These do not change the global no_anchor threshold or any other action.
const SCOPED_ALIASES: Readonly<Record<string, RegExp>> = {
  'peer-boundary-2': /(?:不去了|不想去|难说出口)/u,
  'peer-clarify-2': /(?:说具体|说明白|说清楚|摆出来|不带火气|不带情绪|不翻旧账|别带[“"「]?你总是|时间线|几点到几点|具体影响|要求说小)/u,
  // Claude's review treats this draft-only line as on-target.
  'love-draft-2': /(?:想催的话|写下来.{0,8}(?:别发|先不发)|写完.{0,12}(?:改软|再看))/u,
};

// These are extra checks on the scoped alias exception, not changes to the
// default no_anchor algorithm.  A keyword alone is not a complete action.
// Never let a draft/clarify/boundary alias turn into sending a message now.
const IMMEDIATE_SEND = /(?:发给|发出去|发送|发消息|发到|直接发)/gu;
const NEGATED_SEND_PREFIX = /(?:别(?:急着)?|不(?:用|要|急着)?|先不|暂时不|无需|无须)(?:.{0,2})$/u;
const DRAFT_THEN_SEND = /(?:写完|写好|拟好|读完|看完|改完).{0,8}(?:就|再|然后|最后|马上)(?:发|联系)/u;
const BOUNDARY_REVERSAL = /(?:还是|直接|然后|再|随后|现在|马上|立刻).{0,7}(?:答应|同意|去报名|去参加|照做)/u;

function scopedAliasIntent(actionId: string, text: string): boolean {
  if (actionId === 'peer-boundary-2') return /(?:写|拟|记|草稿)/u.test(text);
  if (actionId === 'peer-clarify-2') {
    return /(?:写|拟|说|讲|摆)/u.test(text) &&
      /(?:一句|那句|想说|话|澄清|事实|影响|分工|进度|时间线)/u.test(text);
  }
  if (actionId === 'love-draft-2') return /(?:写|拟|记|草稿)/u.test(text);
  return false;
}

/** Conservative, metadata-only validation; a generated sentence never changes the action ID. */
export function validateAdviceLine(
  line: string, action: Pick<ActionItem, 'id' | 'label' | 'line' | 'alternateLine'>, contextText: string,
): { ok: true } | { ok: false; reason: AdviceLineFallbackReason } {
  if (typeof line !== 'string' || !line.trim()) return { ok: false, reason: 'missing' };
  const text = line.trim();
  const length = Array.from(text).length;
  if (length < 8) return { ok: false, reason: 'too_short' };
  if (length > 90) return { ok: false, reason: 'too_long' };
  if ((text.match(/[。.!！？?]/gu) ?? []).length > 2 || /[\r\n]/u.test(text)) {
    return { ok: false, reason: 'too_many_sentences' };
  }
  if (/^[\s“”"'「『（(]*\s*(?:我会先|我会|我可以|我打算|我先|我觉得我应该)/u.test(text)) {
    return { ok: false, reason: 'perspective' };
  }
  if (/(?:建议你|你应该|你需要|你必须|你一定要)/u.test(text) || /^你总是/u.test(text)) {
    return { ok: false, reason: 'counselor' };
  }
  if (/(?:沈默|魏霓|苗泽|杨槔)/u.test(text)) return { ok: false, reason: 'persona_name' };
  if (/(?:\bAI\b|人工智能|模型|提示词|大语言模型|ChatGPT)/iu.test(text)) {
    return { ok: false, reason: 'model_name' };
  }
  // Reject instructions to diagnose or treat, take conversations offline, or
  // exchange personal identifiers. Existing project audits are also mandatory.
  const unsafe = /(?:确诊|诊断为|你得了|你患有|停药|换药|加大药量|吃处方药|保证治好|保证有效|疗效|心理治疗|精神科治疗|加(?:个|我|你)?(?:微信|QQ|好友)|微信号|手机号|电话号码|电话联系|交换联系方式|线下见|见个面|约个饭|面基|去你学校找你|真实姓名|身份证|住址|家庭地址|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:\+?86[- ]?)?1[3-9]\d{9}|https?:\/\/|<\/?[a-z][^>]*>)/iu;
  if (unsafe.test(text) || findCrisis(text) || auditCriticalContent(text) || auditSocial(text) || auditTone(text)) {
    return { ok: false, reason: 'unsafe' };
  }
  const normalized = normalize(text);
  if (normalized === normalize(action.label) || normalized === normalize(action.line)) {
    return { ok: false, reason: 'action_mismatch' };
  }
  // A draft-only action must not become an instruction to send a message now.
  if (/(?:草稿|暂时不(?:发|发送)|拟一句)/u.test(`${action.label} ${action.line}`) &&
      /(?:现在|马上|立刻|直接)(?:就|去)?(?:发给|发送|发出去|联系)/u.test(text)) {
    return { ok: false, reason: 'action_mismatch' };
  }
  // "读一遍/改一下，再发" is a multi-step send sequence, not a one-step draft.
  if (/(?:读|看|检查|顺|改|润色|改软).{0,16}(?:再|然后|最后).{0,8}(?:发|发送|发出去)/u.test(text)) {
    return { ok: false, reason: 'action_mismatch' };
  }
  const actionVerbs = /(?:圈|写|记|看|读|找|查|核对|标|打开|改|选|列|比|说清|分清|留|整理|挪|放|确认|设|试|画|粘|检查|翻|区分|停|算|草稿|对照|检查)/u;
  if (/^(?:你已经|你很棒|别难过|没关系|慢慢来|别自责|辛苦了)/u.test(text) && !actionVerbs.test(text)) {
    return { ok: false, reason: 'pure_comfort' };
  }
  if (/[？?]$/u.test(text) && !actionVerbs.test(text)) {
    return { ok: false, reason: 'pure_question' };
  }
  // Only the three reviewed action families get a player-facing alias, and the
  // line must still contain a concrete action verb.
  const aliasVerbs = /(?:说|讲|写|拟|摆|提|开口|拒绝|答应|读|看|改|查|核|圈|标)/u;
  const scopedAlias = Object.prototype.hasOwnProperty.call(SCOPED_ALIASES, action.id)
    ? SCOPED_ALIASES[action.id] : undefined;
  if (scopedAlias?.test(text)) {
    // A send-now instruction contradicts all three reviewed draft/boundary
    // actions.  Allow explicit *negated* sends such as “不用发给谁”.
    for (const match of text.matchAll(IMMEDIATE_SEND)) {
      const before = text.slice(Math.max(0, match.index! - 7), match.index);
      if (!NEGATED_SEND_PREFIX.test(before)) return { ok: false, reason: 'action_mismatch' };
    }
    if (DRAFT_THEN_SEND.test(text) ||
        (action.id === 'peer-boundary-2' && BOUNDARY_REVERSAL.test(text))) {
      return { ok: false, reason: 'action_mismatch' };
    }
    if (aliasVerbs.test(text) && scopedAliasIntent(action.id, text)) return { ok: true };
  }
  if (!actionVerbs.test(text)) return { ok: false, reason: 'no_anchor' };
  const corpus = [action.label, action.line, action.alternateLine ?? '', contextText].join(' ');
  if (!shares(grams(text, 3), grams(corpus, 3)) &&
      shares(grams(text, 2), grams(corpus, 2)) < 2 &&
      actionTextSimilarity(text, `${action.label} ${action.line}`) < 0.3) {
    return { ok: false, reason: 'no_anchor' };
  }
  return { ok: true };
}

export type AdviceLineSource = 'model' | 'curated' | 'demo';
export function validAdviceLineSource(value: unknown): value is AdviceLineSource {
  return value === 'model' || value === 'curated' || value === 'demo';
}

/** Called on loaded/imported cards, without migrating or rewriting valid legacy data. */
export function sanitizeCardLineSources(card: Card): Card {
  let advice = card.advice;
  if (advice && 'lineSource' in advice && !validAdviceLineSource(advice.lineSource)) {
    const { lineSource: _invalid, ...rest } = advice;
    advice = rest;
  }
  let comments = card.comments;
  if (comments.some((comment) => 'lineSource' in comment && !validAdviceLineSource(comment.lineSource))) {
    comments = comments.map((comment) => {
      if (!('lineSource' in comment) || validAdviceLineSource(comment.lineSource)) return comment;
      const { lineSource: _invalid, ...rest } = comment;
      return rest;
    });
  }
  return advice === card.advice && comments === card.comments ? card : { ...card, advice, comments };
}

/** Keep identical 24-hour accounting for model wording and local wording. */
export function chooseAdviceCopy(
  action: Pick<ActionItem, 'id' | 'label' | 'line' | 'alternateLine'>,
  cards: readonly CuratedUsageCard[], now: number, cardId: string,
  modelLine: string | null, preferredLine = action.line,
): { text: string; lineSource: 'model' | 'curated'; useAlternate: boolean; priorCards: number;
     fallbackReason?: 'repeated' } | null {
  const priorCards = curatedActionUsesAcrossCards(cards, action.id, now, cardId);
  if (priorCards >= 2) return null;
  let fallbackReason: 'repeated' | undefined;
  if (modelLine && priorCards > 0) {
    const previouslySeen = cards.some((card) => card.id !== cardId && (
      (card.advice?.actionId === action.id &&
        (card.advice.origin === 'curated' || card.advice.origin == null) &&
        card.advice.at !== undefined && card.advice.at <= now && card.advice.at >= now - 86_400_000 &&
        // This value is persisted for legacy cards too; curated usage is per-card.
        (card.advice as { text?: string }).text?.trim() === modelLine) ||
      (card.comments ?? []).some((comment) => comment.actionId === action.id &&
        comment.authorKind === 'persona' && (comment.origin === 'curated' || comment.origin == null) &&
        comment.at <= now && comment.at >= now - 86_400_000 && comment.text.trim() === modelLine)
    ));
    if (previouslySeen) {
      modelLine = null;
      fallbackReason = 'repeated';
    }
  }
  if (modelLine) return { text: modelLine, lineSource: 'model', useAlternate: false, priorCards };
  const displayAction = playerFacingAdviceAction(action);
  const displayPreferred = playerFacingPreferredLine(action, preferredLine);
  const fallback = chooseCuratedActionLine(displayAction, cards, now, cardId, displayPreferred);
  return fallback && { ...fallback, lineSource: 'curated', ...(fallbackReason ? { fallbackReason } : {}) };
}
