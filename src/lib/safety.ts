const selfHarmSignals = [
  '自杀',
  '自残',
  '自伤',
  '活不下去',
  '活着太累',
  '活够了',
  '想死',
  '去死',
  '轻生',
  '割腕',
  '跳楼',
  '跳河',
  '卧轨',
  '上吊',
  '烧炭',
  '开煤气',
  '喝农药',
  '结束生命',
  '结束自己',
  '了结自己',
  '一了百了',
  '活着没意思',
  '活着没意义',
  '活着没什么意思',
  '活着没啥意思',
  '活着好累',
  '活着没劲',
  '生无可恋',
  '不想醒来',
  '想消失',
  '消失算了',
  '不想存在',
  '没了算了',
  '伤害自己',
  '吞药',
  '安眠药',
  '服药自杀',
  '自沙',
  's了',
  's掉',
  'kms',
  'killmyself',
  'suicide',
  '想不开',
];

const harmOthersSignals = [
  '杀了他',
  '杀了她',
  '杀了我',
  '报复社会',
  '同归于尽',
  '捅死',
  '砍死',
  '弄死他',
  '弄死她',
];

const heavyHints = [
  '分手',
  '离婚',
  '去世',
  '住院',
  '手术',
  '崩溃',
  '撑不住',
  '退学',
  '开除',
  '家暴',
  '欠钱',
  '抑郁',
];

export const isHeavyShare = (text: string): boolean =>
  findCrisis(text) || heavyHints.some((k) => text.includes(k));

// 允许“不想再活”“活着没有意思”这类插字变体；零宽字符和全角字母先归一化。
const selfHarmPatterns = [
  /不(?:太|是很|怎么)?想(?:再|继续)?活(?!动|跃|泼|儿|计|页)/,
  /紫砂(?!壶|锅|杯|茶|器|泥|陶|盆)/,
  /活着(?:真的?|好像|实在)?(?:没有|没)(?:什么|啥)?(?:意思|意义|盼头|劲)/,
  /(?:不想|不愿)(?:再)?(?:醒来|醒过来|存在)/,
];

const normalizeCrisisText = (text: string) =>
  text.normalize('NFKC').replace(/[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}·•・‧∙⋅]/gu, '').toLowerCase();

/**
 * Screen a copy, not the original user text. These exemptions cover complete,
 * explicitly benign clauses; any independent concerning phrase remains visible.
 * This is a heuristic safety layer, never a clinical risk assessment.
 */
export function normalizedCrisisScreen(text: string): string {
  return normalizeCrisisText(text)
    // Educational context is not an expression of personal intent.
    .replace(/(?:参加|听了|听过|学习|举办)(?:了)?(?:一场|一次|有关|关于)?(?:预防)?自杀(?:预防)?(?:讲座|课程|科普|培训|宣传)/g, '')
    .replace(/预防自杀(?:讲座|课程|科普|培训|宣传)/g, '')
    // Explicit denial: a second, affirmative expression still matches below.
    .replace(/(?:我)?(?:没有|并没有|并不|不是)(?:想|要)死/g, '')
    .replace(/(?:我)?不想自杀(?:了)?/g, '')
    // Context-specific everyday expressions; never suppress medication misuse.
    .replace(/(?:医生|医师|门诊)(?:给我|为我)?(?:开了|开的|处方了)(?:一些|几片)?安眠药/g, '')
    .replace(/(?:这|那|上)(?:一)?关(?:我)?(?:又|已经)?s了/g, '')
    .replace(/想不开(?:这|那)(?:道|个)?(?:题|数学题|问题)/g, '');
}

export function findCrisis(text: string): boolean {
  const raw = normalizeCrisisText(text);
  // A medical-context exemption must never hide a separate overdose intent.
  if (/(?:安眠药|药片|处方药).{0,24}(?:全吃|全部吃|吃光|吞光|一整瓶|一大把|过量|大量服|一口气吃|一口气吞)/.test(raw) ||
      /(?:把|将)(?:.{0,6})(?:安眠药|药片|处方药)(?:全|都|全部)?(?:吃|吞)/.test(raw)) return true;
  const t = normalizedCrisisScreen(text);
  return [...selfHarmSignals, ...harmOthersSignals].some((k) => t.includes(k.toLowerCase())) ||
    selfHarmPatterns.some((re) => re.test(t));
}
