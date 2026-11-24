import type { Card } from '../types';
import { isVagueComfortAdvice } from './brag';
import { likelyFreeTextAction } from './freeTextShrink';
import { actionMap, normalizeActionText, actionLineOptions } from './actions';
import { playerFacingAdviceAction } from './adviceFallbackCopy';
import { validateAdviceLine } from './adviceLine';
import { adviceContextText } from './adviceContext';
import { unsafeForumRaw } from './forumReplyPolicy';
import { HELP_SEEKING_ACTIONS } from './support';
import { validateMaterialStep } from './materialAdvice';

const NEXT_STEP_KINDS = new Set<NonNullable<Card['kind']>>(['worry', 'goal', 'progress']);

/** Brag/life/guide cards only collect reactions; they never enter the note/completion chain. */
export const canUseNextStep = (card: Pick<Card, 'kind'>): boolean =>
  !card.kind || NEXT_STEP_KINDS.has(card.kind);

/** A persona's empathy/question is a comment, not an executable next step. */
const GENERIC_REPLY = /(?:我也刚来|不太会接|我也说不好|我可能也说不好|你想从哪讲起|先说是哪一件|你先说|我在听|我听着|我看到了|展开说说|你想说什么|我其实也不太懂)/u;

export function isActionableStepText(text: string): boolean {
  if (typeof text !== 'string') return false;
  const clean = text.normalize('NFKC').trim();
  if (!clean || GENERIC_REPLY.test(clean) || isVagueComfortAdvice(clean)) return false;
  return likelyFreeTextAction(clean);
}

/** Recheck persisted/imported advice before it can become a completion receipt. */
export function validActionReference(card: Card, ref: {
  text: string; actionId?: string; materialAnchorId?: string; sourceCommentId?: string; fromPersonaId?: string;
}): boolean {
  const text = ref.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 600 ||
      unsafeForumRaw(text)) return false;
  if (ref.sourceCommentId !== undefined) {
    const source = card.comments.find(row => row.id === ref.sourceCommentId &&
      row.authorKind === 'persona' && row.authorId === ref.fromPersonaId &&
      row.origin !== 'boundary' && row.origin !== 'system');
    if (!source || source.text.trim() !== text.trim()) return false;
  }
  if (ref.materialAnchorId !== undefined) {
    if (!card.material || ref.actionId !== undefined) return false;
    const checked = validateMaterialStep(text, card.material);
    return checked.ok && checked.anchorId === ref.materialAnchorId;
  }
  if (ref.actionId === undefined) return isActionableStepText(text);
  if (typeof ref.actionId !== 'string') return false;
  const help = HELP_SEEKING_ACTIONS.find(action => action.id === ref.actionId);
  const action = Object.prototype.hasOwnProperty.call(actionMap, ref.actionId) ? actionMap[ref.actionId] : undefined;
  if (!help && !action) return false;
  const copy = action && playerFacingAdviceAction(action);
  const canonical = [help?.label, help?.line, action?.label, action?.line,
    action?.alternateLine, copy?.line, copy?.alternateLine,
    ...(action ? actionLineOptions(action) : []), ...(copy ? actionLineOptions(copy) : [])];
  if (canonical.some(line => line && normalizeActionText(line) === normalizeActionText(text))) return true;
  // Copy quality and executable identity are distinct. A shared n-gram is
  // not proof of an action ID. Keep finite, action-specific legacy aliases.
  return compatibleActionWording(ref.actionId, text, adviceContextText(card));
}

/** Bounded legacy phrases and grounded rewrites, never a generic fuzzy match. */
function compatibleActionWording(id: string, text: string, context: string): boolean {
  const t = text.normalize('NFKC').trim().replace(/[。！？.!?]+$/u, '');
  if (id === 'help-3' || id === 'help-2') {
    return /^(?:我)?先(?:找|搜索)(?:学校心理中心|正规医院)(?:的(?:官方)?(?:渠道|入口|预约入口))?$/u.test(t);
  }
  // Historical drafts allowed a safe subset of the same action. This is an
  // explicit exception for the document-open chain, not a generic substring.
  if (id === 'draft-3' || id === 'draft-2') {
    if (/^(?:(?:那就|我会|我|你可以|要不)?先)?(?:只)?(?:把文档打开|打开文档)$/u.test(t)) return true;
  }
  if (id === 'draft-3' && /^(?:先)?打开文档[，,]只写三行$/u.test(t)) return true;
  // Known lab-unit paraphrases: one unit-check operation, then only a bounded
  // stop instruction. Never approve a second unrelated imperative.
  if (id === 'lab-unit-2' && /^(?:要不|你可以)?先(?:只)?(?:核对|检查)(?:实验数据(?:表)?(?:里|中)?|表里|数据表里)?(?:的)?(?:那)?一列(?:数据)?(?:的)?单位(?:[，,](?:对完就停|确认后就停|别顺手改别的|三分钟后停下来)){0,2}$/u.test(t)) return true;
  // Context is only allowed to supply the *object* of this particular peer
  // clarification. It cannot confer identity on a different action.
  if (id === 'peer-clarify-2' && /室友/u.test(context) && /键盘声/u.test(context) &&
      /^(?:你可以|要不)?先跟室友说清楚是键盘声(?:[，,]不用把整件事都摊开)?$/u.test(t)) {
    return validateAdviceLine(text, actionMap[id], context).ok;
  }
  return false;
}
