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
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import {
  ensureMind,
  mindAfterPeer,
  mindAfterPost,
  mindAfterReply,
  mindAfterStep,
} from './mind';
import { findCrisis, isHeavyShare } from './safety';
import { wantsDirectAdvice } from './directAdvice';
import { hasPlayerCrisis } from './submissionGuard';
import { introPhaseActive } from './seed';
import { addMemory, inferWeight, sanitizeMemoryText } from './memory';
import { describeError, streamChat } from './llm';
import { actionLabel, inferTrouble, pickActions, smallerAction } from './actions';
import { HELP_SEEKING_ACTIONS, isHelpSeekingAction, needsHelpSeeking, nextSmallerHelpAction } from './support';
import {
  boundaryAttemptCount,
  boundaryRequest,
  dependencySupportReply,
  inferSocialIntent,
  isDependencySignal,
  latestPlayerIsShortContact,
  mentionsLocalVenue,
  mockBoundaryReply,
  mockSocialReply,
  socialReplyForMock,
  triggeringPlayerComment,
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
  withUntrustedHistory,
} from './prompts';

const DAY = 86_400_000;
const MIN = 60_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const uid = () => crypto.randomUUID();
const scale = (settings: WorldSettings) => Math.max(1, settings.speed);

/** 包括旧存档/导入评论与标题：在角色任务运行前审查整张卡的玩家内容。 */
const hasPlayerCrisisInput = (card: Card): boolean => hasPlayerCrisis(card);

const isClosed = (card: Card): boolean => card.status === 'done' || card.status === 'handled';

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
              what: sanitizeMemoryText(what).replace(/\s+/g, ' ').slice(0, 34),
              weight: inferWeight(what),
              postId,
            },
            now,
          ),
        }
      : p,
  );

/** 尊重卡片的 noMemory 标识，避免将玩家内容永久写入角色档案。 */
const rememberOnCard = (
  personas: Persona[], card: Card, id: string, about: string, what: string, now: number,
): Persona[] => card.noMemory ? personas : rememberAbout(personas, id, about, what, card.id, now);

