/** Conservative reply-only guards for claims about the user.
 * They cannot prove support for an arbitrary topic; they only catch explicit
 * field labels and comparison phrases that must be grounded in current text. */

const USER_FIELDS = [
  '金融', '经济', '会计', '计算机', '软件', '医学', '临床', '护理', '法学',
  '土木', '机械', '电气', '数学', '物理', '化学', '生物', '中文', '英语',
  '新闻', '教育', '艺术', '设计', '管理', '市场', '统计', '心理', '历史',
  '哲学', '建筑', '材料', '自动化', '通信', '电子', '环境', '农学', '药学',
  '口腔', '中医', '人力资源', '广告', '传媒',
] as const;

const FIELD_CLAIM = new RegExp(
  `(?:你|您)(?:们)?(?:现在|目前|本科|肯定|应该|估计|可能|大概|就是|是|学的是|读的是|做的是|学|读|做|搞|在){0,4}(${USER_FIELDS.join('|')})(?:的)?(?:专业|方向|行业|岗位|类|圈|院|系)`,
  'gu',
);
const GRADE_CLAIM = /(?:你|您)(?:们)?(?:(?![你您]|朋友|同学|室友|导师|老师|家人|同事|对象|男友|女友|哥哥|姐姐|弟弟|妹妹).){0,6}?(大[一二三四]|研[一二三]|博[一二三四])/gu;
const SELF_PREFIX = '(?:我|本人)(?:现在|目前|最近|本科|研究生|已经|今年|刚|一直|每天|还在|正在|总是|在){0,4}';
const FIELD_SOURCE = new RegExp(`^${SELF_PREFIX}(?:是|学的是|读的是|做的是|学|读|做|搞|在|的)?(${USER_FIELDS.join('|')})(?:的)?(?:专业|方向|行业|岗位|类|圈|院|系)?(?:的)?(?:学生|本科生|研究生|毕业|实习|工作)?$`, 'u');
const GRADE_SOURCE = new RegExp(`^${SELF_PREFIX}(?:是|读|上|在读)?(大[一二三四]|研[一二三]|博[一二三四])(?:的|了|学生)?$`, 'u');
const BEHAVIOR_SOURCE = new RegExp(`^${SELF_PREFIX}(?:硬刷|猛刷|狂刷|死磕|刷题|刷新题)`, 'u');
const BEHAVIOR_CLAIM = /(?:你|您)(?:们)?(?:现在|一直|每天|还在|正在|总是|最近|在|都){0,4}(?:硬刷|猛刷|狂刷|死磕|刷题|刷新题)/gu;
const FALSE_AGENCY = /(?:我|俺)(?:可以|能|来|去|帮你|替你)(?:先)?(?:私聊|传话|联系|替你说|帮你说)/u;
// A capability/claim on behalf of the addressee, not an offer to draft a message.
const AGENCY_ON_BEHALF = /(?:我|俺)(?:可以|能够|能|会|来|去|先|现在|马上|这就|已经|刚刚|刚|准备|再|就){0,6}(?:帮你|替你|代你)(?:来|去|先|已经|刚刚|马上|直接){0,4}(?:私聊|传话|联系|发(?:一条|条|个|了)?消息|(?:跟|给|找)(?:你(?:的)?)?(?:导师|老师|室友|组员|同学|朋友|家人)(?:说|发消息|传话))/u;
const AGENCY_TO_CONTACT = /(?:我|俺)(?:可以|能够|能|会|来|去|先|现在|马上|这就|已经|刚刚|刚|准备|再|就){0,6}(?:(?:联系(?:了)?|私聊(?:了)?|找)(?:你(?:的)?)(?:导师|老师|室友|组员|同学|朋友|家人)|(?:跟|给)(?:你(?:的)?)(?:导师|老师|室友|组员|同学|朋友|家人)(?:说|发消息|传话|沟通|商量|问))/u;
const FATIGUE_CONTEXT = /累|困|没精神|睡不着|失眠|通勤|早八|熬夜/u;
const FATIGUE_COMPARISON = /(?:我|俺).{0,24}(?:都|也|还|就)(?:不好意思|哪敢|不敢|没资格|怎么好意思).{0,8}(?:喊累|说累|叫累|抱怨|嫌累)/u;
const FATIGUE_NEGATION = /(?:我|俺).{0,12}(?:这点|那点)?(?:累|辛苦|难).{0,6}(?:算(?:什么|啥)|不值一提|不算啥)/u;
const SELF_FATIGUE_CONTRAST = /(?:我|俺).{0,24}(?:宿舍|学校|上课|早八|地铁|公交|走路|站着|上班|通勤|熬夜|背|看|刷|学习|写).{0,12}(?:也|都|就|还|越.{0,4}越).{0,6}(?:累|困|没精神|睡不着|走神|犯困|发怵|犯怵|发麻|瘫|没劲|清醒|叹气)/u;
const FATIGUE_SELF_MIRROR = /(?:我|俺).{0,16}(?:也|都|就|还).{0,30}(?:熟|懂|一样|这样|同款|睡|困|累|昏|精神|点头|发麻|清醒|眼皮|打架|犯困)/u;
const MEDICAL_TOPIC = /(?:这|这个|这种|该)(?:病|疾病)|患者|病人/u;
const MEDICAL_CONTEXT = /病|疾病|患者|病人|医院|临床|医生/u;
const ACADEMIC_PADDING = /(?:硬套|套话|凑字数|凑一段|随便编一段|编.{0,8}(?:……|\.{3}|啊不是|不是，))/u;
const ACADEMIC_CONTEXT = /研究意义|开题|论文|综述|报告|作业/u;
const SENSITIVE_TOPIC = /关系|冷战|吵架|宿舍|室友|生活费|钱|不够|预算|开销|催|家里|考公/u;
// A listener's empathetic reaction is not a new personal episode. Keep the
// previous conservative self-focus rule for other first-person statements.
const LISTENER_EMPATHY = /(?:(?:看得|听得)(?:我|俺)(?:都|也)?(?:心疼|难受)|(?:我|俺)(?:听着|看着)(?:也|都)?(?:觉得|心疼|难受)|(?:我|俺)(?:也)?(?:觉得|能理解|理解|心疼))/gu;
const MINIMIZE_CONTEXT = /拿不出手|不满意|糟|不行|不好/u;
const MINIMIZE_REPLY = /(?:别人|大家|外人).{0,10}(?:觉得|看着).{0,8}(?:还行|不错|没那么差|没那么糟)/u;

