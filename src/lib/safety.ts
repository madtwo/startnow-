const selfHarmSignals = [
  '自杀',
  '自残',
  '不想活',
  '想死',
  '轻生',
  '割腕',
  '跳楼',
  '结束生命',
  '活着没意思',
  '活着没意义',
  '伤害自己',
  '吞药',
  '安眠药',
];

const harmOthersSignals = ['杀了他', '杀了她', '杀了我', '报复社会', '同归于尽'];

export function findCrisis(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return [...selfHarmSignals, ...harmOthersSignals].some((k) => t.includes(k));
}
