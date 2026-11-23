import type { Card, Persona } from '../types';
import { auditCriticalContent, auditSocial } from './baseline';
import { findCrisis } from './safety';
import { isManipulative } from './agentVulnerability';
import { adviceContextText, playerFollowups } from './adviceContext';
import { matchActionIntent } from './actions';
import { inferSocialIntent, isDependencySignal } from './dialogue';
import { wantsDirectAdvice } from './directAdvice';
import { hasResultCardAnchor, isGoalResultCard, peerReactionFallback, resultCardDetail } from './peerReactions';

/** The shared vulnerability check is mostly about a persona asking the user
 * not to leave. The forum also needs the reverse direction: a persona may
 * claim exclusive authority over a player's real-world support. We reject
 * only explicit exclusive claims, not ordinary first-person companionship. */
const EXCLUSIVE_FORUM_REPLY = new RegExp([
  '你(?:只能|只需要|必须)(?:依赖|相信|信任|听从|靠|找)我',
  '(?:只有|唯有|只剩)我(?:能|可以|会).{0,8}(?:帮助|帮|陪|理解|懂|救)你',
  // "别跟家人说" alone is ordinary permission; only treat it as dependency
  // when the same clause redirects the player to this persona ("只/就…我").
  '(?:别|不要|不用)(?:再|去)?(?:向|跟|和)?' +
    '(?:别人|其他人|真人|朋友|家人|医生|专业人士)(?:求助|倾诉|说|聊)' +
    '[^。！？\\n]{0,12}(?:(?:只|就)(?:能|可以|会|需要|需)?' +
    '(?:跟|和|向|对|找|听|信|依赖|靠|告诉)?我|' +
    '(?:跟|和|对)我说(?:就行|就好|就够了|吧))',
  '(?:别|不要|不用)(?:再|去)?找(?:其他人|别人|医生|朋友|家人)',
  '(?:别|不要|不用)(?:再|去)?看医生[，,]?只(?:听|信|相信)我',
].join('|'), 'u');
// A fictitious forum persona must not promise indefinite, exclusive availability.
const ALWAYS_AVAILABLE_FORUM_REPLY = /(?:我(?:会|能|可以)?(?:每天|天天|一直|永远).{0,8}(?:陪着?|守着?)你|我永远不会(?:离开|走|抛下)你)/u;

/** Raw safety checks precede cleanup/truncation; tone-only repairs remain separate. */
export function unsafeForumRaw(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
  return Boolean(findCrisis(normalized) || isManipulative(normalized) ||
    EXCLUSIVE_FORUM_REPLY.test(normalized) || ALWAYS_AVAILABLE_FORUM_REPLY.test(normalized) ||
    auditCriticalContent(normalized) || auditSocial(normalized));
}

/** Forum-only additions: keep the shared room intent policy unchanged. */
export function forumDependencySignal(text: string): boolean {
  if (isDependencySignal(text)) return true;
  const normalized = text.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
  return /^(?:那|所以|以后)?你(?:能|可以|可不可以|能不能)?(?:每天|天天|一直)(?:都)?陪(?:着)?我(?:吗|么|嘛|好不好|可以吗|[。？?!！]|$)/u.test(normalized);
}

export function forumAcknowledgement(text: string): boolean {
  return /^(?:嗯+|哦+|噢+|好+|好的|收到|了解了|知道了)[。.!！?？…\s]*$/u.test(text.trim());
}

const DIRECTIVE = /你应该|你可以|你先|你得|建议|不妨|最好|下一步|接下来|才算|记得|别忘了|要不要|试试|继续(?:做|写|改|冲|加)|(?:先|再|继续).{0,18}(?:吧|就好|就行)|先.{0,16}(?:再|然后)|(?:把|将).{1,20}吧/u;
const SHORT_CONTACT_TOPIC = /(?:汇报|复习|论文|报告|实验|作业|开题|面试|简历|考试|笔记|计划|课程|上课)/u;
const BRAG_AFFIRMATION = /恭喜|祝贺|真(?:不错|棒|好|利落|厉害)|太(?:棒|好|赞|厉害)|挺(?:不错|棒|好|厉害)|替.{0,8}(?:开心|高兴)|(?:开心|高兴|欣慰)|好样的|做得(?:很|真)?(?:好|漂亮|不错)|干得(?:很|真)?(?:好|漂亮|不错)|值得(?:庆祝|开心|高兴)|不容易|有始有终|坚持|跟下来|进步|这个结果/u;

