import type {
  Card,
  LlmConfig,
  Persona,
  PersonaMind,
  PendingReply,
  TroubleKind,
  WorldSettings,
} from '../types';
import { isMock } from '../config/providers';
import { auditSocial, auditTone } from './baseline';
import {
  ensureMind,
  mindAfterPeer,
  mindAfterPost,
  mindAfterReply,
  mindAfterStep,
} from './mind';
import { findCrisis, isHeavyShare } from './safety';
import { addMemory, inferWeight, renderMemory } from './memory';
import { describeError, streamChat } from './llm';
import { actionLabel, inferTrouble, pickActions, smallerAction } from './actions';
import {
  latestPlayerIsShortContact,
  mentionsLocalVenue,
  socialReplyForMock,
} from './dialogue';
import { mockCardText } from './personas';
import {
  ADVICE_DECIDE_RULES,
  CARD_RULES,
  cardPrompt,
  cleanLine,
  COMMENT_RULES,
  commentPrompt,
  decidePrompt,
  systemFor,
} from './prompts';

const DAY = 86_400_000;
const MIN = 60_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const uid = () => crypto.randomUUID();
const scale = (settings: WorldSettings) => Math.max(1, settings.speed);

const allowedWeight = (intimacy: number): 1 | 2 | 3 =>
  intimacy < 30 ? 1 : intimacy < 60 ? 2 : 3;

const setMind = (personas: Persona[], id: string, mind: PersonaMind): Persona[] =>
  personas.map((p) => (p.id === id ? { ...p, mind } : p));

const rememberAbout = (
  personas: Persona[],
  id: string,
  about: string,
  what: string,
  postId: string,
  now: number,
): Persona[] =>
  personas.map((p) =>
    p.id === id
      ? {
          ...p,
          memory: addMemory(
            p.memory,
            {
              at: now,
              about,
              what: what.replace(/\s+/g, ' ').slice(0, 34),
              weight: inferWeight(what),
              postId,
            },
            now,
          ),
        }
      : p,
  );

export function notePlayerShare(personas: Persona[], text: string): Persona[] {
  if (!isHeavyShare(text)) return personas;
  return personas.map((p) => ({
    ...p,
    intimacy: Math.min(100, p.intimacy + 6),
    shareBoost: 1,
  }));
}

export function pickArrivals(personas: Persona[], count: number): Persona[] {
  const rest = [...personas];
  const out: Persona[] = [];
  while (out.length < count && rest.length) {
    const total = rest.reduce((sum, p) => sum + Math.max(2, p.replyDesire), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < rest.length - 1; idx++) {
      r -= Math.max(2, rest[idx].replyDesire);
      if (r <= 0) break;
    }
    out.push(rest.splice(idx, 1)[0]);
  }
  return out;
}

export function createPlayerCard(
  text: string,
  identityName: string,
  personas: Persona[],
  settings: WorldSettings,
  title?: string,
  now = Date.now(),
  kind: 'worry' | 'brag' = 'worry',
): Card {
  const cap = Math.max(1, settings.maxArrivals);
  const n = Math.min(cap, 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0));
  const chosen = pickArrivals(personas, Math.max(1, n));
  const plan = chosen.map((p, i) => ({
    personaId: p.id,
    at:
      now +
      ((i === 0 ? rand(8, 20) : i === 1 ? rand(20, 50) : rand(45, 90)) * 1000) / scale(settings),
  }));
  return {
    id: uid(),
    authorId: 'me',
    authorName: identityName,
    authorKind: 'player',
    title: title?.trim() || undefined,
    kind,
    likes: 0,
    likedByMe: false,
    helperAt: now + (kind === 'brag' ? 6000 : 4000) / scale(settings),
    text,
    createdAt: now,
    status: 'stuck',
    arrivals: [],
    plan,
    pending: [],
    comments: [],
  };
}

export function personaCard(persona: Persona, now = Date.now()): Card {
  const weight = allowedWeight(persona.intimacy);
  return {
    id: uid(),
    authorId: persona.id,
    authorName: persona.name,
    authorKind: 'persona',
    text: mockCardText(persona, weight),
    weight,
    createdAt: now,
    status: 'stuck',
    arrivals: [],
    plan: [],
    pending: [],
    comments: [],
    topic: '',
  };
}