const normalize = (text: string): string =>
  text.normalize('NFKC').replace(/[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '');

// Scope these checks to explicit, present-tense self-reports by the addressee.
// Preserve message/clause boundaries; a peer mentioning a field or a negative
// self-report is not positive evidence. This is deliberately not a general NLU parser.
const clauses = (text: string): string[] => text.split(/[\r\n，,。！？!?；;：:]+/u).map(normalize).filter(Boolean);
const positiveSelfReports = (text: string): string[] => {
  const reports: string[] = [];
  // Treat quoted or hypothetical speech as data, not self-identification.
  // A complete sentence containing a quotation is intentionally conservative.
  const unquoted = text.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|‘[^’]*’/gu, '\uFFFC');
  for (const raw of unquoted.match(/[^\r\n。！？!?；;]+[。！？!?；;]?/gu) ?? []) {
    const sentence = normalize(raw).replace(/[。！!；;]$/u, '');
    if (/[「」『』“”"‘’《》:：\uFFFC]/u.test(sentence) || /[？?吗么]$/u.test(sentence)) continue;
    let indirect = false;
    for (const part of sentence.split(/[，,]+/u)) {
      if (/^(?:如果|假如|假设|比如|例如|举例|听说|别人)/u.test(part) ||
          /(?:朋友|同学|室友|导师|老师|他|她|别人).{0,8}(?:说|问|写道)/u.test(part)) indirect = true;
      if (!indirect && !/^(?:我|本人)(?:现在|目前|最近|其实|原本|以前|一直|已经|在|还|也|都){0,5}(?:不|没|未|想|准备|考虑|打算|计划|可能|应该|希望)/u.test(part)) reports.push(part);
    }
  }
  return reports;
};

// A direct neutral yes/no question is not an assertion. Tag questions with
// "吧" or an asserted field elsewhere in the reply are still checked.
const neutralQuestion = (clause: string, pattern: RegExp): boolean => {
  const question = /[吗么]$/u.test(clause);
  if (!question) return false;
  const matches = [...clause.matchAll(pattern)];
  return matches.length === 1 && matches[0].index === 0 &&
    !/(?:肯定|一定|应该|估计|大概|可能|果然|显然|不是|难道)/u.test(clause) &&
    /^(?:的)?[吗么]$/u.test(clause.slice(matches[0][0].length));
};

export function replyContextForAuthor(
  target: { authorId: string; authorKind: string; text: string } | undefined,
  recent: readonly { authorId: string; authorKind: string; text: string }[],
): string {
  if (!target || target.authorKind === 'system') return '';
  return [target.text, ...recent.filter(message => message.authorId === target.authorId &&
    message.authorKind === target.authorKind).map(message => message.text)].join('\n');
}

export function replyAttributionProblem(text: string, context: string): string | null {
  const reply = normalize(text);
  const source = normalize(context);
  const reports = positiveSelfReports(context);
  const supportedFields = new Set(reports.map(part => FIELD_SOURCE.exec(part)?.[1]).filter(Boolean));
  const supportedGrades = new Set(reports.map(part => GRADE_SOURCE.exec(part)?.[1]).filter(Boolean));
  // Check every explicit claim, not just the first match. Split only on clause
  // boundaries; do not accept a tag question as evidence for a claim.
  for (const part of clauses(text)) {
    if (!neutralQuestion(part, FIELD_CLAIM)) {
      for (const field of part.matchAll(FIELD_CLAIM)) {
        if (!supportedFields.has(field[1])) return 'unsupported_user_field';
      }
    }
    if (!neutralQuestion(part, GRADE_CLAIM)) {
      for (const grade of part.matchAll(GRADE_CLAIM)) {
        if (!supportedGrades.has(grade[1])) return 'unsupported_user_field';
      }
    }
    if (!neutralQuestion(part, BEHAVIOR_CLAIM) && [...part.matchAll(BEHAVIOR_CLAIM)].length &&
        !reports.some(report => BEHAVIOR_SOURCE.test(report) && !/(?:才怪|个鬼|没有刷|并没刷|没刷|不刷|没在刷|不再刷)/u.test(report))) return 'unsupported_user_behavior';
  }
  if (FALSE_AGENCY.test(reply) || AGENCY_ON_BEHALF.test(reply) || AGENCY_TO_CONTACT.test(reply)) return 'false_agency';
  if (MINIMIZE_CONTEXT.test(source) && MINIMIZE_REPLY.test(reply)) return 'invalidating_reframe';
  if (SENSITIVE_TOPIC.test(source) && /(?:我|俺)/u.test(reply.replace(LISTENER_EMPATHY, '')) &&
      !/[你您]/.test(reply) && !/[?？]/.test(reply) &&
      !/(?:要不要|试试|可以|能不能|先发|先说|先问|发个|说一句|问一句|找他|找她|找对方|聊一句)/u.test(reply)) {
    return 'self_focus_replaces_topic';
  }
  if (MEDICAL_TOPIC.test(reply) && !MEDICAL_CONTEXT.test(source)) return 'unsupported_user_field';
  if (ACADEMIC_PADDING.test(reply) && ACADEMIC_CONTEXT.test(source)) return 'academic_padding';
  if (FATIGUE_COMPARISON.test(reply) || FATIGUE_NEGATION.test(reply) ||
      (FATIGUE_CONTEXT.test(source) && (SELF_FATIGUE_CONTRAST.test(reply) || FATIGUE_SELF_MIRROR.test(reply)))) return 'invalidating_fatigue_comparison';
  return null;
}
