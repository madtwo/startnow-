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
      authorId: 'shenmo',
      authorName: '沈默',
      title: '她回了个「嗯」',
      text: '她回了句「嗯」。我打了三行又删了。\n\n我是不是太黏了。',
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
      title: '室友没叫我',
      text: '室友出去吃饭没叫我。\n\n我知道可能是临时约的，但还是有点难受。',
      weight: 2,
      createdAt: now - 5 * HOUR,
      status: 'talking',
      arrivals: ['miaoze'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'miaoze',
          authorKind: 'persona',
          text: '你们上次是谁组织的？先别急着下结论，可能就是临时约的。',
          at: now - 5 * HOUR + 30 * MIN,
        },
      ],
    }),
    card({
      authorId: 'yanggao',
      authorName: '杨槔',
      title: '夹在中间',
      text: '我哥又和我爸吵了。\n\n我夹在中间，谁都不想怪。',
      weight: 2,
      createdAt: now - 30 * HOUR,
      status: 'handled',
      handledAt: now - 20 * HOUR,
      arrivals: ['shenmo'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'shenmo',
          authorKind: 'persona',
          text: '夹在中间最累了。\n\n你先吃饭了吗。',
          at: now - 30 * HOUR + 25 * MIN,
        },
      ],
    }),
    card({
      authorId: 'miaoze',
      authorName: '苗泽',
      title: '名单里没有我',
      text: '夏令营名单出来了，没有我。\n\n我真心替他们高兴，但晚上没吃下饭。',
      weight: 1,
      createdAt: now - 26 * HOUR,
      status: 'done',
      doneAt: now - 25 * HOUR,
      arrivals: ['yanggao', 'shenmo'],
      comments: [
        {
          id: crypto.randomUUID(),
          authorId: 'yanggao',
          authorKind: 'persona',
          text: '没吃下饭可不行。\n\n下楼，我请你喝瓶水。',
          at: now - 25 * HOUR,
        },
        {
          id: crypto.randomUUID(),
          authorId: 'shenmo',
          authorKind: 'persona',
          text: '名单这种事，有时候真不是实力问题。\n\n先吃饭吧。',
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
        { at: now - 5 * HOUR, about: '魏霓', what: '室友没叫她吃饭，她有点难受', weight: 'light' },
      ],
      week: ['病理小测没背完', '给韩东发的消息撤回了两次'],
    },
    weini: {
      memory: [
        { at: now - 3 * HOUR, about: '沈默', what: '她回了「嗯」，他打了三行又删了', weight: 'light' },
      ],
      week: ['室友临时约饭没叫她', '小组汇报的 PPT 改到第五遍'],
    },
    miaoze: {
      memory: [
        { at: now - 5 * HOUR, about: '魏霓', what: '室友出去吃饭没叫她', weight: 'light' },
      ],
      week: ['又看了三个岗位，要求差很多', '夏令营名单没自己'],
    },
    yanggao: {
      memory: [
        { at: now - 26 * HOUR, about: '苗泽', what: '夏令营没选上，晚上没吃饭', weight: 'light' },
        { at: now - 4 * DAY, about: '你', what: '你也在为一件小事卡着', weight: 'light' },
      ],
      week: ['妈妈下周要去复查', '和哥哥因为爸爸吵了一架'],
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