export function addPlayerComment(
  card: Card,
  text: string,
  now = Date.now(),
  speed = 6,
  kind: 'comment' | 'advice' = 'comment',
  peer?: string,
): Card {
  const comments = [
    ...card.comments,
    { id: uid(), authorId: 'me', authorKind: 'player' as const, text, at: now, kind, peer },
  ];
  const pending = [...card.pending];
  const target =
    peer === '' ? undefined : peer ?? (card.authorKind === 'persona' ? card.authorId : undefined);
  if (!target) {
    return { ...card, comments, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (kind === 'advice') {
    pending.push({ personaId: target, at: now + (rand(4, 10) * 1000) / speed, phase: 'decide' });
    return { ...card, comments, pending, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (pending.length < 3) {
    pending.push({ personaId: target, at: now + (rand(3, 12) * 1000) / speed, phase: 'reply' });
  }
  return {
    ...card,
    comments,
    pending,
    status: card.status === 'stuck' ? 'talking' : card.status,
  };
}

export function summonPersona(card: Card, personaId: string, now = Date.now()): Card {
  if (card.arrivals.includes(personaId)) return card;
  return {
    ...card,
    plan: [...card.plan.filter((p) => p.personaId !== personaId), { personaId, at: now - 1 }],
  };
}

export function shrinkAdvice(card: Card, now = Date.now()): Card {
  const advice = card.advice;
  if (!advice?.actionId) return card;
  const smaller = smallerAction(advice.actionId);
  if (!smaller) return card;
  return {
    ...card,
    advice: { ...advice, text: smaller.label, actionId: smaller.id, at: now },
    comments: [
      ...card.comments,
      {
        id: uid(),
        authorId: advice.fromPersonaId,
        authorKind: 'persona',
        text: smaller.line,
        at: now,
      },
    ],
  };
}

export function acceptAdvice(card: Card, now = Date.now()): Card {
  if (!card.advice) return card;
  return {
    ...card,
    status: 'noted',
    advice: { ...card.advice, accepted: true },
    note: {
      text: card.advice.text,
      actionId: card.advice.actionId,
      fromPersonaId: card.advice.fromPersonaId,
      at: now,
      dueAt: now + DAY,
    },
  };
}

export function closeCard(card: Card, now = Date.now()): Card {
  return { ...card, status: 'handled', handledAt: now };
}

export function completeCard(card: Card, now = Date.now(), speed = 6): Card {
  const label = card.note?.text ?? '那件小事';
  const pool = [
    ...new Set([card.advice?.fromPersonaId, ...card.arrivals].filter(Boolean) as string[]),
  ].slice(0, 2);
  const pending: PendingReply[] = pool.map((personaId, i) => ({
    personaId,
    at: now + ((i === 0 ? rand(10, 40) : rand(40, 110)) * 1000) / Math.max(1, speed),
    phase: 'reaction',
  }));
  return {
    ...card,
    status: 'done',
    doneAt: now,
    pending,
    comments: [
      ...card.comments,
      { id: uid(), authorId: 'me', authorKind: 'player', text: `做到了：${label}。`, at: now },
    ],
  };
}

interface Ctx {
  config: LlmConfig;
  settings: WorldSettings;
  calls: number;
  logs: string[];
}

type MockTopic = 'study' | 'future' | 'people' | 'self';

const pick = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)];

const topicGroup = (trouble: TroubleKind): MockTopic =>
  trouble === 'study' || trouble === 'future' ? trouble : trouble === 'self' ? 'self' : 'people';

const TOPIC_WORD: Record<MockTopic, string> = {
  study: '考试',
  future: '找工作',
  people: '跟人有关',
  self: '最近的状态',
};

const TENTATIVE: Record<string, (word: string) => string> = {
  shenmo: (word) => `呃……${word}的事啊。我也刚来，不太会接，但我在听。`,
  weini: (word) => `嗯……${word}，我可能也说不好。你想从哪讲起？`,
  miaoze: (word) => `我也刚来，不太会回。${word}的话，先说是哪一件？`,
  yanggao: (word) => `哎，${word}啊。我其实也不太懂，不过你说，我听着。`,
};

const MOCK_LINES: Record<MockTopic, Record<string, { arrival: string[]; reply: string[] }>> = {
  study: {
    shenmo: {
      arrival: [
        '论文或考试都挺磨人的。我写报告也这样，打开文档先刷十分钟手机。',
        '卡在哪一步？开题、找资料还是第一段？',
      ],
      reply: [
        '我写不出来的时候，会先把标题和三个小标题打出来，别的不写。',
        '嗯，越想着写完越开不了头。先写一行也行。',
      ],
    },
    weini: {
      arrival: [
        '嗯……写不出来的时候，我脑子也会一直转。你卡在开头吗？',
        '我可能也说不好，但我可以听。',
      ],
      reply: [
        '我写东西卡住时，会先把文档打开，写一句最丑的开头。',
        '嗯……听起来你不是不会写，是太怕写不好。',
      ],
    },
    miaoze: {
      arrival: ['卡在哪一步？开题、找资料还是写第一段？', '先说说要写多少字，别急着想整篇。'],
      reply: ['我会先把提纲列三行，写完一行再说。', '写不出来就先写标题，标题不用好。'],
    },
    yanggao: {
      arrival: ['论文真的烦！你写到哪了？', '哎，考试周或论文周都这样，我打开文档就发呆。'],
      reply: ['我写东西也拖，后来先只写标题。', '别想整篇了，我一般先写三行，写完就去吃饭。'],
    },
  },
  future: {
    shenmo: {
      arrival: ['找工作和考试一样，越看别人越慌。你先说卡在哪一步。', '简历还是面试？先说一个。'],
      reply: ['我会先把收藏的岗位关掉一半，只留一个。', '嗯，收藏不等于要投。先挑一个看看就行。'],
    },
    weini: {
      arrival: ['校招群我都不太敢点开……你是卡在简历，还是投？', '嗯……找工作的事，我听着。'],
      reply: ['我可能会先把简历打开，只改一行。', '嗯……别人发面经的时候，我也会觉得自己差很多。'],
    },
    miaoze: {
      arrival: ['校招群我也不敢点开。你是卡在投，还是卡在写简历？', '先说是哪一步，简历、投递还是面试。'],
      reply: ['我会先把收藏的岗位描述打开，只读第一段。', '简历先改第一行就行，不用整份重写。'],
    },
    yanggao: {
      arrival: ['找工作听着就头大。你是卡在哪一步？', '校招群我也看不懂，先说说。'],
      reply: ['要不去投一个最不重要的，练练手？', '简历先打开看一眼，别改，先看。'],
    },
  },
  people: {
    shenmo: {
      arrival: ['跟人有关的事，最难说清。你先讲。', '是室友还是朋友？我听着。'],
      reply: ['我一般会先把想说的话写在备忘录里，不急着发。', '嗯，那种话当场说不出来很正常。'],
    },
    weini: {
      arrival: ['嗯……跟人有关的话，我可能也说不清。你先讲。', '我在。不会往外说的。'],
      reply: ['我也有点怕说错话。你要不要先打出来，不发也行。', '嗯……听起来你不是不在意，是不知道怎么开口。'],
    },
    miaoze: {
      arrival: ['跟人有关的事，信息太少容易想多。先说发生了什么。', '是室友、朋友还是家里？'],
      reply: [
        '这种事我会先把想说的话写下来，再决定发不发。',
        '先把事实和你的感受分开写，可能会清楚一点。',
      ],
    },
    yanggao: {
      arrival: ['谁惹你了？先说说。', '哎，人际的事最烦。你说。'],
      reply: ['我刚下楼买了瓶喝的，回来接着听你说。', '别闷着，先给那个人发个表情也行。'],
    },
  },
  self: {
    shenmo: {
      arrival: ['怎么了？你说，我听着。', '在的。我刚好背完一页，你说。'],
      reply: ['我也这样，坐着坐着就烦。先起来接杯水也行。', '嗯，不用急着讲清楚，坐一会儿。'],
    },
    weini: {
      arrival: ['嗯……我在。你要讲的话，我可以听。', '那个……你先说，我不急。'],
      reply: ['我有时候也会这样，什么也不想做。', '嗯……先不用逼自己好起来。'],
    },
    miaoze: {
      arrival: ['什么方面？要是能说清楚是哪一件，可能就好处理点。', '在的。先说说，不急着解决。'],
      reply: ['我这两天也这样，越想越乱。先挑一件最小的。', '要不先拆成两件事看看？'],
    },
    yanggao: {
      arrival: ['哎你来了！谁惹你了？', '在在在，怎么了。'],
      reply: ['我刚下楼买了瓶喝的，回来接着听。', '别闷着，你说，我听着呢。'],
    },
  },
};

const PEER_LINES: Record<string, string[]> = {
  shenmo: ['我倒没这么觉得，不过也可能是我没看懂。', '嗯，你说的这句我也想过。', '先别急着下结论吧。'],
  weini: ['我也说不好……但我理解你的意思。', '嗯，刚才那句我也有同感。', '你们两个说的我都听进去了。'],
  miaoze: ['我倒觉得可以先拆开看。', '你这个说法有点绝对。', '那得看具体是哪一步卡住。'],
  yanggao: ['哎你别吓她。', '哈哈，也没那么严重吧。', '我站她这边。'],
};

function mockComment(persona: Persona, card: Card, phase: 'arrival' | 'reply'): string {
  const social = socialReplyForMock(persona, card, phase);
  if (social) return social;
  const latest = [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  if (
    phase === 'reply' &&
    latest?.authorKind === 'persona' &&
    latest.authorId !== persona.id &&
    Math.random() < 0.35
  ) {
    return pick(PEER_LINES[persona.id] ?? ['嗯，我听着。']);
  }
  const rows = MOCK_LINES[topicGroup(inferTrouble(card.text))][persona.id];
  const list = rows?.[phase];
  if (list?.length) return pick(list);
  return phase === 'arrival' ? '我看到了。你说。' : '嗯，我在听。';
}

function reactionLine(persona: Persona): string {
  const pool: Record<string, string[]> = {
    shenmo: ['真做了啊。挺好的，今晚别再逼自己了。', '行，那这一步算数。我这边也去背一页。'],
    weini: ['嗯……你做了。那就先这样，别再要求更多了。', '挺好的。做到这一点已经很不容易。'],
    miaoze: ['可以，动作虽小但算数。', '行，那今晚就先到这儿。'],
    yanggao: ['行啊你！这一步就算数了。', '漂亮，做一点是一点。'],
  };
  return pick(pool[persona.id] ?? ['这一步算数。']);
}

const FOLLOW_LINES: Record<string, string[]> = {
  shenmo: ['你说的那一步我做了。没想象中那么难。', '照你说的做了。至少今晚能睡踏实点。'],
  weini: ['嗯……我按你说的做了。好像可以。', '你说的那一步我试了，没有想的那么可怕。'],
  miaoze: ['你说的那一步我做了，确实比整块想容易。', '按你说的试了一下，能做。'],
  yanggao: ['你说的那招我用了，还真行。', '按你说的做了，没那么难嘛。'],
};

const ACCEPT_LINES = ['行，我试试。', '好，这个我能做。', '嗯，那我先做这一步。'];
const REFUSE_LINES = [
  '这个我可能做不到。',
  '今晚可能不行，我状态太差。',
  '我连打开都不想，但可以试试。',
];

async function callOnce(ctx: Ctx, system: string, user: string, maxTokens: number) {
  ctx.calls++;
  return streamChat({
    config: ctx.config,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    signal: new AbortController().signal,
    sessionId: `ses_c_${Math.random().toString(36).slice(2, 10)}`,
    onDelta: () => {},
    maxTokens,
    lowEffort: true,
  });
}

async function generateComment(
  ctx: Ctx,
  persona: Persona,
  card: Card,
  phase: 'arrival' | 'reply',
): Promise<string> {
  if (isMock(ctx.config)) {
    if (persona.intimacy < 22 && card.comments.length === 0) {
      const line = TENTATIVE[persona.id];
      if (line) return line(TOPIC_WORD[topicGroup(inferTrouble(card.text))]);
    }
    return mockComment(persona, card, phase);
  }
  try {
    const text = await callOnce(
      ctx,
      systemFor(
        persona,
        renderMemory(persona.memory, Date.now()),
        `${COMMENT_RULES}${
          persona.intimacy < 22 && card.comments.length === 0
            ? ' 你和这个人还不熟，也不太确定这里该怎么说话：句子短一点，别用亲昵称呼，别急着给建议，可以说「我也说不好」。'
            : ''
        }${
          persona.shareBoost
            ? ' 你刚听对方说了一件挺重的事。这一句可以带一点你自己的类似经历，但不要比较、不要说教。'
            : ''
        }`,
        ctx.settings.baselineExtra,
      ),
      commentPrompt(card, persona),
      400,
    );
    const line = cleanLine(text);
    const shortContact = latestPlayerIsShortContact(card);
    if (
      line &&
      !findCrisis(line) &&
      !auditTone(line) &&
      !auditSocial(line) &&
      !(shortContact && mentionsLocalVenue(line))
    ) {
      return line;
    }
    ctx.logs.push(`${persona.name} 的那句被拦下了，换了一句`);
  } catch (err) {
    ctx.logs.push(`${persona.name} 这次没说话：${describeError(err)}`);
  }
  return mockComment(persona, card, phase);
}

function dailyQuota(personas: Persona[]) {
  return Math.min(8, 4 + Math.max(0, personas.length - 4));
}

async function generateAiCard(
  ctx: Ctx,
  persona: Persona,
  recent: string[],
  now: number,
  weight: 1 | 2 | 3,
): Promise<{ text: string; fact: string } | null> {
  if (isMock(ctx.config)) return { text: mockCardText(persona, weight), fact: '' };
  try {
    const text = await callOnce(
      ctx,
      systemFor(persona, renderMemory(persona.memory, now), CARD_RULES, ctx.settings.baselineExtra),
      cardPrompt(recent, new Date(now), weight, persona.intimacy),
      400,
    );
    const [body, fact] = text.split('|||');
    const card = cleanLine(body ?? text, 120);
    if (!card || findCrisis(card) || auditTone(card) || auditSocial(card)) {
      ctx.logs.push(`${persona.name} 的卡被拦下了`);
      return null;
    }
    const cleanFact = fact && !/^无/.test(fact.trim()) ? cleanLine(fact, 60) : '';
    return { text: card, fact: cleanFact };
  } catch {
    ctx.logs.push(`${persona.name} 这次没发出来`);
    return null;
  }
}

export interface TickInput {
  cards: Card[];
  personas: Persona[];
  settings: WorldSettings;
  config: LlmConfig;
  now?: number;
}

export interface TickOutput {
  cards: Card[];
  personas: Persona[];
  calls: number;
  logs: string[];
}

export async function tickCards(input: TickInput): Promise<TickOutput> {
  const now = input.now ?? Date.now();
  if (input.settings.paused) {
    return { cards: input.cards, personas: input.personas, calls: 0, logs: [] };
  }
  const ctx: Ctx = { config: input.config, settings: input.settings, calls: 0, logs: [] };
  let personas: Persona[] = input.personas.map((p) => ({
    ...p,
    memory: [...p.memory],
    weekLog: [...p.weekLog],
    mind: ensureMind(p, now),
  }));
  const limit = isMock(input.config) ? 6 : Math.max(1, input.settings.maxCallsPerTick);
  const speed = scale(input.settings);

  const cards: Card[] = [];
  let peerScheduled = false;
  for (const original of input.cards) {
    let card: Card = {
      ...original,
      comments: [...original.comments],
      arrivals: [...original.arrivals],
      plan: [...original.plan],
      pending: [...original.pending],
    };

    if (
      !peerScheduled &&
      card.authorKind === 'persona' &&
      card.status !== 'done' &&
      card.status !== 'handled' &&
      card.pending.length === 0 &&
      card.comments.length < 3 &&
      now - card.createdAt > 10 * MIN &&
      Math.random() < 0.12
    ) {
      const candidates = personas.filter(
        (p) => p.id !== card.authorId && !card.arrivals.includes(p.id),
      );
      const responder = pickArrivals(candidates, 1)[0];
      if (responder) {
        card.pending.push({
          personaId: responder.id,
          at: now + (rand(6, 20) * 1000) / speed,
          phase: 'reply',
        });
        peerScheduled = true;
      }
    }

    if (
      card.helperAt &&
      now >= card.helperAt &&
      !card.comments.some((c) => c.authorId === 'helper')
    ) {
      card = {
        ...card,
        helperAt: undefined,
        comments: [
          ...card.comments,
          {
            id: uid(),
            authorId: 'helper',
            authorKind: 'helper',
            text:
              card.kind === 'brag'
                ? '记下了。做到了就是做到了，不用写得漂亮。'
                : '看到了。先不用急着讲清楚，坐一会儿，会有人陆续来。',
            at: now,
          },
        ],
      };
    }

    if (card.status === 'noted' && card.note && now > card.note.dueAt) {
      card = { ...card, status: 'handled', handledAt: now, note: undefined };
    }
    if (
      (card.status === 'talking' || card.status === 'advised') &&
      now - card.createdAt > DAY
    ) {
      card = { ...card, status: 'handled', handledAt: now };
    }

    for (const item of card.plan.filter((p) => p.at <= now)) {
      if (ctx.calls >= limit) break;
      const persona = personas.find((p) => p.id === item.personaId);
      card.plan = card.plan.filter((p) => p !== item);
      if (!persona) continue;
      const text = await generateComment(ctx, persona, card, 'arrival');
      card.comments.push({
        id: uid(),
        authorId: persona.id,
        authorKind: 'persona',
        text,
        at: item.at,
      });
      card.arrivals.push(persona.id);
      if (card.status === 'stuck') card.status = 'arrived';
      else if (card.status === 'arrived') card.status = 'talking';
      personas = setMind(personas, persona.id, mindAfterReply(persona, card.authorName, now));
      if (card.authorId === 'me') {
        personas = rememberAbout(personas, persona.id, '你', card.text, card.id, now);
      } else if (card.authorKind === 'persona' && card.authorId !== persona.id) {
        const author = personas.find((p) => p.id === card.authorId);
        if (author) {
          personas = setMind(personas, author.id, mindAfterPeer(author, persona.name, text, now));
          personas = rememberAbout(personas, author.id, persona.name, text, card.id, now);
        }
        personas = rememberAbout(personas, persona.id, card.authorName, card.text, card.id, now);
      }
    }

    const ready = card.pending.filter((p) => p.at <= now).sort((a, b) => a.at - b.at)[0];
    if (ready && ctx.calls < limit) {
      const persona = personas.find((p) => p.id === ready.personaId);
      card.pending = card.pending.filter((p) => p !== ready);
      if (persona) {
        let said = '';
        let accepted: boolean | undefined;
        let adviceText = '';
        if (ready.phase === 'reaction') {
          said = reactionLine(persona);
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text: said,
            at: ready.at,
          });
        } else if (ready.phase === 'decide') {
          const adviceComment = [...card.comments].reverse().find((c) => c.kind === 'advice');
          adviceText = adviceComment?.text ?? '';
          let accept = Math.random() < 0.7;
          let reply = accept ? pick(ACCEPT_LINES) : pick(REFUSE_LINES);
          if (!isMock(ctx.config) && adviceText) {
            try {
              const raw = await callOnce(
                ctx,
                systemFor(
                  persona,
                  renderMemory(persona.memory, now),
                  ADVICE_DECIDE_RULES,
                  input.settings.baselineExtra,
                ),
                decidePrompt(card, adviceText),
                200,
              );
              const [head, ...rest] = raw.split('|');
              const said = cleanLine(rest.join('|'), 60);
              if (/^接受/.test(head.trim()) && said) {
                accept = true;
                reply = said;
              } else if (/^拒绝/.test(head.trim()) && said) {
                accept = false;
                reply = said;
              }
            } catch {
              ctx.logs.push(`${persona.name} 没接住这句建议`);
            }
          }
          said = reply;
          accepted = accept;
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text: said,
            at: ready.at,
          });
          if (accept) {
            card.advice = {
              text: adviceText,
              fromPersonaId: 'me',
              at: ready.at,
              accepted: true,
            };
            card.status = 'advised';
          } else {
            const refused = (card.refused ?? 0) + 1;
            card = { ...card, refused };
            if (refused >= 2) {
              card = { ...card, status: 'handled', handledAt: ready.at };
            }
          }
        } else {
          said = await generateComment(ctx, persona, card, 'reply');
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text: said,
            at: ready.at,
          });
        }

        if (said) {
          personas = setMind(personas, persona.id, mindAfterReply(persona, card.authorName, now));
          if (card.authorId === 'me') {
            personas = rememberAbout(personas, persona.id, '你', card.text, card.id, now);
          } else if (card.authorKind === 'persona' && card.authorId !== persona.id) {
            const author = personas.find((p) => p.id === card.authorId);
            if (author) {
              personas = setMind(personas, author.id, mindAfterPeer(author, persona.name, said, now));
              personas = rememberAbout(personas, author.id, persona.name, said, card.id, now);
            }
            personas = rememberAbout(personas, persona.id, card.authorName, card.text, card.id, now);
          }
        }

        if (accepted !== undefined) {
          const self = personas.find((p) => p.id === persona.id);
          if (self) {
            personas = setMind(personas, persona.id, {
              ...ensureMind(self, now),
              mood: accepted ? 'warm' : 'tense',
              thought: accepted
                ? '有人给了我一个能做的办法，也许可以试试。'
                : '那个办法我暂时做不到。',
              lastActAt: now,
              lastAct: 'reply',
            });
          }
          if (accepted) {
            personas = rememberAbout(personas, persona.id, '你', adviceText, card.id, now);
          }
        }
      }
    }

    if (
      card.authorKind === 'persona' &&
      card.advice?.accepted &&
      card.status !== 'done' &&
      now - card.advice.at > 90_000 / speed
    ) {
      const label = card.advice.text;
      card = {
        ...card,
        status: 'done',
        doneAt: now,
        comments: [
          ...card.comments,
          {
            id: uid(),
            authorId: card.authorId,
            authorKind: 'persona',
            text: pick(FOLLOW_LINES[card.authorId] ?? ['你说的那一步我做了。']),
            at: now,
          },
        ],
      };
      personas = personas.map((p) =>
        p.id === card.authorId
          ? {
              ...p,
              mind: mindAfterStep(p, now),
              weekLog: [
                ...p.weekLog,
                { at: now, text: `照着别人给的小步「${label}」做了一次` },
              ].slice(-8),
            }
          : p,
      );
      personas = rememberAbout(
        personas,
        card.authorId,
        '你',
        `照着「${label}」做了一次`,
        card.id,
        now,
      );
      ctx.logs.push(`${card.authorName} 做到了「${label}」`);
    }

    cards.push(card);
  }

  const todayCards = cards.filter(
    (c) => c.authorKind === 'persona' && now - c.createdAt < 24 * 60 * MIN,
  );
  const quota = dailyQuota(personas);
  if (todayCards.length < quota && ctx.calls < limit && personas.length) {
    const candidates = personas.filter((p) => !todayCards.some((c) => c.authorId === p.id));
    const pool = candidates.length ? candidates : personas;
    const persona = pool[Math.floor(Math.random() * pool.length)];
    const recent = cards.filter((c) => c.authorId === persona.id).slice(0, 3).map((c) => c.text);
    const boost = persona.shareBoost ? 1 : 0;
    const weight = Math.min(3, allowedWeight(persona.intimacy) + boost) as 1 | 2 | 3;
    const made = await generateAiCard(ctx, persona, recent, now, weight);
    if (made) {
      const nextCard: Card = {
        id: uid(),
        authorId: persona.id,
        authorName: persona.name,
        authorKind: 'persona',
        text: made.text,
        weight,
        createdAt: now,
        status: 'stuck',
        arrivals: [],
        plan: [],
        pending: [],
        comments: [],
        topic: made.text.slice(0, 12),
      };
      const responders = pickArrivals(
        personas.filter((p) => p.id !== persona.id),
        1 + (Math.random() < 0.6 ? 1 : 0),
      );
      responders.forEach((p, i) => {
        nextCard.pending.push({
          personaId: p.id,
          at: now + ((i === 0 ? rand(10, 30) : rand(30, 70)) * 1000) / speed,
          phase: 'reply',
        });
      });
      cards.push(nextCard);
      personas = personas.map((p) =>
        p.id === persona.id
          ? {
              ...p,
              mind: mindAfterPost(p, made.text, now),
              shareBoost: undefined,
              weekLog: made.fact
                ? [...p.weekLog, { at: now, text: made.fact }].slice(-8)
                : p.weekLog,
            }
          : p,
      );
    }
  }

  return { cards, personas, calls: ctx.calls, logs: ctx.logs };
}

