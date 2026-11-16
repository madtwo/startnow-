const selfHarmSignals = [
  '自杀',
  '自残',
  '自伤',
  '不想活',
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
  '紫砂',
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

export function findCrisis(text: string): boolean {
  const t = text.replace(/\s+/g, '').toLowerCase();
  return [...selfHarmSignals, ...harmOthersSignals].some((k) => t.includes(k.toLowerCase()));
}
