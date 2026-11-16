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

export function buildSeedCards(now = Date.now()): Card[] {
  return [
    card({
      authorId: 'miaoze',
      authorName: '苗泽',
      text: '明天材料物理小测，书才背到第三章。\n\n室友在打游戏，我戴着耳机也听不进去。',
      createdAt: now - 3 * HOUR,
      status: 'talking',
      arrivals: ['chenyu'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'chenyu',
          authorKind: 'persona',
          text: '是背不进去，还是背了又怕忘。',
          at: now - 3 * HOUR + 40 * MIN,
        },
      ],
      seenAt: undefined,
    }),
    card({
      authorId: 'xiaoman',
      authorName: '小满',
      text: '组会 PPT 还是空的，明天就要讲。\n\n我是不是真的不适合做这个。',
      createdAt: now - 5 * HOUR,
      status: 'talking',
      arrivals: ['miaoze'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'miaoze',
          authorKind: 'persona',
          text: '我每次也这样，越到 deadline 越觉得自己不行。',
          at: now - 5 * HOUR + 30 * MIN,
        },
      ],
    }),
    card({
      authorId: 'laozhou',
      authorName: '老周',
      text: '导师今天第三次催进度，数据还是不对。\n\n不知道该从哪改。',
      createdAt: now - 30 * HOUR,
      status: 'handled',
      handledAt: now - 20 * HOUR,
      arrivals: ['xiaoman'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'xiaoman',
          authorKind: 'persona',
          text: '数据不对最烦了，我上周也重跑了一遍。',
          at: now - 30 * HOUR + 25 * MIN,
        },
      ],
    }),
    card({
      authorId: 'chenyu',
      authorName: '陈屿',
      text: '论文卡了两周，今天把第一段写了。',
      weight: 1,
      createdAt: now - 26 * HOUR,
      status: 'done',
      doneAt: now - 25 * HOUR,
      arrivals: ['miaoze', 'laozhou'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'miaoze',
          authorKind: 'persona',
          text: '第一段？那你今天赢了。',
          at: now - 25 * HOUR,
        },
        {
          id: crypto.randomUUID(),
          authorId: 'laozhou',
          authorKind: 'persona',
          text: '够了。第一段，够了。',
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
    miaoze: {
      memory: [
        { at: now - 3 * DAY, about: '你', what: '上次组会前，是你让我先把标题页做了', weight: 'deep' },
        { at: now - 2 * DAY, about: '小满', what: '组会前一晚还在拖 PPT', weight: 'light' },
      ],
      week: ['材料物理小测没考好，选择题错了一半', '在操场遇到那个女生，打了个招呼就跑了'],
    },
    xiaoman: {
      memory: [
        { at: now - 4 * HOUR, about: '苗泽', what: '为材料物理小测焦虑', weight: 'light' },
      ],
      week: ['和妈妈打电话，又吵了考公的事'],
    },
    chenyu: {
      memory: [
        { at: now - 3 * HOUR, about: '苗泽', what: '书背不进去，室友在打游戏', weight: 'light' },
      ],
      week: ['投了一个实习，第二天就后悔了'],
    },
    laozhou: {
      memory: [
        { at: now - 5 * HOUR, about: '小满', what: '组会 PPT 还没做', weight: 'light' },
        { at: now - 3 * DAY, about: '你', what: '你也在为论文卡着', weight: 'light' },
      ],
      week: ['实验数据又不对，重跑了一遍'],
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