export async function askForAdvice(
  input: TickInput & { cardId: string },
): Promise<{ cards: Card[]; personas: Persona[]; calls: number; logs: string[] }> {
  const now = input.now ?? Date.now();
  const card = input.cards.find((c) => c.id === input.cardId);
  if (!card) return { cards: input.cards, personas: input.personas, calls: 0, logs: [] };
  const persona = input.personas.find((p) => card.arrivals.includes(p.id)) ?? input.personas[0];
  if (!persona) return { cards: input.cards, personas: input.personas, calls: 0, logs: [] };

  const trouble = inferTrouble(card.text);
  const options = pickActions(new Date(now).getHours(), 3, trouble, card.text);
  const action = options[0];
  let text = action.line;
  let calls = 0;

  if (!isMock(input.config)) {
    try {
      calls++;
      const raw = await streamChat({
        config: input.config,
        messages: [
          {
            role: 'system',
            content: systemFor(
              persona,
              renderMemory(persona.memory, now),
              '从下面三个小步里挑一个最适合这张卡的，用你自己此刻的口气改写，不要照抄候选句子，不超过 30 字。优先选跟卡片内容最相关的。只输出一行：编号|你说的话',
              input.settings.baselineExtra,
            ),
          },
          {
            role: 'user',
            content: `卡片：${card.text}\n\n${options
              .map((o) => `${o.id} | ${o.label}（${o.minutes} 分钟）`)
              .join('\n')}`,
          },
        ],
        signal: new AbortController().signal,
        onDelta: () => {},
        maxTokens: 200,
        lowEffort: true,
      });
      const said = cleanLine(raw.split('|').slice(1).join('|'), 60);
      if (said && !auditTone(said) && !auditSocial(said) && !findCrisis(said)) text = said;
    } catch {
      text = action.line;
    }
  }

  const next: Card = {
    ...card,
    advice: { text, actionId: action.id, fromPersonaId: persona.id, at: now, accepted: false },
    status: 'advised',
    comments: [
      ...card.comments,
      { id: uid(), authorId: persona.id, authorKind: 'persona' as const, text, at: now },
    ],
  };
  let personas = input.personas.map((p) =>
    p.id === persona.id ? { ...p, mind: mindAfterReply(p, card.authorName, now) } : p,
  );
  personas = rememberAbout(personas, persona.id, '你', card.text, card.id, now);
  return {
    cards: input.cards.map((c) => (c.id === card.id ? next : c)),
    personas,
    calls,
    logs: [`${persona.name} 给了一个下一步：${action.label}`],
  };
}

