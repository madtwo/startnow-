import type { TroubleKind } from '../types';

export type ActionCategory = 'body' | 'room' | 'self' | 'move' | 'people' | 'study' | 'future';

export interface ActionItem {
  id: string;
  label: string;
  minutes: number;
  category: ActionCategory;
  topics: TroubleKind[];
  lateNight: boolean;
  smaller?: string;
  line: string;
}

const UNIVERSAL: TroubleKind[] = ['study', 'people', 'love', 'family', 'self', 'future'];

const chain = (
  prefix: string,
  topics: TroubleKind[],
  rows: { label: string; minutes: number; lateNight: boolean; line: string }[],
): ActionItem[] =>
  rows.map((row, i) => ({
    id: `${prefix}-${rows.length - i}`,
    label: row.label,
    minutes: row.minutes,
    category: 'self' as ActionCategory,
    topics,
    lateNight: row.lateNight,
    smaller: i < rows.length - 1 ? `${prefix}-${rows.length - i - 1}` : undefined,
    line: row.line,
  }));

const withCategory = (rows: ActionItem[], category: ActionCategory) =>
  rows.map((row) => ({ ...row, category }));

export const ACTIONS: ActionItem[] = [
  ...withCategory(
    chain('run', UNIVERSAL, [
      {
        label: '出门跑一圈',
        minutes: 15,
        lateNight: false,
        line: '我卡住的时候一般会出门跑一圈，跑完脑子会空一点。',
      },
      { label: '下楼走到路口', minutes: 5, lateNight: false, line: '跑不动就下楼走到路口，走到那儿再说。' },
      { label: '换上鞋站到门口', minutes: 1, lateNight: false, line: '实在不想动，就先换上鞋站到门口。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('stretch', UNIVERSAL, [
      {
        label: '做五分钟拉伸',
        minutes: 5,
        lateNight: true,
        line: '我会在书桌边随便拉两下，肩膀松了人就没那么拧。',
      },
      { label: '站起来转两下脖子', minutes: 1, lateNight: true, line: '先站起来转两下脖子，就两下。' },
      { label: '从椅子上站起来', minutes: 1, lateNight: true, line: '别的都别管，先从椅子上站起来。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('mop', UNIVERSAL, [
      {
        label: '把寝室地拖了',
        minutes: 15,
        lateNight: true,
        line: '我卡住的时候一般会去把地拖了，拖完反而想干别的。',
      },
      { label: '只拖桌子底下', minutes: 5, lateNight: true, line: '那就只拖桌子底下，一小块就行。' },
      { label: '把拖把拿出来', minutes: 1, lateNight: true, line: '那就先把拖把拿出来，放那儿也算。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('desk', UNIVERSAL, [
      {
        label: '把桌子收干净',
        minutes: 10,
        lateNight: true,
        line: '我会先把桌子收了，桌面一空，人就不那么堵。',
      },
      { label: '只把面前的杯子收走', minutes: 1, lateNight: true, line: '那就先收一个杯子，就一个。' },
      {
        label: '把一只手边的垃圾扔掉',
        minutes: 1,
        lateNight: true,
        line: '那就把一只手边的垃圾扔掉，别的不用管。',
      },
    ]),
    'room',
  ),
  ...withCategory(
    chain('phone', UNIVERSAL, [
      {
        label: '把手机放到另一个房间',
        minutes: 1,
        lateNight: true,
        line: '我会把手机放到另一个房间，看不见就好了。',
      },
      { label: '把手机放到桌子另一头', minutes: 1, lateNight: true, line: '那就把手机放桌子另一头，够不着就行。' },
      { label: '把手机屏幕扣过去', minutes: 1, lateNight: true, line: '那就先把手机扣过去，屏幕朝下。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('water', UNIVERSAL, [
      { label: '倒一杯水慢慢喝完', minutes: 5, lateNight: true, line: '我卡着的时候会先去倒杯水，慢慢喝完。' },
      { label: '去接一杯水', minutes: 1, lateNight: true, line: '那就去接一杯水，喝不喝都行。' },
      { label: '把水杯拿到手边', minutes: 1, lateNight: true, line: '那就把水杯拿到手边，先拿到就行。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('wash', UNIVERSAL, [
      { label: '去洗把脸', minutes: 5, lateNight: true, line: '我会去洗把脸，凉水一激，人就醒一点。' },
      { label: '用凉水冲一下手腕', minutes: 1, lateNight: true, line: '那就用凉水冲一下手腕，十秒。' },
      { label: '站起来走到洗手池前', minutes: 1, lateNight: true, line: '那就先走到洗手池前面，到了再说。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('window', UNIVERSAL, [
      { label: '开窗站一分钟', minutes: 1, lateNight: true, line: '我会开窗站一分钟，吹吹风。' },
      { label: '把窗户打开', minutes: 1, lateNight: true, line: '那就只把窗户打开。' },
      { label: '站起来走到窗边', minutes: 1, lateNight: true, line: '那就先站起来走到窗边。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('balcony', UNIVERSAL, [
      {
        label: '去阳台站一会儿',
        minutes: 5,
        lateNight: true,
        line: '我卡住的时候会去阳台站一会儿，看看楼下的灯。',
      },
      { label: '从这间屋子走出去', minutes: 1, lateNight: true, line: '那就先从这间屋子走出去。' },
      { label: '站起来走到门口', minutes: 1, lateNight: true, line: '那就先站起来，走到门口。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('friend', ['people'], [
      {
        label: '给好朋友发几个表情包',
        minutes: 1,
        lateNight: true,
        line: '我会给朋友发几个没意义的表情包，他回来骂我一句我就好点。',
      },
      { label: '在聊天框里打一个「在吗」', minutes: 1, lateNight: true, line: '那就先在聊天框里打一个「在吗」，发不发都行。' },
      { label: '打开聊天框', minutes: 1, lateNight: true, line: '那就先把聊天框打开。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('memo', ['people', 'love', 'family'], [
      {
        label: '把想说的话写在备忘录里，先不发',
        minutes: 1,
        lateNight: true,
        line: '我会先把想说的话写在备忘录里，发不发再说。',
      },
      { label: '打开备忘录', minutes: 1, lateNight: true, line: '那就先把备忘录打开。' },
      { label: '把手机解锁', minutes: 1, lateNight: true, line: '那就先把手机解锁，点开备忘录就行。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('message', ['people', 'love', 'family'], [
      {
        label: '在聊天框里打一句想说的话，先不发',
        minutes: 1,
        lateNight: true,
        line: '我会先把想说的话打在聊天框里，发不发再说。',
      },
      { label: '打开那个人的聊天框', minutes: 1, lateNight: true, line: '那就先把那个人的聊天框打开，不用打字。' },
      { label: '找到那个人的头像', minutes: 1, lateNight: true, line: '那就先找到那个人的头像，点开看一眼。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('book', ['study'], [
      {
        label: '把书翻到明天要考的那一章',
        minutes: 5,
        lateNight: true,
        line: '我复习不进去的时候，会先把书翻到要考的那一章，别的不看。',
      },
      { label: '只把书翻开', minutes: 1, lateNight: true, line: '那就先只把书翻开，翻到哪页算哪页。' },
      { label: '把书从包里拿出来', minutes: 1, lateNight: true, line: '那就先把书从包里拿出来，放桌上。' },
    ]),
    'study',
  ),
  ...withCategory(
    chain('notes', ['study'], [
      {
        label: '把明天要考的范围写在纸上',
        minutes: 5,
        lateNight: true,
        line: '我会先把要考的范围写在纸上，写不完整也没事。',
      },
      { label: '拿出一张纸', minutes: 1, lateNight: true, line: '那就先拿出一张纸，放在书旁边。' },
      { label: '把笔记本翻开', minutes: 1, lateNight: true, line: '那就先把笔记本翻开，空白的也行。' },
    ]),
    'study',
  ),
  ...withCategory(
    chain('problem', ['study'], [
      {
        label: '只做一道最简单的例题',
        minutes: 5,
        lateNight: true,
        line: '我会先挑一道最简单的例题做，做完再看下一道。',
      },
      { label: '把例题的题干读一遍', minutes: 1, lateNight: true, line: '那先把例题的题干读一遍，不用做。' },
      { label: '翻开到例题那一页', minutes: 1, lateNight: true, line: '那就先翻到例题那页，看一行也行。' },
    ]),
    'study',
  ),
  ...withCategory(
    chain('jd', ['future'], [
      {
        label: '把收藏的岗位描述打开，只读第一段',
        minutes: 5,
        lateNight: true,
        line: '我会先把收藏的岗位描述打开，只读第一段，读完就关。',
      },
      { label: '只把那份岗位描述找出来', minutes: 1, lateNight: true, line: '那就先把那份岗位描述找出来，不用读。' },
      { label: '打开招聘软件', minutes: 1, lateNight: true, line: '那就先把招聘软件打开，看一眼就退。' },
    ]),
    'future',
  ),
  ...withCategory(
    chain('apply', ['future'], [
      {
        label: '打开一个岗位的申请页面，只看要求',
        minutes: 5,
        lateNight: true,
        line: '我会先打开一个岗位的申请页面，只看要求，不投。',
      },
      { label: '把想投的岗位收藏到一个文件夹', minutes: 1, lateNight: true, line: '那就先把想投的岗位收藏起来，不投也行。' },
      { label: '打开招聘软件', minutes: 1, lateNight: true, line: '那就先把招聘软件打开，看一眼就退。' },
    ]),
    'future',
  ),
  ...withCategory(
    chain('resume', ['future'], [
      {
        label: '打开简历，只改第一行',
        minutes: 5,
        lateNight: true,
        line: '我会把简历打开，只改第一行，改完就停。',
      },
      { label: '把简历文件打开', minutes: 1, lateNight: true, line: '那就先把简历文件打开，别的不管。' },
      { label: '找到简历文件', minutes: 1, lateNight: true, line: '那就先找到简历文件，放在桌面上。' },
    ]),
    'future',
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

const RULES: [TroubleKind, RegExp][] = [
  [
    'future',
    /(简历|面试|校招|秋招|春招|实习|求职|招聘|投递|岗位|offer|考研|考公|保研|出国|申请|毕业|职业|规划|面经)/i,
  ],
  [
    'study',
    /(考试|小测|期末|期中|复习|背书|背不|论文|开题|报告|作业|实验|课程|上课|绩点|挂科|公式|题目|例题|高数|英语|四六级|ddl|截止|答辩|文献)/i,
  ],
  ['love', /(喜欢|表白|恋爱|分手|前任|暧昧|对象|男友|女友|约会|crush|感情|结婚|回消息|等消息)/i],
  [
    'family',
    /(家里|爸妈|父母|妈妈|爸爸|哥哥|弟弟|姐姐|妹妹|奶奶|爷爷|姥姥|姥爷|亲戚|回家|生活费|原生家庭)/i,
  ],
  [
    'people',
    /(室友|朋友|同学|宿舍|社交|社团|导师|老师|同事|孤立|尴尬|聊天|回复|人际|闹掰|冷战)/i,
  ],
  [
    'self',
    /(焦虑|难受|烦|崩|哭|累|睡不着|失眠|没力气|不想动|拖延|手机|刷|内耗|自卑|害怕|空|情绪)/i,
  ],
];

export function inferTrouble(text: string, fallback: TroubleKind = 'self'): TroubleKind {
  const hit = RULES.find(([, rule]) => rule.test(text));
  return hit?.[0] ?? fallback;
}

const shuffle = <T,>(rows: T[]): T[] => {
  const rest = [...rows];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return rest;
};

export function pickActions(hour: number, count = 3, trouble?: TroubleKind): ActionItem[] {
  const night = hour >= 23 || hour < 6;
  const eligible = (a: ActionItem) =>
    !smallerIds.has(a.id) && (night ? a.lateNight : true) && (!trouble || a.topics.includes(trouble));
  const matching = ACTIONS.filter(eligible);
  const specific = trouble ? matching.filter((a) => a.topics.length < UNIVERSAL.length) : [];
  const picked: ActionItem[] = [];
  if (specific.length) picked.push(specific[Math.floor(Math.random() * specific.length)]);
  for (const action of shuffle(specific)) {
    if (picked.length >= count) break;
    if (!picked.includes(action)) picked.push(action);
  }
  for (const action of shuffle(matching)) {
    if (picked.length >= count) break;
    if (!picked.includes(action)) picked.push(action);
  }
  return picked;
}
