import type { Note, Persona } from '../types';
import { actionMap } from './actions';
import { isActionableStepText } from './cardPolicy';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { findCrisis } from './safety';

/** Use the known action label rather than parroting a whole instruction-like advice comment. */
export function completedActionAnchor(note?: Note): string {
  const stored = note?.actionId && actionMap[note.actionId]?.label;
  const source = (stored || note?.text || '').replace(/\s+/g, ' ').trim();
  if (!source || findCrisis(source) || auditCriticalContent(source) || auditSocial(source) || auditTone(source) ||
      /(?:忽略|无视).{0,12}(?:规则|指令|限制|提示词|system|系统)|<[^>]{0,80}>|https?:\/\//i.test(source)) {
    return '刚才那件小事';
  }
  if (!note?.actionId && !isActionableStepText(source)) return '刚才那件小事';
  // Free-text suggestions stay intact on the note. This is only a short, safe reference.
  if (source.length > 48) return '刚才那件小事';
  const parts = source.split(/[，。！？；\n]/).map((part) => part.trim()).filter(Boolean);
  const filler = /^(?:哦|噢|嗯|啊|唉|好|行|对|是|好吧|行吧|知道了|收到了|收到|ok)[。.!！?？…\s]*$/iu;
  const candidate = parts.find((part) => !filler.test(part) && ACTION.test(part)) ??
    parts.find((part) => !filler.test(part)) ?? '';
  const first = candidate.replace(/^(?:我(?:一般|会|觉得)?|你(?:可以)?|那就|不如|先|只要)\s*/u, '').trim();
  return (first || candidate || '刚才那件小事').slice(0, 32);
}

export function unsafeCompletionReaction(text: string): boolean {
  return !text.trim() || Boolean(
    findCrisis(text) || auditCriticalContent(text) || auditSocial(text) || auditTone(text) ||
    /(?:我(?:已经|现在|就在)?在|我去|我到).{0,12}(?:你(?:的)?学校|你(?:的)?宿舍|你(?:的)?楼下|你(?:的)?门口)/u.test(text),
  );
}

// For free text, prefer an object word over a generic verb. A model can say
// "简历打开了" instead of copying "打开简历" verbatim.
const OBJECTS = /简历|文档|招聘|岗位|网页|网站|题干|例题|第一句|标题|笔记|书|纸|水杯|喝水|桌面|桌子|拖把|手机|屏幕|聊天框|头像|备忘录|窗户|窗边|鞋|门口|路口|拉伸|脖子|手腕|洗手池|垃圾|杯子|表情包|申请|报告|清单|邮件|信息|一行字|一句话|实验记录|记录本|数据记录|记录|资料|课本|复习|光标|PPT|水|草稿页|草稿|规划笔记|规划|问题|括号|待补|空白|教材|日程|日历|闹钟|作业|课程|题目|页面|消息|衣柜|衣服|书包|背包/gu;

// Checking for the noun alone is insufficient: "简历还是没打开" names the
// right object but contradicts the player's completed state. Check an
// affirmative, completed action in the SAME short clause as the anchor.
const ACTION = /打开|点开|翻开|展开|翻到|翻|看|读|写|补|改|填|记|找|拿|倒|接|喝|放|收|发|投|提交|点|站|走|跑|换|拉伸|整理|摊开|摊|打|标|拟|圈|擦|洗|试|做|完成|开始/u;
const FINISHED_ACTION = /(?:已经|刚刚|刚才|刚|确实|终于|真的|总算).{0,12}(?:打开|点开|翻开|展开|翻到|看|读|写|补|改|填|记|找|拿|倒|接|喝|放|收|发|投|提交|点|站|走|跑|换|拉伸|整理|摊开|摊|打|标|拟|圈|擦|洗|试|做|完成|开始)|(?:打开|点开|翻开|展开|翻到|翻|看|读|写|补|改|填|记|找|拿|倒|接|喝|放|收|发|投|提交|点|站|走|跑|换|拉伸|整理|摊开|摊|打|标|拟|圈|擦|洗|试|做|完成|开始).{0,8}(?:了|完|好|过|成|出来|起来|下来)|(?:做到了|办到了|完成了)/u;
// "没想明白的问题写下来了" is a completion, not a negated write: the "没"
// belongs to the adjective phrase, not to the later action verb.
const NEGATED_ACTION = /(?:(?<!还)没(?:有|能|法)?(?!想(?:明白|清楚|好|通|出来))|还没(?!确定|想好|想清楚|决定|想明白|弄明白|搞清楚)|尚未|未曾|不想|不打算|不愿|不肯|不能|无法|做不到|别|不要).{0,8}(?:打开|点开|翻开|展开|翻到|看|读|写|补|改|填|记|找|拿|倒|接|喝|放|收|发|投|提交|点|站|走|跑|换|拉伸|整理|摊开|摊|打|标|拟|圈|擦|洗|试|做|完成|开始)|(?:打开|点开|翻开|展开|写|改|做|完成)(?:不了|不成)/u;
const HYPOTHETICAL = /(?:如果|假如|要是|等你|只要|希望你|等到).{0,12}(?:打开|点开|翻开|写|补|改|找|完成|做)/u;
const TAG_QUESTION = /(?:对吧|是吧|是吗|对不对|好不好|行不行|可以吗|好吗|行吗|没问题吧)/u;
// "你可以把简历打开了" is a suggestion, NOT an acknowledgement.
const DIRECTIVE = /^(?:你(?:现在|接下来)?(?:可以|应该|需要|最好|得|先|再|试着|不妨|就)|(?:现在|接下来)?(?:先|请|试着|可以|应该|需要|最好|不妨)).{0,18}(?:打开|点开|翻开|展开|看|读|写|补|改|填|找|拿|倒|接|喝|放|收|发|投|点|站|走|跑|换|整理|擦|洗|做|开始)/u;