export async function catchUp(
  input: TickInput & { hours: number },
): Promise<{ cards: Card[]; personas: Persona[]; calls: number }> {
  const count = Math.min(4, Math.max(1, Math.round(input.hours / 3)));
  const ctx: Ctx = { config: input.config, settings: input.settings, calls: 0, logs: [] };
  let personas: Persona[] = input.personas.map((p) => ({
    ...p,
    memory: [...p.memory],
    weekLog: [...p.weekLog],
    mind: ensureMind(p, now),
  }));
  const cards = [...input.cards];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    if (!isMock(input.config) && ctx.calls >= 4) break;
    const persona = personas[Math.floor(Math.random() * personas.length)];
    if (!persona) break;
    const weight = allowedWeight(persona.intimacy);
    const at = now - rand(25, 25 + 55 * (i + 1)) * 60_000;
    const recent = cards
      .filter((c) => c.authorId === persona.id)
      .slice(0, 3)
      .map((c) => c.text);
    const made = await generateAiCard(ctx, persona, recent, at, weight);
    if (!made) continue;
    const card: Card = {
      id: uid(),
      authorId: persona.id,
      authorName: persona.name,
      authorKind: 'persona',
      text: made.text,
      weight,
      createdAt: at,
      status: 'stuck',
      arrivals: [],
      plan: [],
      pending: [],
      comments: [],
      topic: made.text.slice(0, 12),
    };
    const chosen = pickArrivals(
      personas.filter((p) => p.id !== persona.id),
      1 + (Math.random() < 0.5 ? 1 : 0),
    );
    chosen.forEach((p, idx) => {
      card.pending.push({ personaId: p.id, at: at + (2 + idx * 3) * 60_000, phase: 'reply' });
    });
    cards.push(card);
    personas = personas.map((p) =>
      p.id === persona.id
        ? {
            ...p,
            mind: mindAfterPost(p, made.text, at),
            weekLog: made.fact
              ? [...p.weekLog, { at, text: made.fact }].slice(-8)
              : p.weekLog,
          }
        : p,
    );
  }
  return { cards, personas, calls: ctx.calls };
}

export function markSeen(card: Card, now = Date.now()): Card {
  return card.seenAt ? card : { ...card, seenAt: now };
}

const bragLines = [
  '做到了：把简历投出去了。\n比想的简单一点。',
  '做到了：去问了辅导员。\n排队排了四十分钟，但问到了。',
  '做到了：把桌面收了。\n现在能看见桌垫了。',
  '做到了：给家里打了电话。\n没吵架。',
  '做到了：下楼走了两圈。\n风挺大，人清醒了。',
];

export function personaBrag(persona: Persona, now = Date.now()): Card {
  return {
    id: uid(),
    authorId: persona.id,
    authorName: persona.name,
    authorKind: 'persona',
    kind: 'brag',
    title: '做到了',
    text: bragLines[Math.floor(Math.random() * bragLines.length)],
    likes: 0,
    likedByMe: false,
    createdAt: now,
    status: 'handled',
    handledAt: now,
    arrivals: [],
    plan: [],
    pending: [],
    comments: [],
    readAt: undefined,
  };
}

export const actionMeta = (id?: string) => ({
  label: id ? actionLabel(id) : '',
  exists: Boolean(id),
});