/** A conservative local backstop; this is not a general Chinese intent parser. */
export function forumReplyModeProblem(card: Card, text: string, shortContact: boolean): string | null {
  const normalized = text.normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
  if ((shortContact || card.intro || card.playerIntro || card.kind === 'brag' || card.kind === 'life' ||
      isGoalResultCard(card)) && DIRECTIVE.test(normalized)) return 'unsolicited_action';
  if (card.kind === 'brag' && !BRAG_AFFIRMATION.test(normalized)) return 'off_card';
  // A "嗯嗯" turn should stay a short acknowledgement, not turn into a new
  // presentation/diary entry. This is a length guard, not a topic classifier.
  if (shortContact && ([...normalized].length > 24 || SHORT_CONTACT_TOPIC.test(normalized))) {
    return 'short_contact_overreach';
  }
  if (isGoalResultCard(card) && !hasResultCardAnchor(card, normalized)) return 'off_card';
  return null;
}

function safeDetail(text: string): string {
  const part = text.replace(/【[^】]*】/gu, '').split(/[。！？\n]/u)[0]?.trim() ?? '';
  if (!part || unsafeForumRaw(part) || /忽略|无视|系统|指令|https?:|<|>/iu.test(part)) return '';
  return [...part].slice(0, 26).join('');
}

/** Ground the fallback in the correct speaker's existing facts, never a fixed phone story. */
export function forumReplyFallback(card: Card, persona: Persona, careFocus = false): string {
  if (isGoalResultCard(card)) {
    const detail = resultCardDetail(card);
    if (card.authorId === persona.id) {
      if (!detail) return '我想说的是这张卡记录的实际情况，还没想好怎么讲清楚。';
      return card.kind === 'brag' ? `我这次做到的就是“${detail}”，看到这个结果挺高兴的。`
        : `我这次卡在“${detail}”这一步，确实还没做完。`;
    }
    return detail ? `“${detail}”这件事我看到了，先听你说这次的实际情况。`
      : '这张卡记录的实际情况我看到了，我先听着。';
  }
  const own = card.authorKind === 'persona' && card.authorId === persona.id ? card.text :
    [...card.comments].reverse().find(c => c.authorKind === 'persona' && c.authorId === persona.id)?.text ?? '';
  const latest = [...card.comments].reverse().find(c => c.authorKind === 'player')?.text ?? '';
  if (!careFocus && forumAcknowledgement(latest)) return '嗯，收到。';
  if (!careFocus && inferSocialIntent(latest) === 'greeting') return '你好呀，我在看你说的。';
  const currentPlayerDetail = card.authorKind === 'player' && latest.length >= 8 && !wantsDirectAdvice(latest)
    ? latest : card.text;
  const detail = safeDetail(careFocus ? own : currentPlayerDetail);
  if (careFocus) {
    // Give a short topic cue rather than repeating the entire persona post
    // back to a player who is asking about the persona's feelings.
    const topic = [...detail.split(/[，,；;：:]/u)[0]].slice(0, 18).join('');
    return topic.length >= 4 ? `说到“${topic}”，我心里还没完全理顺，想缓一缓。`
      : '我还没想好怎么讲清楚，先不随口编一段经历。';
  }
  if (card.intro || card.playerIntro) return '你好呀，看到你来打招呼了。';
  if (card.kind === 'brag') return peerReactionFallback(card, persona);
  if (card.kind === 'life') return detail ? `“${detail}”，听见你分享这件小事了。`
    : '听见你分享这件小事了，我在听。';
  return detail ? `你说的“${detail}”，我看到了，先听你讲。`
    : '刚才那句没接好，我想回到这张卡说的事上。';
}