// 旧入口允许 App 继续传两个参数，但没有明确可见对象时不修改任何人的关系。
// 只有已经看见这次分享的角色才会变得更熟悉。
export function notePlayerShare(
  personas: Persona[], text: string, visiblePersonaIds: readonly string[] = [],
): Persona[] {
  if (!isHeavyShare(text) || !visiblePersonaIds.length) return personas;
  const visible = new Set(visiblePersonaIds);
  return personas.map((p) => visible.has(p.id)
    ? { ...p, intimacy: Math.min(100, p.intimacy + 6), shareBoost: 1 }
    : p);
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
  // 有明显脆弱内容时，让更擅长倾听的角色先到；不让随机排序把轻松玩笑放在第一条。
  const needsAnchor = isHeavyShare(text) || needsHelpSeeking(text);
  const anchor = needsAnchor
    ? ['shenmo', 'weini', 'miaoze', 'yanggao'].map((id) => personas.find((p) => p.id === id)).find(Boolean)
    : undefined;
  const chosen = anchor
    ? [anchor, ...pickArrivals(personas.filter((p) => p.id !== anchor.id), Math.max(0, n - 1))]
    : pickArrivals(personas, Math.max(1, n));
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
    origin: 'demo',
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
  replyTo?: string,
): Card {
  // App 负责展示危机求助层；底层再挡一次，避免其他入口直接入库及安排 AI 回帖。
  if (findCrisis(text) || hasPlayerCrisisInput(card) || isClosed(card)) return card;
  const commentId = uid();
  const comments = [
    ...card.comments,
    { id: commentId, authorId: 'me', authorKind: 'player' as const, text, at: now, kind, peer, replyTo },
  ];
  const pending = [...card.pending];
  const target =
    peer === '' ? undefined : peer ?? (card.authorKind === 'persona' ? card.authorId : undefined);
  if (!target) {
    return { ...card, comments, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (kind === 'advice') {
    pending.push({ personaId: target, at: now + (rand(4, 10) * 1000) / speed, phase: 'decide', sourceCommentId: commentId });
    return { ...card, comments, pending, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (pending.length < 3) {
    pending.push({ personaId: target, at: now + (rand(3, 12) * 1000) / speed, phase: 'reply', sourceCommentId: commentId });
  }
  return {
    ...card,
    comments,
    pending,
    status: card.status === 'stuck' ? 'talking' : card.status,
  };
}

export function summonPersona(card: Card, personaId: string, now = Date.now()): Card {
  if (isClosed(card) || hasPlayerCrisisInput(card) || card.arrivals.includes(personaId)) return card;
  return {
    ...card,
    plan: [...card.plan.filter((p) => p.personaId !== personaId), { personaId, at: now - 1 }],
  };
}

/**
 * Adopt a persona's existing words as a next step. No model call or synthetic
 * actionId: this is a user-selected quote, never a regenerated model action.
 */
export function adoptCommentAdvice(
  card: Card,
  commentId: string,
  personas: readonly Persona[],
  now = Date.now(),
): { card: Card; error?: string } {
  if (card.authorKind !== 'player' || card.kind === 'guide' || isClosed(card) ||
      card.status === 'noted' || card.advice?.accepted) {
    return { card, error: '这张卡已进入便签或完成状态，不能覆盖现有下一步' };
  }
  if (hasPlayerCrisisInput(card)) return { card, error: '当前卡片需先显示危机求助提示' };
  const comment = card.comments.find((row) => row.id === commentId);
  if (!comment || comment.authorKind !== 'persona' ||
      !personas.some((persona) => persona.id === comment.authorId) ||
      comment.origin === 'boundary' || comment.origin === 'system') {
    return { card, error: '只能采用本卡真实存在的角色建议，不能采用边界或系统提示' };
  }
  const text = comment.text.trim();
  if (!text || text.length > 600 || findCrisis(text) ||
      auditSocial(text) || auditCriticalContent(text)) {
    return { card, error: '这条回复包含不适合写入便签的内容，请换一条安全、具体的建议' };
  }
  const context = [card.text, ...card.comments.filter((row) => row.authorKind === 'player')
    .map((row) => row.text)].join(' ');
  if (needsHelpSeeking(context) || isHelpSeekingAction(card.advice?.actionId)) {
    return { card, error: '当前卡片需要保留求助起点，不能用普通评论替代真人支持步骤' };
  }
  return {
    card: {
      ...card,
      status: 'advised',
      advice: {
        text, fromPersonaId: comment.authorId, sourceCommentId: comment.id,
        at: now, accepted: false, origin: 'adopted',
      },
    },
  };
}

/** Prefer the explicitly selected participant; otherwise the latest speaker. */
export function advicePersonaFor(
  card: Card,
  personas: readonly Persona[],
  requestedId?: string,
): Persona | undefined {
  const participantIds = new Set([
    ...card.arrivals,
    ...(card.authorKind === 'persona' ? [card.authorId] : []),
    ...card.comments.filter((row) => row.authorKind === 'persona').map((row) => row.authorId),
  ]);
  const byId = (id?: string) => id && participantIds.has(id)
    ? personas.find((persona) => persona.id === id)
    : undefined;
  // Do not silently substitute a different persona if an explicit selection is invalid.
  if (requestedId) return byId(requestedId) || undefined;
  for (let i = card.comments.length - 1; i >= 0; i--) {
    const row = card.comments[i];
    if (row.authorKind !== 'persona') continue;
    const found = byId(row.authorId);
    if (found) return found;
  }
  for (let i = card.arrivals.length - 1; i >= 0; i--) {
    const found = byId(card.arrivals[i]);
    if (found) return found;
  }
  return undefined;
}

export function shrinkAdvice(card: Card, now = Date.now()): Card {
  if (card.status !== 'advised' || hasPlayerCrisisInput(card)) return card;
  const advice = card.advice;
  if (advice?.accepted) return card;
  if (!advice?.actionId) return card;
  const smaller = isHelpSeekingAction(advice.actionId)
    ? nextSmallerHelpAction(advice.actionId)
    : smallerAction(advice.actionId);
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
  if (card.status !== 'advised' || !card.advice || card.advice.accepted || hasPlayerCrisisInput(card)) return card;
  return {
    ...card,
    status: 'noted',
    advice: { ...card.advice, accepted: true },
    note: {
      text: card.advice.text,
      actionId: card.advice.actionId,
      sourceCommentId: card.advice.sourceCommentId,
      fromPersonaId: card.advice.fromPersonaId,
      at: now,
      dueAt: now + DAY,
    },
  };
}

export function closeCard(card: Card, now = Date.now()): Card {
  if (isClosed(card)) return card;
  // 关闭意味着停止后续普通角色回复；不能只改 UI 状态而继续执行旧任务。
  return { ...card, status: 'handled', handledAt: now, plan: [], pending: [], helperAt: undefined };
}

export function completeCard(card: Card, now = Date.now(), speed = 6): Card {
  if (card.status !== 'noted' || !card.note || hasPlayerCrisisInput(card)) return card;
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
    plan: [],
    helperAt: undefined,
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
      arrival: ['嗯……跟人有关的话，我可能也说不清。你先讲。', '我在，你愿意说的话，我听着。'],
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

function mockComment(
  persona: Persona, card: Card, phase: 'arrival' | 'reply', sourceCommentId?: string,
): string {
  const social = socialReplyForMock(persona, card, phase, sourceCommentId);
  if (social) return social;
  const latest = sourceCommentId
    ? card.comments.find((c) => c.id === sourceCommentId)
    : [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
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
    signal: AbortSignal.timeout(20_000),
    sessionId: `ses_c_${Math.random().toString(36).slice(2, 10)}`,
    onDelta: () => {},
    maxTokens,
    lowEffort: true,
  });
}

type CommentGeneration =
  | { kind: 'reply'; text: string; origin: 'model' | 'demo' | 'boundary' | 'curated' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'crisis'; reason: string };

const curatedSafeLine = (persona: Persona) => {
  const lines: Record<string, string> = {
    shenmo: '呃，这句我先收住。你刚才说的事，我在听。',
    weini: '嗯……这句我没想好怎么说。我先听你讲。',
    miaoze: '这句我说得不合适，先回到你刚才的具体问题。',
    yanggao: '哎，我这句说跑偏了。你接着讲，我听着。',
  };
  return lines[persona.id] ?? '这句我没想好，先听你说。';
};

// 对方随口提学校/食堂时，模型容易顺着编出“我也去过”。这里统一改成不同校的口径。
const venueSafeLine = (persona: Persona) => {
  const lines: Record<string, string> = {
    shenmo: '我不在你们学校那边，食堂的情况我真不清楚。说回你刚才卡住的事吧。',
    weini: '我不在你们学校诶，食堂我没去过，也说不好……你刚说卡住的是哪件事？',
    miaoze: '咱俩不是一个学校的，食堂我还真不知道。你刚说的那个卡点还在吗？',
    yanggao: '我不在你们学校，食堂我可没去过哈哈。你刚说的那个卡点还在吗？',
  };
  return lines[persona.id] ?? '我不在你们学校，那边的情况我不清楚。说回你刚才的事吧。';
};

/** 安全拦截后的文案也按真实违规类型分流，避免问邮箱却回答“不能见面”。 */
function socialSafeReply(
  persona: Persona, auditReason: string, request: 'offline' | 'contact' | null = null,
): string {
  if (auditReason.includes('共享线下场所')) return venueSafeLine(persona);
  const reason = request === 'contact' || /(?:联系方式|邮箱|站外)/.test(auditReason)
    ? 'contact' : 'offline';
  return mockBoundaryReply(persona, 1, 0, reason);
}

/** 重点内容的第一条回复由本地保证接住；不依赖某次模型是否转移话题。 */
function firstHeavyReply(persona: Persona, sustained: boolean): string {
  if (sustained) {
    const openings: Record<string, string> = {
      shenmo: '你说自己的状态让你挺担心的。我不能判断是不是抑郁，但值得找校医或正规门诊问一次。',
      weini: '嗯……看见你为最近的状态担心了。我不是医生，找校医或正规门诊聊聊会更可靠。',
      miaoze: '你提到的状态值得认真对待。这个论坛不能诊断，校医或正规门诊能提供更合适的评估。',
      yanggao: '这回我先不岔开话题了。你的状态让你担心了，找校医或门诊聊一次会更稳妥。',
    };
    return openings[persona.id] ?? '你说状态一直不好、日常受影响了。我无法诊断，找校医或正规门诊问一次会更稳妥。';
  }
  const openings: Record<string, string> = {
    shenmo: '这件事听着挺难受的。我先不急着给办法，你想从哪一句讲起？',
    weini: '嗯……看见你写这些了。我先听着，你愿意的话就慢慢说。',
    miaoze: '你写的这件事我看到了。先不急着分析，你想先讲哪一部分？',
    yanggao: '这事有点重，我就先不拿吃饭打岔了。你说，我听着。',
  };
  return openings[persona.id] ?? '我认真看了你说的事，先听你讲，不急着给办法。';
}

function replyProblem(text: string): string | null {
  if (findCrisis(text)) return '危机表达';
  return auditCriticalContent(text) || auditTone(text) || auditSocial(text);
}

// 对短暂故障安排有上限的延迟重试，避免每个 tick 都打 API。
// 0 -> 30 秒，1 -> 90 秒；第三次失败终止，等待用户重新触发。
const RETRY_DELAYS = [30_000, 90_000] as const;
function retryLater<T extends { at: number; attempt?: number }>(item: T, now: number): T | null {
  const attempt = item.attempt ?? 0;
  if (attempt >= RETRY_DELAYS.length) return null;
  return { ...item, at: now + RETRY_DELAYS[attempt], attempt: attempt + 1 };
}
function appendCrisisNotice(card: Card, now: number): void {
  if (card.comments.some((c) => c.authorKind === 'helper' && c.origin === 'system' && /这里的 AI 无法(?:处理危机|提供即时危机援助)/.test(c.text))) return;
  card.comments.push({
    id: uid(), authorId: 'helper', authorKind: 'helper', at: now, origin: 'system',
    text: '这里的 AI 无法处理危机，也不会当作普通聊天回应。请立即联系能到场的人或当地紧急服务；中国大陆可拨打 12356 心理援助热线。',
  });
}

function errorNotice(name: string, willRetry: boolean): string {
  const next = willRetry ? '已安排稍后自动重试。' : '自动重试次数已用尽，需要重新触发回复。';
  return `${name} 这一轮没有生成回复，可能是模型超时、限流或服务暂不可用。${next}没有使用演示台词代替；也可以主动切换演示模式。`;
}

async function generateComment(
  ctx: Ctx,
  persona: Persona,
  card: Card,
  phase: 'arrival' | 'reply',
  sourceCommentId?: string,
): Promise<CommentGeneration> {
  const player = triggeringPlayerComment(card, sourceCommentId);
  const incoming = player?.text ?? (
    card.authorKind === 'player' && !card.comments.some((c) => c.authorKind === 'player')
      ? card.text : ''
  );

  // 按具体请求分流：线下/联系方式 > 情感依赖 > 严重内容的第一条回应 > 模型。
  // 危机内容应在 App 发送入口拦截；本分支再兜底，禁止把危机当普通聊天。
  if (hasPlayerCrisisInput(card) || (incoming && findCrisis(incoming))) {
    ctx.logs.push(`${persona.name} 检出危机内容，阻止普通角色回复（应由 App 显示危机层）`);
    return { kind: 'crisis', reason: 'crisis' };
  }
  const reason = incoming ? boundaryRequest(incoming) : null;
  if (reason) {
    const attempts = boundaryAttemptCount(card, sourceCommentId);
    const seed = (sourceCommentId ?? card.id).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    ctx.logs.push(`${persona.name} 触发线上边界（${reason}，第 ${attempts} 次）`);
    return { kind: 'reply', text: mockBoundaryReply(persona, attempts, seed, reason), origin: 'boundary' };
  }
  if (incoming && isDependencySignal(incoming)) {
    const sustained = needsHelpSeeking(
      `${card.authorKind === 'player' ? card.text : ''} ${card.comments.filter((c) => c.authorKind === 'player').map((c) => c.text).join(' ')}`,
    );
    ctx.logs.push(`${persona.name} 接住依赖表达（dependency）`);
    return { kind: 'reply', text: dependencySupportReply(persona, sustained), origin: 'curated' };
  }
  if (incoming && phase === 'reply' && wantsDirectAdvice(incoming)) {
    const context = [card.text, ...card.comments.filter((c) => c.authorKind === 'player').map((c) => c.text)].join(' ');
    const action = needsHelpSeeking(context)
      ? HELP_SEEKING_ACTIONS[0]
      : pickActions(new Date().getHours(), 1, inferTrouble(card.text), card.text)[0];
    if (action) {
      const lines: Record<string, string> = {
        shenmo: `先做这个：${action.label}。别管后面。`,
        weini: `那……先${action.label}？就这一个，别想多。`,
        miaoze: `先${action.label}。做完再看下一步。`,
        yanggao: `行，给你个具体的：${action.label}。先干这个。`,
      };
      ctx.logs.push(`${persona.name} 直接给出建议（direct-advice）`);
      return {
        kind: 'reply',
        text: lines[persona.id] ?? `先${action.label}。就这一步。`,
        origin: 'curated',
      };
    }
  }
  if (phase === 'arrival' && card.authorKind === 'player' && card.arrivals.length === 0 &&
      (isHeavyShare(card.text) || needsHelpSeeking(card.text))) {
    ctx.logs.push(`${persona.name} 承担重点内容的首条回应（heavy-anchor）`);
    return { kind: 'reply', text: firstHeavyReply(persona, needsHelpSeeking(card.text)), origin: 'curated' };
  }

  if (isMock(ctx.config)) {
    const isShort = incoming && ['greeting', 'noise', 'laugh'].includes(inferSocialIntent(incoming));
    const text = persona.intimacy < 22 && card.comments.length === 0 && !isShort
      ? (TENTATIVE[persona.id]?.(TOPIC_WORD[topicGroup(inferTrouble(card.text))]) ?? mockComment(persona, card, phase, sourceCommentId))
      : mockComment(persona, card, phase, sourceCommentId);
    return { kind: 'reply', text, origin: 'demo' };
  }

  try {
    const text = await callOnce(
      ctx,
      systemFor(
        persona,
        '',
        `${COMMENT_RULES}${
          persona.intimacy < 22 && card.comments.length === 0
            ? ' 你和这个人还不熟：句子短一点，别急着给建议，可以说「我也说不好」。'
            : ''
        }${
          persona.shareBoost
            ? ' 你刚听对方说了一件挺重的事。可以回应，但不要比较、不要说教。'
            : ''
        }${
          (isHeavyShare(card.text) || needsHelpSeeking(card.text))
            ? ' 这是用户的脆弱自述：先接住具体感受，不能拿食堂、打球或自己的经历打岔；不要诊断。'
            : ''
        }`,
        ctx.settings.baselineExtra,
      ),
      withUntrustedHistory(commentPrompt(card, persona, sourceCommentId), persona, Date.now()),
      1200,
    );
    const line = cleanLine(text);
    if (!line) throw new Error('模型返回空文本');
    const shortContact = Boolean(
      (player && latestPlayerIsShortContact(card, sourceCommentId)) ||
      (!card.comments.length && card.authorKind === 'player' &&
        ['greeting', 'noise', 'laugh'].includes(inferSocialIntent(card.text)))
    );
    if (shortContact && mentionsLocalVenue(line)) {
      ctx.logs.push(`${persona.name} 的短接触回复提到共享场所，改为明确标注的预置短回复`);
      return {
        kind: 'reply',
        text: mockSocialReply(persona, inferSocialIntent(incoming)) ?? curatedSafeLine(persona),
        origin: 'curated',
      };
    }
    const venueLeak = Boolean(
      incoming &&
        mentionsLocalVenue(incoming) &&
        /(?:去过|刚去|前两天|昨天|上次|上回|尝过|吃过|见过|路过|碰见|我们学校|我们食堂|咱学校)/.test(line),
    );
    if (venueLeak) {
      ctx.logs.push(`${persona.name} 顺着对方的学校场所编造经历，改为不同校回复`);
      return { kind: 'reply', text: venueSafeLine(persona), origin: 'boundary' };
    }
    const social = auditSocial(line);
    const problem = replyProblem(line);
    if (problem) {
      ctx.logs.push(`${persona.name} 的模型回复被安全层拦截：${problem}`);
      return {
        kind: 'reply',
        text: social ? socialSafeReply(persona, social) : curatedSafeLine(persona),
        origin: social ? 'boundary' : 'curated',
      };
    }
    return { kind: 'reply', text: line, origin: 'model' };
  } catch (err) {
    const reason = describeError(err);
    ctx.logs.push(`${persona.name} 本轮模型不可用：${reason}`);
    return { kind: 'unavailable', reason };
  }
}

function dailyQuota(settings: WorldSettings) {
  // aiCardLimit 为自动发帖的滚动 24 小时上限；0 必须彻底关闭自动发帖。
  return Number.isFinite(settings.aiCardLimit)
    ? Math.max(0, Math.min(8, Math.floor(settings.aiCardLimit))) : 0;
}

async function generateAiCard(
  ctx: Ctx,
  persona: Persona,
  recent: string[],
  now: number,
  weight: 1 | 2 | 3,
): Promise<{ text: string; fact: string; origin: 'model' | 'demo' } | null> {
  if (isMock(ctx.config)) return { text: mockCardText(persona, weight), fact: '', origin: 'demo' };
  try {
    const text = await callOnce(
      ctx,
      systemFor(persona, '', CARD_RULES, ctx.settings.baselineExtra),
      withUntrustedHistory(cardPrompt(recent, new Date(now), weight, persona.intimacy), persona, now),
      1200,
    );
    const [body, fact] = text.split('|||');
    const card = cleanLine(body ?? text, 120);
    if (!card || replyProblem(card)) {
      ctx.logs.push(`${persona.name} 的卡被拦下了`);
      return null;
    }
    const cleanFact = fact && !/^无/.test(fact.trim()) && !replyProblem(fact)
      ? sanitizeMemoryText(cleanLine(fact, 60)) : '';
    return { text: card, fact: cleanFact, origin: 'model' };
  } catch (err) {
    ctx.logs.push(`${persona.name} 发帖模型不可用：${describeError(err)}`);
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
      arrivals: [...new Set(original.arrivals)],
      plan: [...original.plan],
      pending: [...original.pending],
    };

    // 导入的旧主帖/玩家评论都必须在整个任务队列执行前检查，不能仅检查当前 sourceCommentId。
    if (hasPlayerCrisisInput(card)) {
      card.plan = [];
      card.pending = [];
      card.helperAt = undefined;
      card.status = 'handled';
      card.handledAt ??= now;
      card.noMemory = true;
      appendCrisisNotice(card, now);
      ctx.logs.push('帖子包含危机内容，已停止所有普通 AI 任务并提供系统提示');
      cards.push(card);
      continue;
    }

    // 处理持久化的关闭状态/到期状态。done 仅允许已安排的祝贺反应，不执行普通回复。
    if (card.status === 'noted' && card.note && now > card.note.dueAt) {
      card = { ...card, status: 'handled', handledAt: now, note: undefined };
    }
    if ((card.status === 'talking' || card.status === 'advised') && now - card.createdAt > DAY) {
      card = { ...card, status: 'handled', handledAt: now };
    }
    if (card.status === 'handled') {
      card.plan = [];
      card.pending = [];
      card.helperAt = undefined;
      cards.push(card);
      continue;
    }
    if (card.status === 'done') {
      card.plan = [];
      card.pending = card.pending.filter((item) => item.phase === 'reaction');
      card.helperAt = undefined;
    }

    // 旧存档可能包含重复到场计划或已经删除的评论引用。先去重并剔除失效任务，
    // 保留不同 sourceCommentId 对应的独立对话，不让过期任务误回复其他玩家。
    const seenArrivals = new Set(card.arrivals);
    card.plan = [...card.plan].sort((a, b) => a.at - b.at).filter((item) => {
      if (seenArrivals.has(item.personaId)) return false;
      seenArrivals.add(item.personaId);
      return true;
    });
    const seenPending = new Set<string>();
    card.pending = [...card.pending].sort((a, b) => a.at - b.at).filter((item) => {
      if (item.sourceCommentId && item.phase !== 'reaction') {
        const source = card.comments.find((c) => c.id === item.sourceCommentId);
        if (source?.authorKind !== 'player' || (item.phase === 'decide' && source.kind !== 'advice')) {
          ctx.logs.push(`已丢弃失效的 ${item.phase} 任务：找不到原始玩家评论`);
          return false;
        }
      }
      const key = `${item.phase}|${item.personaId}|${item.sourceCommentId ?? ''}`;
      if (seenPending.has(key)) return false;
      seenPending.add(key);
      return true;
    });

    if (
      !peerScheduled &&
      card.authorKind === 'persona' &&
      card.status !== 'done' &&
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

    for (const item of card.plan.filter((p) => p.at <= now)) {
      if (ctx.calls >= limit) break;
      const persona = personas.find((p) => p.id === item.personaId);
      card.plan = card.plan.filter((p) => p !== item);
      if (!persona) continue;
      const generated = await generateComment(ctx, persona, card, 'arrival');
      if (generated.kind === 'crisis') {
        appendCrisisNotice(card, now);
        continue; // 危机不算角色到场，不重试，不写记忆。
      }
      if (generated.kind === 'unavailable') {
        const retry = retryLater(item, now);
        if (retry) card.plan.push(retry);
        card.comments.push({
          id: uid(), authorId: 'helper', authorKind: 'helper',
          text: errorNotice(persona.name, Boolean(retry)), at: now, origin: 'system',
        });
        continue; // 失败不能算同伴到场，也不能写心智、记忆。
      }
      const text = generated.text;
      card.comments.push({
        id: uid(), authorId: persona.id, authorKind: 'persona',
        text, at: now, origin: generated.origin,
      });
      const firstArrival = !card.arrivals.includes(persona.id);
      card.arrivals.push(persona.id);
      if (firstArrival && card.authorId === 'me' && !card.noMemory) {
        personas = notePlayerShare(personas, card.text, [persona.id]);
      }
      if (card.status === 'stuck') card.status = 'arrived';
      else if (card.status === 'arrived') card.status = 'talking';
      if (!card.noMemory) personas = setMind(personas, persona.id, mindAfterReply(persona, card.authorName, now));
      if (card.authorId === 'me') {
        personas = rememberOnCard(personas, card, persona.id, '你', card.text, now);
      } else if (card.authorKind === 'persona' && card.authorId !== persona.id) {
        const author = personas.find((p) => p.id === card.authorId);
        if (author) {
          if (!card.noMemory) personas = setMind(personas, author.id, mindAfterPeer(author, persona.name, text, now));
          personas = rememberOnCard(personas, card, author.id, persona.name, text, now);
        }
        personas = rememberOnCard(personas, card, persona.id, card.authorName, card.text, now);
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
            id: uid(), authorId: persona.id, authorKind: 'persona',
            text: said, at: now, origin: 'simulated',
          });
        } else if (ready.phase === 'decide') {
          const adviceComment = ready.sourceCommentId
            ? card.comments.find((c) => c.id === ready.sourceCommentId && c.authorKind === 'player' && c.kind === 'advice')
            : [...card.comments].reverse().find((c) => c.authorKind === 'player' && c.kind === 'advice');
          adviceText = adviceComment?.text ?? '';
          let accept = false;
          let reply = '这个办法我暂时做不到，先不按它做。';
          let origin: 'model' | 'demo' | 'boundary' | 'curated' = 'curated';
          let unavailable = false;
          const adviceBoundary = boundaryRequest(adviceText);
          const adviceSocial = auditSocial(adviceText);
          const unsafeAdvice = Boolean(
            !adviceText || findCrisis(adviceText) || adviceBoundary ||
            adviceSocial || auditCriticalContent(adviceText),
          );
          if (unsafeAdvice) {
            reply = adviceBoundary || adviceSocial
              ? socialSafeReply(persona, adviceSocial ?? '', adviceBoundary)
              : '这个主意不安全，我不能照着做。';
            origin = 'boundary';
            ctx.logs.push(`${persona.name} 拒绝不安全的建议`);
          } else if (isMock(ctx.config)) {
            accept = Math.random() < 0.7;
            reply = accept ? pick(ACCEPT_LINES) : pick(REFUSE_LINES);
            origin = 'demo';
          } else {
            try {
              const raw = await callOnce(
                ctx,
                systemFor(
                  persona,
                  '',
                  ADVICE_DECIDE_RULES,
                  input.settings.baselineExtra,
                ),
                withUntrustedHistory(decidePrompt(card, adviceText), persona, now),
                600,
              );
              const [head, ...rest] = raw.split('|');
              const generated = cleanLine(rest.join('|'), 60);
              const decision = head.trim();
              if ((decision === '接受' || decision === '拒绝') && generated) {
                if (replyProblem(generated)) {
                  const social = auditSocial(generated);
                  reply = social
                    ? socialSafeReply(persona, social) : '这句话不合适，我先不按这个主意做。';
                  origin = social ? 'boundary' : 'curated';
                } else {
                  accept = decision === '接受';
                  reply = generated;
                  origin = 'model';
                }
              } else {
                ctx.logs.push(`${persona.name} 的建议决定格式不合法，使用标注的安全拒绝`);
              }
            } catch (err) {
              ctx.logs.push(`${persona.name} 的建议决定失败：${describeError(err)}`);
              unavailable = true;
            }
          }
          if (unavailable) {
            const retry = retryLater(ready, now);
            if (retry) card.pending.push(retry);
            card.comments.push({
              id: uid(), authorId: 'helper', authorKind: 'helper',
              text: errorNotice(persona.name, Boolean(retry)), at: now, origin: 'system',
            });
          } else {
            said = reply;
            accepted = accept;
            card.comments.push({
              id: uid(), authorId: persona.id, authorKind: 'persona',
              text: said, at: now, origin,
              replyTo: adviceComment?.id,
            });
            if (accept) {
              card.advice = {
                text: adviceText, fromPersonaId: 'me', at: now, accepted: true,
                origin: isMock(ctx.config) ? 'demo' : 'curated',
              };
              card.status = 'advised';
            } else {
              const refused = (card.refused ?? 0) + 1;
              card = { ...card, refused };
              if (refused >= 2) card = { ...card, status: 'handled', handledAt: now };
            }
          }
        } else {
          const generated = await generateComment(ctx, persona, card, 'reply', ready.sourceCommentId);
          if (generated.kind === 'crisis') {
            appendCrisisNotice(card, now);
          } else if (generated.kind === 'unavailable') {
            const retry = retryLater(ready, now);
            if (retry) card.pending.push(retry);
            card.comments.push({
              id: uid(), authorId: 'helper', authorKind: 'helper',
              text: errorNotice(persona.name, Boolean(retry)), at: now, origin: 'system',
            });
          } else {
            said = generated.text;
            card.comments.push({
              id: uid(), authorId: persona.id, authorKind: 'persona',
              text: said, at: now, origin: generated.origin,
              replyTo: ready.sourceCommentId,
            });
          }
        }

        if (said) {
          if (!card.noMemory) personas = setMind(personas, persona.id, mindAfterReply(persona, card.authorName, now));
          if (card.authorId === 'me') {
            personas = rememberOnCard(personas, card, persona.id, '你', card.text, now);
          } else if (card.authorKind === 'persona' && card.authorId !== persona.id) {
            const author = personas.find((p) => p.id === card.authorId);
            if (author) {
              if (!card.noMemory) personas = setMind(personas, author.id, mindAfterPeer(author, persona.name, said, now));
              personas = rememberOnCard(personas, card, author.id, persona.name, said, now);
            }
            personas = rememberOnCard(personas, card, persona.id, card.authorName, card.text, now);
          }
        }

        if (accepted !== undefined && !card.noMemory) {
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
            personas = rememberOnCard(personas, card, persona.id, '你', adviceText, now);
          }
        }
      }
    }

    if (
      card.authorKind === 'persona' &&
      card.advice?.accepted &&
      card.status !== 'done' && card.status !== 'handled' &&
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
            origin: 'simulated',
          },
        ],
      };
      if (!card.noMemory) personas = personas.map((p) =>
        p.id === card.authorId
          ? {
              ...p,
              mind: mindAfterStep(p, now),
              weekLog: [
                ...p.weekLog,
                { at: now, text: sanitizeMemoryText(`照着别人给的小步「${label}」做了一次`) },
              ].slice(-8),
            }
          : p,
      );
      personas = rememberOnCard(personas, card, card.authorId, '你', `照着「${label}」做了一次`, now);
      ctx.logs.push(`${card.authorName} 做到了「${label}」`);
    }

    cards.push(card);
  }

  const introActive = introPhaseActive(cards, now);
  const todayCards = cards.filter(
    (c) => c.authorKind === 'persona' && !c.intro && c.createdAt <= now && now - c.createdAt < DAY,
  );
  const quota = dailyQuota(input.settings);
  if (!introActive && todayCards.length < quota && ctx.calls < limit && personas.length) {
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
        origin: made.origin,
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
  input: TickInput & { cardId: string; personaId?: string },
): Promise<{ cards: Card[]; personas: Persona[]; calls: number; logs: string[] }> {
  const now = input.now ?? Date.now();
  const card = input.cards.find((c) => c.id === input.cardId);
  if (!card) return { cards: input.cards, personas: input.personas, calls: 0, logs: [] };
  if (hasPlayerCrisisInput(card)) {
    return { cards: input.cards, personas: input.personas, calls: 0, logs: ['检测到危机内容，不生成普通行动建议；请走危机求助层'] };
  }
  if (isClosed(card) || card.advice || card.status === 'noted') {
    return { cards: input.cards, personas: input.personas, calls: 0, logs: ['当前卡片不可再次生成下一步'] };
  }
  const persona = advicePersonaFor(card, input.personas, input.personaId);
  if (!persona) {
    return {
      cards: input.cards, personas: input.personas, calls: 0,
      logs: [input.personaId ? '所选角色尚未参与这张卡，未更换成其他角色' : '当前还没有可提供下一步的角色'],
    };
  }

  // 危机不是普通的微行动；完整提交入口必须由 App 展示危机求助层。
  const context = [card.text, ...card.comments.filter((c) => c.authorKind === 'player').map((c) => c.text)].join(' ');
  // 优先匹配非诊断性求助起点，避免“应就医”与正式动作“开窗”自相矛盾。
  const seekingHelp = card.authorKind === 'player' && needsHelpSeeking(context);
  const trouble = inferTrouble(card.text);
  const options = seekingHelp
    ? [...HELP_SEEKING_ACTIONS.slice(0, 1)]
    : pickActions(new Date(now).getHours(), 3, trouble, card.text);
  if (!options.length) return { cards: input.cards, personas: input.personas, calls: 0, logs: ['该主题暂无可用动作'] };
  let action = options[0];
  let calls = 0;
  const logs: string[] = [];

  if (!seekingHelp && !isMock(input.config)) {
    try {
      calls++;
      const raw = await streamChat({
        config: input.config,
        messages: [
          {
            role: 'system',
            content: systemFor(
              persona,
              '',
              '只能在三个预置动作中选一个，只输出它的编号，不写新的建议，不提供现实见面或联系方式。',
              input.settings.baselineExtra,
            ),
          },
          {
            role: 'user',
            content: withUntrustedHistory(`卡片：${card.text}\n\n${options
              .map((o) => `${o.id} | ${o.label}（${o.minutes} 分钟）`)
              .join('\n')}\n\n只输出所选编号。`, persona, now),
          },
        ],
        signal: AbortSignal.timeout(20_000),
        onDelta: () => {},
        maxTokens: 200,
        lowEffort: true,
      });
      const chosen = options.find((row) => row.id === raw.trim());
      if (chosen) action = chosen;
      else logs.push('模型没有返回有效的预置动作编号，使用本地候选');
    } catch (err) {
      // 仍可交付预置动作，但必须在 UI 明确标注“预置动作”，不能冒充模型建议。
      logs.push(`模型挑选下一步失败，使用本地动作：${describeError(err)}`);
    }
  }
  const text = action.line;

  const next: Card = {
    ...card,
    advice: { text, actionId: action.id, fromPersonaId: persona.id, at: now, accepted: false, origin: seekingHelp ? 'curated' : isMock(input.config) ? 'demo' : 'curated' },
    status: 'advised',
    comments: [
      ...card.comments,
      { id: uid(), authorId: persona.id, authorKind: 'persona' as const, text, at: now, origin: seekingHelp ? 'curated' as const : isMock(input.config) ? 'demo' as const : 'curated' as const },
    ],
  };
  let personas = card.noMemory ? input.personas : input.personas.map((p) =>
    p.id === persona.id ? { ...p, mind: mindAfterReply(p, card.authorName, now) } : p,
  );
  personas = rememberOnCard(personas, card, persona.id, '你', card.text, now);
  return {
    cards: input.cards.map((c) => (c.id === card.id ? next : c)),
    personas,
    calls,
    logs: [...logs, `${persona.name} 给了一个${seekingHelp ? '求助起点' : '预置下一步'}：${action.label}`],
  };
}

export async function catchUp(
  input: TickInput & { hours: number },
): Promise<{ cards: Card[]; personas: Persona[]; calls: number }> {
  if (input.settings.paused) return { cards: input.cards, personas: input.personas, calls: 0 };
  const quota = dailyQuota(input.settings);
  if (quota === 0) return { cards: input.cards, personas: input.personas, calls: 0 };
  const count = Math.min(4, Math.max(1, Math.round(input.hours / 3)));
  const ctx: Ctx = { config: input.config, settings: input.settings, calls: 0, logs: [] };
  const now = input.now ?? Date.now();
  let personas: Persona[] = input.personas.map((p) => ({
    ...p,
    memory: [...p.memory],
    weekLog: [...p.weekLog],
    mind: ensureMind(p, now),
  }));
  const cards = [...input.cards];

  for (let i = 0; i < count; i++) {
    if (cards.filter((c) => c.authorKind === 'persona' && c.createdAt <= now && now - c.createdAt < DAY).length >= quota) break;
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
      origin: made.origin,
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
    origin: 'simulated',
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
