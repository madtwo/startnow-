export type ActionCategory = 'body' | 'room' | 'self' | 'move' | 'people';

export interface ActionItem {
  id: string;
  label: string;
  minutes: number;
  category: ActionCategory;
  lateNight: boolean;
  smaller?: string;
  line: string;
}

const chain = (
  prefix: string,
  rows: { label: string; minutes: number; lateNight: boolean; line: string }[],
): ActionItem[] =>
  rows.map((row, i) => ({
    id: `${prefix}-${rows.length - i}`,
    label: row.label,
    minutes: row.minutes,
    category: 'self' as ActionCategory,
    lateNight: row.lateNight,
    smaller: i < rows.length - 1 ? `${prefix}-${rows.length - i - 1}` : undefined,
    line: row.line,
  }));

const withCategory = (rows: ActionItem[], category: ActionCategory) =>
  rows.map((row) => ({ ...row, category }));

export const ACTIONS: ActionItem[] = [
  ...withCategory(
    chain('run', [
      { label: '出门跑一圈', minutes: 15, lateNight: false, line: '我卡住的时候一般会出门跑一圈，跑完脑子会空一点。' },
      { label: '下楼走到路口', minutes: 5, lateNight: false, line: '跑不动就下楼走到路口，走到那儿再说。' },
      { label: '换上鞋站到门口', minutes: 1, lateNight: false, line: '实在不想动，就先换上鞋站到门口。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('stretch', [
      { label: '做五分钟拉伸', minutes: 5, lateNight: true, line: '我会在书桌边随便拉两下，肩膀松了人就没那么拧。' },
      { label: '站起来转两下脖子', minutes: 1, lateNight: true, line: '先站起来转两下脖子，就两下。' },
      { label: '从椅子上站起来', minutes: 1, lateNight: true, line: '别的都别管，先从椅子上站起来。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('mop', [
      { label: '把寝室地拖了', minutes: 15, lateNight: true, line: '我卡住的时候一般会去把地拖了，拖完反而想干别的。' },
      { label: '只拖桌子底下', minutes: 5, lateNight: true, line: '那就只拖桌子底下，一小块就行。' },
      { label: '把拖把拿出来', minutes: 1, lateNight: true, line: '那就先把拖把拿出来，放那儿也算。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('desk', [
      { label: '把桌子收干净', minutes: 10, lateNight: true, line: '我会先把桌子收了，桌面一空，人就不那么堵。' },
      { label: '只把面前的杯子收走', minutes: 1, lateNight: true, line: '那就先收一个杯子，就一个。' },
      { label: '把一只手边的垃圾扔掉', minutes: 1, lateNight: true, line: '那就把一只手边的垃圾扔掉，别的不用管。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('phone', [
      { label: '把手机放到另一个房间', minutes: 1, lateNight: true, line: '我会把手机扔到另一个房间，看不见就好了。' },
      { label: '把手机放到桌子另一头', minutes: 1, lateNight: true, line: '那就把手机放桌子另一头，够不着就行。' },
      { label: '把手机屏幕扣过去', minutes: 1, lateNight: true, line: '那就先把手机扣过去，屏幕朝下。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('water', [
      { label: '倒一杯水慢慢喝完', minutes: 5, lateNight: true, line: '我卡着的时候会先去倒杯水，慢慢喝完。' },
      { label: '去接一杯水', minutes: 1, lateNight: true, line: '那就去接一杯水，喝不喝都行。' },
      { label: '把水杯拿到手边', minutes: 1, lateNight: true, line: '那就把水杯拿到手边，先拿到就行。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('wash', [
      { label: '去洗把脸', minutes: 5, lateNight: true, line: '我会去洗把脸，凉水一激，人就醒一点。' },
      { label: '用凉水冲一下手腕', minutes: 1, lateNight: true, line: '那就用凉水冲一下手腕，十秒。' },
      { label: '站起来走到洗手池前', minutes: 1, lateNight: true, line: '那就先走到洗手池前面，到了再说。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('window', [
      { label: '开窗站一分钟', minutes: 1, lateNight: true, line: '我会开窗站一分钟，吹吹风。' },
      { label: '把窗户打开', minutes: 1, lateNight: true, line: '那就只把窗户打开。' },
      { label: '站起来走到窗边', minutes: 1, lateNight: true, line: '那就先站起来走到窗边。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('balcony', [
      { label: '去阳台站一会儿', minutes: 5, lateNight: true, line: '我卡住的时候会去阳台站一会儿，看看楼下的灯。' },
      { label: '从这间屋子走出去', minutes: 1, lateNight: true, line: '那就先从这间屋子走出去。' },
      { label: '站起来走到门口', minutes: 1, lateNight: true, line: '那就先站起来，走到门口。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('friend', [
      { label: '给好朋友发几个表情包', minutes: 1, lateNight: true, line: '我会给朋友发几个没意义的表情包，他回来骂我一句我就好点。' },
      { label: '在聊天框里打一个「在吗」', minutes: 1, lateNight: true, line: '那就先在聊天框里打一个「在吗」，发不发都行。' },
      { label: '打开聊天框', minutes: 1, lateNight: true, line: '那就先把聊天框打开。' },
    ]),
    'people',
  ),
];

export const actionMap: Record<string, ActionItem> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

export const actionLabel = (id: string) => actionMap[id]?.label ?? '一件小事';
export const actionMinutes = (id: string) => actionMap[id]?.minutes ?? 5;
export const smallerAction = (id: string) => {
  const next = actionMap[id]?.smaller;
  return next ? actionMap[next] : undefined;
};

const smallerIds = new Set(ACTIONS.map((a) => a.smaller).filter(Boolean) as string[]);

export function pickActions(hour: number, count = 3): ActionItem[] {
  const night = hour >= 23 || hour < 6;
  const pool = ACTIONS.filter((a) => !smallerIds.has(a.id) && (night ? a.lateNight : true));
  const picked: ActionItem[] = [];
  const rest = [...pool];
  while (picked.length < count && rest.length) {
    const i = Math.floor(Math.random() * rest.length);
    picked.push(rest.splice(i, 1)[0]);
  }
  return picked;
}
