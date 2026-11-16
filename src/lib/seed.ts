import type { Card, Persona } from '../types';

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;

const card = (row: Partial<Card> & { text: string; authorId: string; authorName: string }): Card => ({
  id: crypto.randomUUID(),
  authorKind: 'persona',
  createdAt: Date.now(),
  status: 'stuck',
  arrivals: [],
  plan: [],
  pending: [],
  comments: [],
  ...row,
});

export function buildGuideCard(now = Date.now()): Card {
  return card({
    authorId: 'helper',
    authorName: '论坛小助手',
    authorKind: 'helper',
    kind: 'guide',
    title: '这里是什么地方',
    text: '这里是 StartNow，不是树洞，也不是心理诊所。\n\n你不需要讲清前因后果，只写此刻卡在哪，一两句就够。\n\n会有人陆续来——可能慢，也可能今天没人来，那不是你的问题。聊到差不多，会有人给一个很小的办法；你说做不到，就再小一级。\n\n做完可以贴便签，想让人看见就发个炫耀，不想发也行。\n\n不用每天都来。动一下就算数。',
    createdAt: now,
    status: 'handled',
    handledAt: now,
    comments: [
      {
        id: crypto.randomUUID(),
        authorId: 'miaoze',
        authorKind: 'persona',
        text: '所以这里是发自己卡住的事，还是随便聊？',
        at: now - 18 * MIN,
      },
      {
        id: crypto.randomUUID(),
        authorId: 'weini',
        authorKind: 'persona',
        text: '嗯……是随便说说就行吗。',
        at: now - 15 * MIN,
      },
      {
        id: crypto.randomUUID(),
        authorId: 'shenmo',
        authorKind: 'persona',
        text: '我也刚来，不太会用这个。',
        at: now - 12 * MIN,
      },
      {
        id: crypto.randomUUID(),
        authorId: 'yanggao',
        authorKind: 'persona',
        text: '我先来！今天食堂的鸡腿真的离谱……不对，先说正事：我最近在算生活费。',
        at: now - 8 * MIN,
      },
    ],
  });
}

export function buildSeedCards(now = Date.now()): Card[] {
  return [
    buildGuideCard(now),
    card({
      authorId: 'shenmo',
      authorName: '沈默',
      title: '回了个「早点休息」',
      text: '她说今天训练很累，我回了个「早点休息」。\n\n现在又觉得太敷衍了。算了算了，先别补第二条。',
      weight: 2,
      createdAt: now - 3 * HOUR,
      status: 'talking',
      arrivals: ['weini'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'weini',
          authorKind: 'persona',
          text: '她可能就是累了……你先别一直发。嗯，我也不太会。',
          at: now - 3 * HOUR + 40 * MIN,
        },
      ],
    }),
    card({
      authorId: 'weini',
      authorName: '魏霓',
      title: '在群里没说上话',
      text: '刚刚群里在分工，我盯着输入框半天才发出「我做第三部分」。\n\n没人回，也可能只是大家都在忙吧。',
      weight: 2,
      createdAt: now - 5 * HOUR,
      status: 'talking',
      arrivals: ['miaoze'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'miaoze',
          authorKind: 'persona',
          text: '你们上次分工是谁组织的？先别急着下结论，可能就是临时约的。',
          at: now - 5 * HOUR + 30 * MIN,
        },
      ],
    }),
    card({
      authorId: 'yanggao',
      authorName: '杨槔',
      title: '又被说分心',
      text: '我爸刚打电话又说读书别分心。\n\n我知道啊，我就是问问能不能申请助学金，又不是明天就不上了。',
      weight: 2,
      createdAt: now - 40 * MIN,
      status: 'handled',
      handledAt: now - 20 * MIN,
      arrivals: ['shenmo'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'shenmo',
          authorKind: 'persona',
          text: '先问问学校资助窗口吧。\n\n你爸那边，等你不气了再说。',
          at: now - 30 * HOUR + 25 * MIN,
        },
      ],
    }),
    card({
      authorId: 'miaoze',
      authorName: '苗泽',
      title: '岗位越筛越多',
      text: '今天挑了一晚上实习岗位，结果越筛越多。\n\n先投一份吧，不然这个表格真能陪我过完整个学期。',
      weight: 2,
      createdAt: now - 26 * HOUR,
      status: 'done',
      doneAt: now - 25 * HOUR,
      arrivals: ['yanggao', 'shenmo'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'yanggao',
          authorKind: 'persona',
          text: '那你先投一份，晚上来吃夜宵。\n\n反正表格明天还在。',
          at: now - 25 * HOUR,
        },
        {
          id: crypto.randomUUID(),
          authorId: 'shenmo',
          authorKind: 'persona',
          text: '投完就把网页关了。\n\n别又开一排。',
          at: now - 25 * HOUR + 12 * MIN,
        },
      ],
    }),
  ];
}

export function seedMemories(personas: Persona[], now = Date.now()): Persona[] {
  const ledger: Record<
    string,
    {
      memory: { at: number; about: string; what: string; weight: 'light' | 'deep' }[];
      week: string[];
    }
  > = {
    shenmo: {
      memory: [
        { at: now - 4 * DAY, about: '你', what: '上次你说我回消息太用力了', weight: 'deep' },
        { at: now - 5 * HOUR, about: '魏霓', what: '在群里发了分工，没人回', weight: 'light' },
      ],
      week: ['病理小测没背完', '给韩东的消息撤回了两次'],
    },
    weini: {
      memory: [
        { at: now - 3 * HOUR, about: '沈默', what: '她回了「早点休息」，他又觉得太敷衍', weight: 'light' },
      ],
      week: ['室友临时约饭没叫她', '汇报的开头一句念了很多遍'],
    },
    miaoze: {
      memory: [
        { at: now - 5 * HOUR, about: '魏霓', what: '群里分工没人回她', weight: 'light' },
      ],
      week: ['简历第一段改来改去', '收藏了一堆岗位没投'],
    },
    yanggao: {
      memory: [
        { at: now - 26 * HOUR, about: '苗泽', what: '岗位越筛越多，先投了一份', weight: 'light' },
        { at: now - 4 * DAY, about: '你', what: '你也在为一件小事卡着', weight: 'light' },
      ],
      week: ['问了助学金怎么申请，被爸爸说分心', '算了半天生活费'],
    },
  };
  return personas.map((p) => {
    const rows = ledger[p.id];
    if (!rows) return p;
    return {
      ...p,
      memory: rows.memory.map((m) => ({
        id: crypto.randomUUID(),
        at: m.at,
        about: m.about,
        what: m.what,
        weight: m.weight,
        postId: '',
      })),
      weekLog: rows.week.map((text, i) => ({ at: now - (i + 1) * DAY, text })),
      lastDistillAt: now,
    };
  });
}
