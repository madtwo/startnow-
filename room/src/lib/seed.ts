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
  readAt: row.readAt ?? row.createdAt ?? Date.now(),
  ...row,
});

export function buildGuideCard(now = Date.now()): Card {
  return card({
    authorId: 'helper',
    authorName: '论坛小助手',
    authorKind: 'helper',
    kind: 'guide',
    title: '这里是什么地方',
    text: '这里是 StartNow，不是树洞，也不是心理诊所。\n\n你不需要讲清前因后果，只写此刻卡在哪，一两句就够。\n\n会有人陆续来——可能慢，也可能今天没人来，那不是你的问题。聊到差不多，会有人给一个很小的下一步；你说做不到，就再小一级。\n\n做完可以贴便签，想让人看见就发个炫耀，不想发也行。\n\n不用每天都来。动一下就算数。',
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
        text: '我先来！今天食堂的鸡腿真的离谱……不对，先说正事：这里以后就请大家多指教啦。',
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
      title: '刚来',
      text: '刚进来，还不太会用。\n我是临床大三，最近课有点多。先打个招呼。',
      weight: 1,
      createdAt: now - 3 * HOUR,
      status: 'talking',
      arrivals: ['weini'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'weini',
          authorKind: 'persona',
          text: '嗯，我也是刚来。\n先看看别人怎么发。',
          at: now - 3 * HOUR + 25 * MIN,
        },
      ],
    }),
    card({
      authorId: 'weini',
      authorName: '魏霓',
      title: '先打个招呼',
      text: '嗯……先打个招呼。\n我还不太知道这里该怎么说话，先看看。',
      weight: 1,
      createdAt: now - 150 * MIN,
      status: 'talking',
      arrivals: ['yanggao'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'yanggao',
          authorKind: 'persona',
          text: '欢迎欢迎！我也刚来。\n随便说就行吧。',
          at: now - 130 * MIN,
        },
      ],
    }),
    card({
      authorId: 'miaoze',
      authorName: '苗泽',
      title: '研究了一下规则',
      text: '所以这里是发自己卡住的事，不是聊天楼？\n我材料大三，先熟悉一下。',
      weight: 1,
      createdAt: now - 2 * HOUR,
      status: 'talking',
      arrivals: ['shenmo'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'shenmo',
          authorKind: 'persona',
          text: '应该是吧。\n我也在摸索。',
          at: now - 2 * HOUR + 30 * MIN,
        },
      ],
    }),
    card({
      authorId: 'yanggao',
      authorName: '杨槔',
      title: '我先来',
      text: '我先来自我介绍！\n大一，爱吃饭爱打球，以后多多指教。',
      weight: 1,
      createdAt: now - 60 * MIN,
      status: 'talking',
      arrivals: ['miaoze'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'miaoze',
          authorKind: 'persona',
          text: '那先眼熟一下。\n我也刚来。',
          at: now - 45 * MIN,
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
        { at: now - 3 * HOUR, about: '魏霓', what: '她也刚来，在犹豫怎么开口', weight: 'light' },
      ],
      week: ['病理小测没背完', '给韩东的消息撤回了两次'],
    },
    weini: {
      memory: [
        { at: now - 3 * HOUR, about: '沈默', what: '他先打了招呼', weight: 'light' },
      ],
      week: ['室友临时约饭没叫她', '汇报的开头一句念了很多遍'],
    },
    miaoze: {
      memory: [
        { at: now - 3 * HOUR, about: '沈默', what: '临床大三，刚来', weight: 'light' },
        { at: now - 2 * HOUR, about: '杨槔', what: '大一，爱吃饭爱打球', weight: 'light' },
      ],
      week: ['简历第一段改来改去', '收藏了一堆岗位没投'],
    },
    yanggao: {
      memory: [
        { at: now - 150 * MIN, about: '魏霓', what: '不太知道怎么说话，先看看', weight: 'light' },
      ],
      week: ['问了助学金怎么申请', '算了半天生活费'],
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