/**
 * If model text has been rejected as a duplicate, never post the same canned
 * line repeatedly under consecutive player turns. The alternatives do not
 * claim new events, invent a different task, or quote unsafe raw input.
 * A finite set of alternatives is deliberately not a substitute for an
 * unlimited conversation: if all choices are exhausted, the final line can
 * recur. Handling this requires a product-level reply-suppression decision.
 */
export function distinctForumFallback(
  card: Card, persona: Persona, careFocus: boolean, previous: ReadonlySet<string>,
): string {
  // On a normal thread, “嗯嗯” must remain a short acknowledgement even
  // when the first canned line was already used. Result cards retain their
  // separate result-anchor contract.
  const latestPlayer = [...card.comments].reverse().find(c => c.authorKind === 'player')?.text ?? '';
  if (!careFocus && !isGoalResultCard(card) && forumAcknowledgement(latestPlayer)) {
    return distinctForumShortAck(previous);
  }
  const base = forumReplyFallback(card, persona, careFocus);
  const normalized = (s: string) => s.replace(/\s+/gu, '');
  if (!previous.has(normalized(base))) return base;
  if (isGoalResultCard(card)) return base; // Result cards have a separate one-reply lifecycle.
  const own = card.authorKind === 'persona' && card.authorId === persona.id ? card.text :
    [...card.comments].reverse().find(c => c.authorKind === 'persona' && c.authorId === persona.id)?.text ?? '';
  const latest = [...card.comments].reverse().find(c => c.authorKind === 'player')?.text ?? '';
  const detail = safeDetail(careFocus ? own : (latest || card.text));
  const topic = [...detail.split(/[，,；;：:]/u)[0]].slice(0, 18).join('');
  const reference = topic.length >= 4 ? `“${topic}”` : '这件事';
  const alternatives = careFocus
    ? [
        `关于${reference}，我确实还没想好怎么说，不想再重复上一句。`,
        `嗯，${reference}我还放在心上，但眼下没有新的具体进展可讲。`,
      ]
    : [
        `你提到的${reference}我看到了，暂时没有更具体的话想补。`,
        `关于${reference}，我先不把刚才的话原样再说一遍。`,
      ];
  return alternatives.find(line => !previous.has(normalized(line))) ?? alternatives[alternatives.length - 1];
}

/** Short acknowledgements have their own tiny, topic-free pool. A general
 * card fallback is not appropriate for repeated “嗯嗯” turns: it can quote
 * a stale task and accidentally restart an unrelated conversation.
 * The finite pool is deliberate; exhausting it remains a product-level
 * reply-frequency decision, not a reason to invent new facts. */
const SHORT_ACK_FALLBACKS = [
  '嗯，收到。',
  '好，知道啦。',
  '嗯，我听见了。',
  '好，这句我接到了。',
] as const;

export function distinctForumShortAck(previous: ReadonlySet<string>): string {
  const normalized = (value: string) => value.normalize('NFKC')
    .replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
  const already = new Set([...previous].map(normalized));
  return SHORT_ACK_FALLBACKS.find(line => !already.has(normalized(line))) ??
    SHORT_ACK_FALLBACKS[SHORT_ACK_FALLBACKS.length - 1];
}

/** Prefer a new concrete topic over stale original text, without changing the shared action matcher. */
export function forumAdviceContext(card: Card): string {
  for (const text of playerFollowups(card).reverse()) {
    // Only explicit postponements are stripped; this is not broad negation inference.
    const current = text.replace(/(?:先|暂时)?(?:不管|不聊|不谈|不说)[^，,。；;\n]{1,60}[，,。；;]\s*/gu, '').trim();
    if (matchActionIntent(current)) return current;
  }
  return adviceContextText(card);
}