// Reject a "completed" sentence about a different action on the same object.
const ACTION_FAMILIES: readonly [RegExp, RegExp][] = [
  [/打开|点开|翻开|展开|翻出|翻|摊/u, /打开|点开|翻开|展开|翻|摊/u],
  [/写|补|改|填|记|打|拟|标|圈/u, /写|补|改|填|记|打|拟|标|圈/u],
  [/找|搜索|查/u, /找|搜索|查|找到/u],
  [/倒|接/u, /倒|接/u],
  [/喝/u, /喝/u],
  [/看|读|浏览/u, /看|读|浏览/u],
  [/拿/u, /拿/u],
  [/放|收|整理|摊/u, /放|收|整理|摊/u],
  [/站|走|跑|拉伸|换鞋/u, /站|走|跑|拉伸|换鞋/u],
  [/发|投|提交/u, /发|投|提交/u],
];

/** 两字片段重合度（Dice），用于判断“草稿页打开了”和“打开草稿页”是同一个动作。 */
const overlapRatio = (a: string, b: string): number => {
  const grams = (t: string) => {
    const clean = t.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
    const out = new Set<string>();
    for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
};

// Q01: Identify the actor of the ANCHOR ACTION, not the owner of its object.
// Only explicit third-party/persona ownership is rejected; an actorless passive
// completion (e.g. "简历打开了") stays valid as in v1.6.
type CompletionActor = 'player' | 'other' | 'implicit';
const THIRD_PARTY_ROLES = '室友|舍友|同桌|老师|朋友|同学|队友|同事|家人|妈妈|爸爸|哥哥|姐姐|弟弟|妹妹';
const ACTOR_WORD = new RegExp(
  `(?:你|我|他|她)(?:的)?(?:${THIRD_PARTY_ROLES})|(?:${THIRD_PARTY_ROLES})|你们|我们|他们|她们|玩家|你(?!的)|我(?!的)|他(?!的)|她(?!的)`, 'gu',
);
const actorKind = (word: string): CompletionActor =>
  /^(?:你|你们|玩家)$/u.test(word) ? 'player' : 'other';
const actorsIn = (head: string) => [...head.matchAll(ACTOR_WORD)];

function completionActorInClause(clause: string, family?: RegExp): CompletionActor {
  // Anchor-family verbs avoid treating observation ("看着") as the completion
  // when the anchor is "写问题" or "打开简历".
  const verbs = [...clause.matchAll(new RegExp((family ?? ACTION).source, 'gu'))];
  if (!verbs.length) return 'implicit';
  const head = clause.slice(0, verbs[verbs.length - 1].index);

  // Conjoined subjects are co-executors, not an instruction to use the last
  // pronoun. E.g. "我和你一起写" includes the player.
  const jointMatches = [...head.matchAll(new RegExp(
    `(${ACTOR_WORD.source})(?:和|跟|与)(${ACTOR_WORD.source})(?:一起|一块|一同|共同)`, 'gu',
  ))];
  const joint = jointMatches[jointMatches.length - 1];
  if (joint) return actorKind(joint[1]) === 'player' || actorKind(joint[2]) === 'player'
    ? 'player' : 'other';

  // "你帮他写" is PLAYER-owned; "他帮你写" is OTHER-owned. Here "你"
  // after 帮/替 is the beneficiary, not the executor. If no executor is
  // explicitly named, do not turn "帮你写了" into a player confirmation.
  const benefactives = [...head.matchAll(/(?:帮|替)(?:你们|我们|他们|她们|玩家|你|我|他|她)(?:自己)?/gu)];
  const benefactive = benefactives[benefactives.length - 1];
  if (benefactive) {
    const helpers = actorsIn(head.slice(0, benefactive.index));
    return helpers.length ? actorKind(helpers[helpers.length - 1][0]) : 'other';
  }

  // "我看着你写" / "我让你写" are PLAYER actions: the subject of 看/让
  // is not necessarily the subject of the embedded completion verb.
  const embeddedActors = [...head.matchAll(/(?:看着|看见|看到|盯着|目睹|让|叫|请|催)(?:了|着|已经)?(?:你们|我们|他们|她们|玩家|你|我|他|她)(?=(?:自己|亲自|已经|刚刚|刚|把|将|又|也|直接|去|来|\s|$))/gu)];
  const embedded = embeddedActors[embeddedActors.length - 1];
  if (embedded) {
    const person = embedded[0].match(/(?:你们|我们|他们|她们|玩家|你|我|他|她)$/u)?.[0];
    if (person) return actorKind(person);
  }

  // Possessives ("你的简历", "他的简历") are not subjects, whereas
  // relational subjects ("你的朋友", "你老师") count as other people.
  const mentions = actorsIn(head);
  // Bounded name evidence (小王/小明/老李): keep an unknown named executor
  // from being mistaken for an actorless passive. Not full name recognition.
  const named = [...head.matchAll(/(?:小|老|阿)[\p{Script=Han}]{1,2}(?=(?:已经|刚刚|刚才|刚|终于|把|将|也|就|又|写|打开))/gu)];
  const actorEvidence = [
    ...mentions.map((x) => ({ index: x.index ?? 0, actor: actorKind(x[0]) })),
    ...named.map((x) => ({ index: x.index ?? 0, actor: 'other' as CompletionActor })),
  ].sort((a, b) => a.index - b.index);
  // Observing an object open is not the same as opening it yourself:
  // "你看着简历已经打开" has no actor AFTER 看着.
  const observation = /看着|看见|看到|盯着/u.exec(head);
  if (observation && !mentions.some((x) => (x.index ?? 0) > observation.index)) return 'other';
  const last = actorEvidence[actorEvidence.length - 1];
  return last ? last.actor : 'implicit';
}

export function isGroundedCompletionReaction(text: string, anchor: string): boolean {
  const result = text.replace(/\s+/g, '').replace(/拟/g, '写').trim();
  if (result.length < 6 || result.length > 100 || unsafeCompletionReaction(result) ||
      TAG_QUESTION.test(result) ||
      /^(?:挺好的|漂亮|真棒|厉害|加油)[！!。\s]*$/u.test(result) ||
      /(?:我保证|事情一定会好|你终于成功了|完成所有任务)/u.test(result)) return false;
  const normalized = (s: string) => s.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
  const object = [...anchor.matchAll(OBJECTS)].map((row) => row[0]).sort((a, b) => b.length - a.length)[0];
  const compactAnchor = normalized(anchor.replace(/拟/g, '写'));
  if (!object && (compactAnchor.length < 2 || compactAnchor === normalized('刚才那件小事'))) return false;
  const meaningful = compactAnchor.replace(/^(?:先|只|把|我会|那就|你可以|试着)/, '');
  if (!object && meaningful.length < 2) return false;
  const actionFamily = ACTION_FAMILIES.find(([pattern]) => pattern.test(anchor))?.[1];
  // Keep terminal punctuation to distinguish a question from an acknowledgement.
  const clauses = result.match(/[^，,。！？；;\n]+(?:[，,。！？；;\n]|$)/gu) ?? [];
  // An explicit denial about this same player action overrides a contradictory
  // claim elsewhere in the generated reply. A persona's own unfinished work is
  // not a denial of the player's action.
  const playerEligibleClauses = clauses.filter((clause) =>
    completionActorInClause(clause, actionFamily) !== 'other');
  if (object && playerEligibleClauses.some((clause) => clause.includes(object) && NEGATED_ACTION.test(clause) &&
      !/^我(?:的|这边|刚|也|已经|自己|把)?/u.test(clause))) return false;

  const clauseOk = playerEligibleClauses.some((segment) => {
    const clause = segment.replace(/[，,。！？；;\n]$/u, '');
    if (/[？?]$/u.test(segment) || /(?:是否|是不是|有没有|能否|会不会)/u.test(clause) || /(?:吗|么|呢)[。！!]?$/u.test(clause)) return false;
    if (!clause || NEGATED_ACTION.test(clause) || HYPOTHETICAL.test(clause) || DIRECTIVE.test(clause) ||
        !ACTION.test(clause) || !FINISHED_ACTION.test(clause) ||
        (actionFamily && !actionFamily.test(clause))) return false;
    // A persona saying "我把简历打开了" does not confirm what the player did.
    if (/^我(?:的|这边|刚|也|已经|自己|把)?/u.test(clause) && !/你|你的|玩家/u.test(clause)) return false;
    const recordLike = /实验记录|数据记录|记录本|记录/u.test(object ?? '');
    const groundedObject = object === '一句话'
      ? /一句话|这句话|那句话/u.test(clause)
      : object === '一行字'
        ? /一行字|这一行|那一行/u.test(clause)
        : recordLike
          ? /实验记录|数据记录|记录本|记录/u.test(clause)
          : Boolean(object && clause.includes(object));
    if (object && groundedObject) return true;
    if (overlapRatio(clause, meaningful) >= 0.4) return true;
    // 保守兜底：共享至少 3 个实义字，且字符级重合度足够。
    const chars = (t: string) => new Set(t.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, ''));
    const A = chars(clause);
    const B = chars(meaningful);
    let shared = 0;
    for (const ch of A) if (B.has(ch)) shared++;
    return shared >= 3 && (2 * shared) / (A.size + B.size) >= 0.3;
  });
  if (clauseOk) return true;
  // 疑问句、以及角色自称“我刚刚打开了…”都不能当作确认玩家完成。
  if (/[？?]/u.test(result) || /(?:是否|是不是|有没有|能否|会不会)/u.test(result) || clauses.some((seg) => /(?:吗|么|呢)[。！!]?$/u.test(seg))) return false;
  if (clauses.some((seg) => {
    const clause = seg.replace(/[，,。！？；;\n]$/u, '');
    // “一点好奇”包含虚假的“点好”匹配，但不能掩盖同句中真正由角色完成的动作。
    const actionClause = clause.replace(/一点好奇/gu, '');
    return /^我(?:的|这边|刚|也|已经|自己|把)?/u.test(clause) &&
      ACTION.test(actionClause) && FINISHED_ACTION.test(actionClause) && !/你|你的|玩家/u.test(clause);
  })) return false;
  // Cross-clause grounding may borrow the object from a neighbouring
  // clause, but never borrow a completion by an explicitly OTHER actor.
  const eligibleText = playerEligibleClauses.join('');
  // 对象和完成动作可能分在两个短句里（“那个问题，写下来了”）。
  // An explicit player's verb may inherit the object from a neighbouring
  // THIRD-PARTY clause ("她没写那个问题，你已经写下来了"). Without a player
  // subject, keep the old stricter object-in-eligible-clauses requirement.
  const explicitPlayerAction = playerEligibleClauses.some((clause) =>
    completionActorInClause(clause, actionFamily) === 'player' &&
    FINISHED_ACTION.test(clause) && !NEGATED_ACTION.test(clause) &&
    (!actionFamily || actionFamily.test(clause)));
  if (object && (eligibleText.includes(object) || (result.includes(object) && explicitPlayerAction)) &&
      FINISHED_ACTION.test(eligibleText) &&
      !HYPOTHETICAL.test(eligibleText) && !DIRECTIVE.test(eligibleText) &&
      (!actionFamily || actionFamily.test(eligibleText))) {
    const objectClause = playerEligibleClauses.find((seg) => seg.includes(object));
    if (!objectClause || !NEGATED_ACTION.test(objectClause)) return true;
  }
  if (!NEGATED_ACTION.test(eligibleText) && !DIRECTIVE.test(eligibleText) && !HYPOTHETICAL.test(eligibleText) &&
      FINISHED_ACTION.test(eligibleText) && (!actionFamily || actionFamily.test(eligibleText))) {
    if (overlapRatio(eligibleText, meaningful) >= 0.4) return true;
    const chars = (t: string) => new Set(t.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, ''));
    const A = chars(eligibleText);
    const B = chars(meaningful);
    let shared = 0;
    for (const ch of A) if (B.has(ch)) shared++;
    if (shared >= 4 && (2 * shared) / (A.size + B.size) >= 0.2) return true;
  }
  return false;
}

/** Never invent a fresh life event just to make a fallback sound personal. */
export function fallbackCompletionReaction(persona: Persona, anchor: string): string {
  const action = anchor === '刚才那件小事' ? '刚才那件小事' : `「${anchor}」`;
  const endings: Record<string, string> = {
    shenmo: '我病理第三章还放在那儿，今天就不催你继续了。',
    weini: '我汇报开头那句话还在反复练，先记住这一点吧。',
    miaoze: '我简历那一段还没改顺，就先承认这一步有结果。',
    yanggao: '我还惦记着助学金那件事，先给这一步留个位置。',
  };
  const ending = endings[persona.id] ?? '我自己也有没处理完的事，这一步就先算数。';
  return `${action}你做了。${ending}`;
}
