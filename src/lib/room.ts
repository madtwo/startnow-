import type {
  Archetype,
  Identity,
  LlmConfig,
  Message,
  NextStep,
  Persona,
  Room,
  RoomSettings,
  ScheduledMessage,
} from '../types';
import { isMock } from '../config/providers';
import { auditTone, BASELINE } from './baseline';
import { findCrisis, isHeavyShare } from './safety';
import { ensureMind, mindAfterPeer, mindAfterReply, mindAfterStep } from './mind';
import { recordReplyMemory } from './memory';
import { buildPersonaPrompt, pickCast } from './personas';
import { refreshSituations } from './castGen';
import { emotionalSignal, type Tone } from './tone';
import { streamChat } from './llm';
import { actionLabel, actionMinutes, inferTrouble, pickActions, smallerAction } from './actions';
import {
  cleanLine,
  PUBLIC_RULES,
  ROOM_RULES,
  roomPrompt,
  withUntrustedHistory,
  type RoomLine,
} from './prompts';

const MIN = 60_000;
const uid = () => crypto.randomUUID();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const dayKey = (ts: number) => new Date(ts).toDateString();

const TITLES = ['晚自习后', '走廊尽头', '六楼茶水间', '宿舍楼下', '图书馆三楼'];

/* ------------------------------------------------------------------ *
 * 关系：群里的人一开始互不相识，也从零开始认识你
 * ------------------------------------------------------------------ */

export const relationLabel = (value: number): string => {
  if (value < 10) return '刚认识';
  if (value < 25) return '聊过几次';
  if (value < 50) return '算熟了';
  return '很熟';
};

const relOf = (persona: Persona, id: string): number => persona.relations?.[id] ?? 0;

const syncIntimacy = (persona: Persona, relations: Record<string, number>): number =>
  relations.me === undefined ? persona.intimacy : Math.round(relations.me);

const bump = (persona: Persona, id: string, delta: number, now: number): Persona => {
  const relations = { ...(persona.relations ?? {}) };
  relations[id] = Math.max(0, Math.min(100, (relations[id] ?? 0) + delta));
  return {
    ...persona,
    relations,
    relationsAt: now,
    intimacy: syncIntimacy(persona, relations),
  };
};

/** 三天没聊就开始淡。熟悉度是会被忘掉的，这符合产品设定的「会忘事」。 */
const decayRelations = (persona: Persona, now: number): Persona => {
  const last = persona.relationsAt ?? now;
  const idleDays = Math.floor((now - last) / 86_400_000);
  if (idleDays < 3 || !persona.relations) return persona;
  const drop = Math.min(6, idleDays - 2);
  const relations: Record<string, number> = {};
  for (const [key, value] of Object.entries(persona.relations)) {
    relations[key] = Math.max(0, value - drop);
  }
  return { ...persona, relations, relationsAt: now, intimacy: syncIntimacy(persona, relations) };
};

const prepareCast = (cast: Persona[], now: number): Persona[] =>
  refreshSituations(cast, now).map((p) => decayRelations(p, now));

/** 别人说话，你听在耳朵里，也算一点点认识。 */
const heardAbout = (room: Room, speakerId: string, now: number, delta = 0.15): Room => ({
  ...room,
  cast: room.cast.map((p) => (p.id === speakerId ? p : bump(p, speakerId, delta, now))),
});

/* ------------------------------------------------------------------ *
 * 热闹度：一个旋钮，派生所有节奏
 * ------------------------------------------------------------------ */

export interface LivelinessProfile {
  /** 主动开口的间隔（毫秒） */
  ambientGap: [number, number];
  /** AI 之间互相接话的概率 */
  peerChance: number;
  /** 玩家说一句，第 2 / 第 3 个人跟着回的概率 */
  extraReply: [number, number];
  /** AI 之间最多追几轮 */
  chainMax: number;
  /** 同一个人两次发言之间至少隔多久 */
  cooldown: number;
  /** 玩家完成一步后，平均几个人应声 */
  reactCount: number;
}

export const livelinessProfile = (liveliness: number): LivelinessProfile => {
  const L = clamp01(liveliness);
  const base = 14_000 + 146_000 * (1 - L);
  return {
    ambientGap: [base * 0.7, base * 1.9],
    peerChance: 0.1 + 0.5 * L,
    extraReply: [0.45 * L, 0.22 * L],
    chainMax: Math.round(1 + 2 * L),
    cooldown: 8_000 + 20_000 * (1 - L),
    reactCount: 0.3 + 1.1 * L,
  };
};

export const livelinessLabel = (liveliness: number): string => {
  const L = clamp01(liveliness);
  if (L < 0.25) return '安静';
  if (L < 0.5) return '一般';
  if (L < 0.78) return '热闹';
  return '很吵';
};

/** 粗估：这个热闹度大概多吵、大概多贵。 */
export const livelinessEstimate = (liveliness: number): { perMin: number; note: string } => {
  const p = livelinessProfile(liveliness);
  const ambient = 60_000 / ((p.ambientGap[0] + p.ambientGap[1]) / 2);
  const replies = 1 + p.extraReply[0] + p.extraReply[1] + 2 * p.peerChance;
  const perMin = ambient + replies * 1.5;
  return { perMin: Math.round(perMin * 10) / 10, note: `${p.chainMax} 轮追话` };
};

/* ------------------------------------------------------------------ *
 * 基础
 * ------------------------------------------------------------------ */

export const cloneRoom = (room: Room): Room => ({
  ...room,
  messages: room.messages.map((m) => ({ ...m })),
  scheduled: room.scheduled.map((s) => ({ ...s })),
  steps: room.steps.map((s) => ({ ...s })),
  cast: room.cast.map((p) => ({ ...p, memory: [...p.memory], weekLog: [...p.weekLog] })),
  gone: room.gone.map((p) => ({ ...p })),
  usage: { ...room.usage },
});

export const systemMessage = (text: string, at = Date.now()): Message => ({
  id: uid(),
  authorId: 'system',
  authorKind: 'system',
  authorName: '系统',
  text,
  at,
  kind: 'system',
});

const personaMessage = (
  persona: Persona,
  text: string,
  at: number,
  replyTo?: string,
  mentions?: string[],
): Message => ({
  id: uid(),
  authorId: persona.id,
  authorKind: 'persona',
  authorName: persona.name,
  color: persona.color,
  avatarKey: persona.avatarKey,
  text,
  at,
  kind: 'chat',
  replyTo,
  mentions,
});

export const ensureUsage = (room: Room, now = Date.now()): Room => {
  const day = dayKey(now);
  if (room.usage.day === day) return room;
  return { ...room, usage: { day, messages: 0 } };
};

export const usedToday = (room: Room, now = Date.now()): number =>
  room.usage.day === dayKey(now) ? room.usage.messages : 0;

export const budgetLeft = (room: Room, settings: RoomSettings, now = Date.now()): number =>
  Math.max(0, settings.dailyMessages - usedToday(room, now));

const spend = (room: Room, now: number): Room => ({
  ...room,
  usage: { day: dayKey(now), messages: usedToday(room, now) + 1 },
});

export const newRoom = (cast: Persona[], now = Date.now()): Room => {
  const people = (cast.length ? cast : pickCast(4)).map((p) => ({
    ...p,
    mind: ensureMind(p, now),
  }));
  const first = pick(people);
  const second = pick(people.filter((p) => p.id !== first.id));
  const room: Room = {
    id: uid(),
    title: pick(TITLES),
    createdAt: now,
    messages: [
      systemMessage('几个大学生凑的群。卡住了就说一句，不用讲清前因后果。', now),
      systemMessage('想要一个能现在动手的小步，去右下角「下一步」。', now + 1),
    ],
    scheduled: [],
    steps: [],
    cast: people,
    gone: [],
    lastSeenAt: now,
    lastMessageAt: now,
    usage: { day: dayKey(now), messages: 0 },
  };
  const start = now + rand(2_500, 6_000);
  room.scheduled.push({ id: uid(), personaId: first.id, at: start, intent: 'ambient', depth: 0 });
  if (second) {
    room.scheduled.push({
      id: uid(),
      personaId: second.id,
      at: start + rand(7_000, 16_000),
      intent: 'ambient',
      depth: 0,
    });
  }
  return room;
};

/* ------------------------------------------------------------------ *
 * 本地台词（演示模式 / 模型失败时的兜底）
 * ------------------------------------------------------------------ */

const LINES: Record<
  Archetype,
  Record<'reply' | 'peer' | 'ambient' | 'react' | 'step' | 'comfort', string[]>
> = {
  quiet: {
    reply: ['嗯，我在听。', '这个我也说不好。', '先别急，能不能只说一件？', '嗯。那你现在最想做的是哪个。'],
    peer: ['我倒没这么觉得。', '嗯，你说的这句我也想过。', '先别急着下结论吧。'],
    ambient: ['书翻到第三页又翻回去了。', '刚去接杯水，回来接着弄。', '今晚这章是看不完了。', '算了，先坐一会儿。'],
    react: ['真做了啊。', '行，那这一步算数。', '嗯。今晚别再逼自己了。'],
    step: ['你说的那一步我做了。', '照你说的做了，没想的那么难。'],
    comfort: ['嗯，在的。', '我看到你说的了。', '不用急着说清楚。', '先坐一会儿吧。'],
  },
  shy: {
    reply: ['我也说不好……但我懂你的意思。', '嗯，你继续说。', '是不是我回得太慢了。'],
    peer: ['我也说不好……不过我理解你的意思。', '你们两个说的我都听进去了。', '我刚想说这个。'],
    ambient: ['群里消息响了两下，我看了，没想好接什么。', '明天要上台，开头那句还没念顺。', '我是不是说得太多了。', '今天食堂好吵。'],
    react: ['嗯……你做了。那就先这样。', '挺好的，别再要求更多了。', '我也有点想试试。'],
    step: ['我按你说的做了，好像可以。', '嗯……我试了，没有想的那么可怕。'],
    comfort: ['嗯……我在听。', '我懂的，别急着说清楚。', '你先说说，我不急。'],
  },
  rational: {
    reply: ['是哪一科？能缩到一章就没那么吓人。', '你先说清是哪一件，别一次铺开。', '这个可以拆一下。'],
    peer: ['我倒觉得可以先拆开看。', '你这个说法有点绝对。', '那得看具体卡在哪一步。'],
    ambient: ['表格开了三页，还是没决定先弄哪个。', '又把要求看了一遍，条件比我想的多。', '先投一份吧，不然这个表能陪我过完学期。', '晚上先做最小那个。'],
    react: ['可以，动作虽小但算数。', '行，那今晚就先到这儿。', '记一下，这一步是真的做了。'],
    step: ['你说的那步我做了，确实比整块想容易。', '按你说的试了一下，能做。'],
    comfort: ['先别急着解决，说说现在是什么情况。', '听起来这两天挺难受的。', '嗯，我在。'],
  },
  warm: {
    reply: ['哎，你来了。谁惹你了？', '别闷着，你说，我听着呢。', '那先别想那么多，吃点东西没。'],
    peer: ['哎你别吓她。', '哈哈，也没那么严重吧。', '我站她这边。', '我问一句啊，你俩说的是同一件事吗。'],
    ambient: ['刚吃完饭，脑子有点木。', '我这边也在算钱，算得头大。', '谁去食堂，帮我带一份。', '明天那节课我还没看。'],
    react: ['行啊你！这一步就算数了。', '漂亮，做一点是一点。', '可以啊，比躺着一整天强。'],
    step: ['你说的那招我用了，还真行。', '按你说的做了，没那么难嘛。'],
    comfort: ['哎，抱一下。', '别自己扛着，说出来。', '我在呢，你说。', '先别管别的，吃了吗。'],
  },
};

type MockMode = 'reply' | 'peer' | 'ambient' | 'react' | 'step' | 'comfort';

const mockLine = (persona: Persona, mode: MockMode): string =>
  pick(LINES[persona.archetype ?? 'quiet'][mode]);

/* ------------------------------------------------------------------ *
 * 生成
 * ------------------------------------------------------------------ */

interface Ctx {
  config: LlmConfig;
  calls: number;
  logs: string[];
}

const recentLines = (room: Room, n = 8): RoomLine[] =>
  room.messages
    .filter((m) => m.kind === 'chat')
    .slice(-n)
    .map((m) => ({ name: m.authorName, text: m.text }));

/** 你自己此刻的生活。不主动全倒出来，但影响你怎么接话。 */
const situationBlock = (persona: Persona): string => {
  const s = persona.situation;
  if (!s) return '';
  return `【你此刻的处境】（这是你自己的生活，不主动全倒出来）
${persona.school}${persona.major}${persona.cohort}，${persona.age} 岁。
现在：${s.agenda}
最近卡在：${s.worry}
你确实懂的：${s.knows.join('、')}（不懂的就说不懂，不要硬答）
今天的节奏：${s.busyLabel}`;
};

/** 你和群里每个人的熟悉度。刚开始都是 0，别装熟。 */
const relationBlock = (persona: Persona, cast: Persona[]): string => {
  const rows = cast
    .filter((p) => p.id !== persona.id)
    .map((p) => `${p.name}：${relationLabel(relOf(persona, p.id))}`);
  return `【你和这群人熟到什么程度】（数字小的时候别装熟：不叫昵称、不说「你上次」、不假装懂对方）
群里那个新来的人：${relationLabel(relOf(persona, 'me'))}
${rows.join('\n')}`;
};

const systemForRoom = (persona: Persona, cast: Persona[]): string =>
  [
    BASELINE,
    PUBLIC_RULES,
    ROOM_RULES,
    buildPersonaPrompt(persona),
    situationBlock(persona),
    relationBlock(persona, cast),
  ]
    .filter(Boolean)
    .join('\n\n');

const findMessage = (room: Room, id?: string): Message | undefined =>
  id ? room.messages.find((m) => m.id === id) : undefined;

type Mode = 'reply' | 'peer' | 'ambient' | 'react' | 'comfort' | 'advise';

interface LineExtra {
  /** advise 模式：这条建议绑定的动作 */
  adviceLabel?: string;
  adviceMinutes?: number;
  /** 同一轮里第几个给建议，用来换句式 */
  adviceVariant?: number;
  /** 这一轮别人已经说过的，避免重复 */
  alreadySaid?: string[];
}

/** 这一轮（从玩家那句开始）别人已经说了什么。 */
const saidSince = (room: Room, replyTo?: string): string[] => {
  const anchor = findMessage(room, replyTo);
  if (!anchor) return [];
  return room.messages
    .filter((m) => m.kind === 'chat' && m.at >= anchor.at && m.authorId !== anchor.authorId)
    .slice(-4)
    .map((m) => `${m.authorName}：${m.text}`);
};

/** 模型不可用时的兜底：建议一定要落在被分配的那个动作上。 */
const fallbackLine = (persona: Persona, mode: Mode, extra: LineExtra): string => {
  if (mode === 'advise') {
    const templates = extra.adviceLabel
      ? [
          `我卡住的时候会先${extra.adviceLabel}，别的先不管。`,
          `要不先${extra.adviceLabel}？就这一件。`,
          `我一般会先${extra.adviceLabel}，做完再说。`,
        ]
      : ['我卡住的时候会先做一件五分钟的小事，别的先不管。'];
    return templates[(extra.adviceVariant ?? 0) % templates.length];
  }
  if (mode === 'comfort') return mockLine(persona, 'comfort');
  return mockLine(persona, mode);
};

const generateLine = async (
  ctx: Ctx,
  room: Room,
  persona: Persona,
  mode: Mode,
  replyTo: string | undefined,
  now: number,
  extra: LineExtra = {},
): Promise<string> => {
  if (isMock(ctx.config)) return fallbackLine(persona, mode, extra);
  ctx.calls += 1;
  const replyMessage = findMessage(room, replyTo);
  const replyName = replyMessage?.authorName;
  const topic = room.messages.filter((m) => m.kind === 'chat').slice(-1)[0]?.text;
  try {
    const text = await streamChat({
      config: ctx.config,
      messages: [
        { role: 'system', content: systemForRoom(persona, room.cast) },
        {
          role: 'user',
          content: withUntrustedHistory(
            roomPrompt(room.cast, recentLines(room), {
              mode,
              replyName,
              topic,
              // 玩家这条是在关心你时，先回应你自己，不要顺势给建议
              selfName: persona.name,
              replyText: replyMessage?.text,
              replyIsPlayer: replyMessage?.authorKind === 'player',
              advice:
                mode === 'advise' && extra.adviceLabel
                  ? { label: extra.adviceLabel, minutes: extra.adviceMinutes ?? 5 }
                  : undefined,
              alreadySaid: extra.alreadySaid,
            }),
            persona,
            now,
          ),
        },
      ],
      signal: new AbortController().signal,
      sessionId: `ses_r_${Math.random().toString(36).slice(2, 10)}`,
      onDelta: () => {},
      maxTokens: 90,
      lowEffort: true,
    });
    const line = cleanLine(text, 90);
    if (line && !findCrisis(line) && !auditTone(line)) return line;
    ctx.logs.push(`${persona.name} 那句被拦下了，换了一句`);
  } catch {
    ctx.logs.push(`${persona.name} 这次没说出来`);
  }
  return fallbackLine(persona, mode, extra);
};

const updateMind = (room: Room, personaId: string, patch: (p: Persona) => Persona): Room => ({
  ...room,
  cast: room.cast.map((p) => (p.id === personaId ? patch(p) : p)),
});

const schedulePeer = (
  room: Room,
  after: Message,
  persona: Persona,
  depth: number,
  now: number,
  profile: LivelinessProfile,
): ScheduledMessage | null => {
  if (depth >= profile.chainMax) return null;
  if (Math.random() >= profile.peerChance) return null;
  const others = room.cast.filter((p) => p.id !== persona.id);
  const queued = new Set(room.scheduled.map((s) => s.personaId));
  const candidates = others.filter((p) => !queued.has(p.id));
  if (!candidates.length) return null;
  const next = pick(candidates);
  return {
    id: uid(),
    personaId: next.id,
    at: now + rand(3_000, 9_000),
    intent: 'peer',
    replyTo: after.id,
    depth: depth + 1,
  };
};

const pushMessage = (room: Room, message: Message, now: number): Room => ({
  ...room,
  // 留个上限：localStorage 只有 5MB，消息无限长会静默写失败
  messages: [...room.messages, message].slice(-400),
  lastMessageAt: now,
});

/* ------------------------------------------------------------------ *
 * 一次 tick
 * ------------------------------------------------------------------ */

export interface TickInput {
  room: Room;
  settings: RoomSettings;
  config: LlmConfig;
  now?: number;
}

export interface TickOutput {
  room: Room;
  calls: number;
  logs: string[];
}

const inQuietHours = (now: number): boolean => {
  const hour = new Date(now).getHours();
  return hour >= 2 && hour < 6;
};

/**
 * 每个原型可能醒着的时段 [开始, 结束)，可以跨零点。
 * 群里不该有人凌晨四点秒回；也不该有人早上八点就在深夜话。
 */
const ACTIVE_HOURS: Record<Archetype, [number, number]> = {
  quiet: [19, 2],
  shy: [15, 24],
  rational: [8, 24],
  warm: [10, 1],
};

const inWindow = (hour: number, [start, end]: [number, number]): boolean =>
  start <= end ? hour >= start && hour < end : hour >= start || hour < end;

/** 0 = 正醒着；2 小时内 = 半醒；更远 = 基本在睡 */
const awakeFactor = (persona: Persona, hour: number): number => {
  const window = persona.awake ?? ACTIVE_HOURS[persona.archetype ?? 'quiet'];
  if (inWindow(hour, window)) return 1;
  const distance = Math.min((hour - window[0] + 24) % 24, (window[1] - hour + 24) % 24);
  return distance <= 2 ? 0.6 : 0.2;
};

const cooldownOk = (room: Room, personaId: string, now: number, cooldown: number): boolean => {
  const last = [...room.messages].reverse().find((m) => m.authorId === personaId);
  return !last || now - last.at >= cooldown;
};

const scoreFor = (room: Room, persona: Persona, topic: string, now: number): number => {
  const key = inferTrouble(topic, 'self');
  const weight = (persona.weights[key] ?? 0) / 20;
  const last = [...room.messages].reverse().find((m) => m.authorId === persona.id);
  const idle = last ? Math.min(3, (now - last.at) / 60_000) : 3;
  const awake = awakeFactor(persona, new Date(now).getHours());
  const talkative = (persona.chattiness ?? 0.8) * 2;
  return weight + talkative + idle + awake * 1.6 + Math.random() * 1.4;
};

const pickSpeaker = (room: Room, topic: string, now: number, exclude: string[] = []): Persona | null => {
  const pool = room.cast.filter((p) => !exclude.includes(p.id));
  if (!pool.length) return null;
  // 先算完分数再比，别在比较里现掷骰子
  const scored = pool.map((p) => ({ p, score: scoreFor(room, p, topic, now) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
};

/** 让一个 AI 真的说完一句话，并处理心智、记忆、关系、追话。 */
const speak = async (
  room: Room,
  ctx: Ctx,
  persona: Persona,
  intent: 'reply' | 'peer' | 'ambient' | 'react' | 'comfort' | 'advise',
  replyTo: string | undefined,
  now: number,
  profile: LivelinessProfile,
  depth = 0,
  extra: LineExtra = {},
  allowChain = true,
): Promise<Room> => {
  const text = await generateLine(ctx, room, persona, intent, replyTo, now, extra);
  const message = personaMessage(persona, text, now, replyTo);
  let next = pushMessage(room, message, now);
  next = spend(next, now);
  const last = findMessage(next, replyTo);
  next = updateMind(next, persona.id, (p) =>
    last?.authorKind === 'persona'
      ? { ...p, mind: mindAfterPeer(p, last.authorName, last.text, now) }
      : { ...p, mind: mindAfterReply(p, last?.authorName ?? '群里的人', now) },
  );
  if (last?.authorKind === 'player') {
    // 认真回你一句，比只是在旁边看着，认得更快
    next = updateMind(next, persona.id, (p) =>
      ({
        ...bump(p, 'me', isHeavyShare(last.text) ? 2 : 1, now),
        memory: recordReplyMemory(p, last.authorName, last.text, next.id, now),
      }),
    );
  } else if (last?.authorKind === 'persona') {
    next = updateMind(next, persona.id, (p) => bump(p, last.authorId, 0.6, now));
  }
  // 别人说话你听着，也算一点点认识
  if (text.replace(/\s+/g, '').length > 6) next = heardAbout(next, persona.id, now);
  // 陪伴和建议不接龙：一段安慰之后再来两句闲扯，会把正事盖过去
  if (allowChain) {
    const peer = schedulePeer(next, message, persona, depth, now, profile);
    if (peer) next = { ...next, scheduled: [...next.scheduled, peer] };
  }
  return next;
};

const deliver = async (
  room: Room,
  ctx: Ctx,
  item: ScheduledMessage,
  now: number,
  profile: LivelinessProfile,
): Promise<Room> => {
  const persona = room.cast.find((p) => p.id === item.personaId);
  let next = { ...room, scheduled: room.scheduled.filter((s) => s.id !== item.id) };
  if (!persona) return next;

  if (item.intent === 'react') {
    const text = await generateLine(ctx, next, persona, 'react', undefined, now);
    next = pushMessage(next, personaMessage(persona, text, now), now);
    next = spend(next, now);
    return updateMind(next, persona.id, (p) => ({ ...p, mind: mindAfterReply(p, '你', now) }));
  }

  // 先陪伴、后建议：这两类不接龙，免得一段安慰变成闲聊
  if (item.intent === 'comfort' || item.intent === 'advise') {
    const label = item.adviceId ? actionLabel(item.adviceId) : undefined;
    next = await speak(
      next,
      ctx,
      persona,
      item.intent,
      item.replyTo,
      now,
      profile,
      0,
      item.intent === 'advise'
        ? {
            adviceLabel: label,
            adviceMinutes: item.adviceId ? actionMinutes(item.adviceId) : 5,
            adviceVariant: item.adviceVariant ?? 0,
            alreadySaid: saidSince(next, item.replyTo),
          }
        : { alreadySaid: saidSince(next, item.replyTo) },
      false,
    );
    return next;
  }

  const mode: Mode = item.intent === 'peer' ? 'peer' : item.intent === 'reply' ? 'reply' : 'ambient';
  next = await speak(next, ctx, persona, mode, item.replyTo, now, profile, item.depth ?? 0);
  return next;
};

const shouldAmbient = (room: Room, now: number, profile: LivelinessProfile): boolean => {
  if (inQuietHours(now)) return false;
  if (room.scheduled.some((s) => s.intent === 'ambient')) return false;
  const gap = (profile.ambientGap[0] + profile.ambientGap[1]) / 2;
  return now - room.lastMessageAt >= gap;
};

/** AI 给自己排的那件小事，到点了就在群里说一声。 */
const tickPersonaSteps = async (
  room: Room,
  ctx: Ctx,
  now: number,
): Promise<Room> => {
  let next = room;
  for (const step of room.steps) {
    if (step.ownerId === 'me' || step.doneAt) continue;
    if (!step.dueAt || step.dueAt > now) continue;
    const persona = next.cast.find((p) => p.id === step.ownerId);
    next = {
      ...next,
      steps: next.steps.map((s) => (s.id === step.id ? { ...s, doneAt: now } : s)),
    };
    if (!persona) continue;
    let text = mockLine(persona, 'step');
    if (!isMock(ctx.config)) {
      ctx.calls += 1;
      try {
        const raw = await streamChat({
          config: ctx.config,
          messages: [
            { role: 'system', content: systemForRoom(persona, next.cast) },
            { role: 'user', content: `你照着自己那件小事做了一次：${step.text}\n\n说一句结果，20 字以内。可以很普通，甚至没做成。不要写成「真有效」。` },
          ],
          signal: new AbortController().signal,
          onDelta: () => {},
          maxTokens: 60,
          lowEffort: true,
        });
        const line = cleanLine(raw, 40);
        if (line && !findCrisis(line) && !auditTone(line)) text = line;
      } catch {
        // 用兜底台词
      }
    }
    next = pushMessage(next, personaMessage(persona, text, now), now);
    next = spend(next, now);
    next = updateMind(next, persona.id, (p) => ({ ...p, mind: mindAfterStep(p, now) }));
  }
  return next;
};

/** 偶尔让某个 AI 自己给自己排一件小事，之后会通报「我做了」。 */
const maybePersonaStep = (room: Room, now: number, liveliness: number): Room => {
  const open = room.steps.filter((s) => s.ownerId !== 'me' && !s.doneAt);
  if (open.length >= 2) return room;
  if (Math.random() >= 0.012 + 0.02 * clamp01(liveliness)) return room;
  const persona = pick(room.cast);
  const action = pick(pickActions(new Date(now).getHours(), 3));
  const step: NextStep = {
    id: uid(),
    text: action.label,
    ownerId: persona.id,
    ownerName: persona.name,
    origin: 'persona',
    actionId: action.id,
    createdAt: now,
    dueAt: now + rand(70_000, 200_000),
  };
  return { ...room, steps: [...room.steps, step] };
};

export async function tickRoom(input: TickInput): Promise<TickOutput> {
  const now = input.now ?? Date.now();
  const ctx: Ctx = { config: input.config, calls: 0, logs: [] };
  let room = ensureUsage(cloneRoom(input.room), now);
  // 每天把处境重算一次；聊天冷却久了关系会淡
  room = { ...room, cast: prepareCast(room.cast, now) };
  const profile = livelinessProfile(input.settings.liveliness);

  if (budgetLeft(room, input.settings, now) <= 0) {
    return { room, calls: 0, logs: ['今天的热闹额度用完了'] };
  }

  room = await tickPersonaSteps(room, ctx, now);
  room = maybePersonaStep(room, now, input.settings.liveliness);

  const due = room.scheduled.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);
  if (due.length) {
    const item = due[0];
    const person = room.cast.find((p) => p.id === item.personaId);
    if (person) {
      room = await deliver(room, ctx, item, now, profile);
    } else {
      room = { ...room, scheduled: room.scheduled.filter((s) => s.id !== item.id) };
    }
  } else if (shouldAmbient(room, now, profile)) {
    const speaker = pickSpeaker(room, room.messages.filter((m) => m.kind === 'chat').slice(-1)[0]?.text ?? '', now);
    // 主动开口的人得是真的醒着；没醒的人只在你说话时可能应一声
    if (speaker && awakeFactor(speaker, new Date(now).getHours()) >= 0.6 && cooldownOk(room, speaker.id, now, profile.cooldown)) {
      room = await speak(room, ctx, speaker, 'ambient', undefined, now, profile);
    }
  }

  room = { ...room, lastSeenAt: now };
  return { room, calls: ctx.calls, logs: ctx.logs };
}

/* ------------------------------------------------------------------ *
 * 玩家侧
 * ------------------------------------------------------------------ */

/**
 * 玩家在情绪里或者卡住了。
 * 先排 1–2 条陪伴，再排至少 2 条建议——建议各绑一个不同的动作，保证内容不一样。
 * 这里不受「热闹度」限制：该有人接住的时候，安静也得接住。
 */
const scheduleComfortThenAdvice = (
  room: Room,
  message: Message,
  text: string,
  tone: Tone,
  now: number,
): Room => {
  const cast = room.cast;
  if (!cast.length) return room;
  const scheduled: ScheduledMessage[] = [];
  const comfortCount = Math.min(tone === 'heavy' ? 2 : 1, cast.length);
  const comforters: Persona[] = [];

  // 被点名的人先来陪
  for (const person of cast.filter((p) => message.mentions?.includes(p.id))) {
    if (comforters.length < comfortCount) comforters.push(person);
  }
  while (comforters.length < comfortCount) {
    const person = pickSpeaker(room, text, now, comforters.map((p) => p.id));
    if (!person) break;
    comforters.push(person);
  }
  comforters.forEach((person, index) => {
    scheduled.push({
      id: uid(),
      personaId: person.id,
      at: now + rand(3_000, 9_000) + index * rand(2_000, 6_000),
      intent: 'comfort',
      replyTo: message.id,
      depth: 0,
    });
  });

  // 建议：至少两个人，各绑一个不同的动作
  const options = pickActions(new Date(now).getHours(), 3, inferTrouble(text, 'self'));
  const want = Math.min(2, options.length);
  const comfortIds = new Set(comforters.map((p) => p.id));
  const rank = [...cast].sort((a, b) => scoreFor(room, b, text, now) - scoreFor(room, a, text, now));
  const advisers = rank.filter((p) => !comfortIds.has(p.id)).slice(0, want);
  // 群里人少的时候，允许同一个人再给一次建议
  for (const person of rank) {
    if (advisers.length >= want) break;
    if (!advisers.includes(person)) advisers.push(person);
  }
  advisers.forEach((person, index) => {
    scheduled.push({
      id: uid(),
      personaId: person.id,
      at: now + rand(22_000, 52_000) + index * rand(6_000, 14_000),
      intent: 'advise',
      replyTo: message.id,
      depth: 0,
      adviceId: options[index]?.id,
      adviceVariant: index,
    });
  });

  return { ...room, scheduled: [...room.scheduled, ...scheduled] };
};

/** 玩家说一句：消息进房间，然后按热闹度排谁来回、几个人回。 */
export function postPlayerMessage(
  room: Room,
  text: string,
  identity: Identity,
  mentions: string[],
  replyTo: string | undefined,
  now: number,
  liveliness: number,
): Room {
  const clean = text.trim();
  if (!clean) return room;
  const message: Message = {
    id: uid(),
    authorId: 'me',
    authorKind: 'player',
    authorName: identity.name,
    avatarKey: identity.avatarKey,
    text: clean,
    at: now,
    kind: 'chat',
    replyTo,
    mentions: mentions.length ? mentions : undefined,
  };
  const next: Room = {
    ...room,
    messages: [...room.messages, message],
    lastMessageAt: now,
    lastSeenAt: now,
  };

  // 情绪/迷茫的句子走另一条路：先陪伴，再给建议
  const tone = emotionalSignal(clean);
  if (tone !== 'neutral') {
    return scheduleComfortThenAdvice(next, message, clean, tone, now);
  }

  const profile = livelinessProfile(liveliness);
  const queued = new Set(next.scheduled.map((s) => s.personaId));
  const scheduled: ScheduledMessage[] = [];

  // 被 @ 的人一定回，但什么时候回还是随机的
  for (const person of next.cast.filter((p) => mentions.includes(p.id))) {
    if (queued.has(person.id)) continue;
    queued.add(person.id);
    scheduled.push({
      id: uid(),
      personaId: person.id,
      at: now + rand(2_500, 9_000),
      intent: 'reply',
      replyTo: message.id,
      depth: 0,
    });
  }

  const target =
    1 + (Math.random() < profile.extraReply[0] ? 1 : 0) + (Math.random() < profile.extraReply[1] ? 1 : 0);
  let extra = Math.max(0, target - scheduled.length);
  // 已经点名叫人了，其他人插话的概率减半
  if (mentions.length && Math.random() >= 0.5) extra = 0;
  extra = Math.min(extra, Math.max(0, 3 - scheduled.length));

  for (let i = 0; i < extra; i++) {
    const speaker = pickSpeaker(next, clean, now, [...queued]);
    if (!speaker) break;
    queued.add(speaker.id);
    scheduled.push({
      id: uid(),
      personaId: speaker.id,
      at: now + rand(3_000, 14_000) + i * 2_500,
      intent: 'reply',
      replyTo: message.id,
      depth: 0,
    });
  }

  return { ...next, scheduled: [...next.scheduled, ...scheduled] };
}

/** 玩家自己加一条下一步。 */
export function addStep(room: Room, text: string, group: string, identity: Identity, now = Date.now()): Room {
  const clean = text.trim();
  if (!clean) return room;
  const step: NextStep = {
    id: uid(),
    text: clean,
    ownerId: 'me',
    ownerName: identity.name,
    origin: 'self',
    group: group.trim() || undefined,
    createdAt: now,
  };
  return { ...room, steps: [step, ...room.steps] };
}

export function completeStep(room: Room, stepId: string, now = Date.now(), liveliness = 0.5): Room {
  const step = room.steps.find((s) => s.id === stepId);
  if (!step || step.doneAt) return room;
  let next: Room = {
    ...room,
    steps: room.steps.map((s) => (s.id === stepId ? { ...s, doneAt: now } : s)),
  };
  // 「被看到」由系统消息保证，与热闹度无关
  next = pushMessage(next, systemMessage(`你完成了：${step.text}`, now), now);

  const profile = livelinessProfile(liveliness);
  const speakers: Persona[] = [];
  const count = Math.random() < profile.reactCount ? (Math.random() < profile.reactCount - 0.4 ? 2 : 1) : 0;
  for (let i = 0; i < count; i++) {
    const person = pickSpeaker(next, step.text, now, speakers.map((p) => p.id));
    if (person) speakers.push(person);
  }
  const scheduled: ScheduledMessage[] = speakers.map((person, index) => ({
    id: uid(),
    personaId: person.id,
    at: now + rand(4_000, 12_000) + index * 6_000,
    intent: 'react',
    stepId,
    depth: 0,
  }));
  return { ...next, scheduled: [...next.scheduled, ...scheduled] };
}

export function dropStep(room: Room, stepId: string): Room {
  return { ...room, steps: room.steps.filter((s) => s.id !== stepId) };
}

/** 「做不到」：同一条动作链里再小一级。 */
export function shrinkStep(room: Room, stepId: string): Room {
  const step = room.steps.find((s) => s.id === stepId);
  if (!step?.actionId) return room;
  const smaller = smallerAction(step.actionId);
  if (!smaller) return room;
  return {
    ...room,
    steps: room.steps.map((s) =>
      s.id === stepId ? { ...s, text: smaller.label, actionId: smaller.id } : s,
    ),
  };
}

/** 请群里某个人给一个下一步：这是产品的核心动作。 */
export async function requestStep(
  room: Room,
  ctxInput: { config: LlmConfig; now?: number },
): Promise<{ room: Room; calls: number; logs: string[] }> {
  const now = ctxInput.now ?? Date.now();
  const ctx: Ctx = { config: ctxInput.config, calls: 0, logs: [] };
  const recent = room.messages.filter((m) => m.kind === 'chat').slice(-6);
  const text = recent.filter((m) => m.authorKind === 'player').slice(-1)[0]?.text ?? recent.slice(-1)[0]?.text ?? '';
  const trouble = inferTrouble(text, 'self');
  const options = pickActions(new Date(now).getHours(), 3, trouble);
  const action = options[0];
  const persona = pickSpeaker(room, text, now);
  if (!persona) return { room, calls: 0, logs: ['群里暂时没人'] };

  let line = action.line;
  if (!isMock(ctx.config)) {
    ctx.calls += 1;
    try {
      const raw = await streamChat({
        config: ctx.config,
        messages: [
          { role: 'system', content: systemForRoom(persona, room.cast) },
          {
            role: 'user',
            content: `群里刚在聊这些：\n${recent.map((m) => `${m.authorName}：${m.text}`).join('\n')}\n\n从下面三个小步里挑一个最适合的，用「我卡住的时候一般会……」的口气说出来，不超过 30 字，优先选跟上面最相关的。只输出一行：编号|你说的话\n\n${options
              .map((o) => `${o.id} | ${o.label}（${o.minutes} 分钟）`)
              .join('\n')}`,
          },
        ],
        signal: new AbortController().signal,
        onDelta: () => {},
        maxTokens: 120,
        lowEffort: true,
      });
      const said = cleanLine(raw.split('|').slice(1).join('|'), 60);
      if (said && !findCrisis(said) && !auditTone(said)) line = said;
    } catch {
      line = action.line;
    }
  }

  let next = pushMessage(room, personaMessage(persona, line, now), now);
  next = spend(next, now);
  const step: NextStep = {
    id: uid(),
    text: action.label,
    ownerId: 'me',
    ownerName: '你',
    origin: 'ai',
    fromPersonaId: persona.id,
    fromName: persona.name,
    actionId: action.id,
    createdAt: now,
  };
  next = { ...next, steps: [step, ...next.steps] };
  next = updateMind(next, persona.id, (p) => ({ ...p, mind: mindAfterReply(p, '你', now) }));
  return { room: next, calls: ctx.calls, logs: ctx.logs };
}

/* ------------------------------------------------------------------ *
 * 时间：补算 + 换人
 * ------------------------------------------------------------------ */

const describeElapsed = (ms: number): string => {
  const minutes = Math.round(ms / MIN);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
};

/**
 * 「时间不停止」为开时：按离开的时长补几条。
 * 这是补算，不是真的在后台跑——网页关掉以后不可能继续运行。
 */
export async function catchUpRoom(input: TickInput): Promise<TickOutput> {
  const now = input.now ?? Date.now();
  const ctx: Ctx = { config: input.config, calls: 0, logs: [] };
  let room = ensureUsage(cloneRoom(input.room), now);
  room = { ...room, cast: prepareCast(room.cast, now) };
  const elapsed = now - room.lastSeenAt;

  if (elapsed < 90_000) return { room: { ...room, lastSeenAt: now }, calls: 0, logs: [] };
  if (!input.settings.timeFlow && elapsed > 3 * MIN) {
    // 时间停住：不补，只把「上次看到」推进到现在
    return { room: { ...room, lastSeenAt: now }, calls: 0, logs: [] };
  }

  const left = budgetLeft(room, input.settings, now);
  const wanted = Math.min(4, Math.max(1, Math.floor(elapsed / (2 * MIN))), left);
  if (wanted <= 0) return { room: { ...room, lastSeenAt: now }, calls: 0, logs: [] };

  room = pushMessage(
    room,
    systemMessage(`你离开了 ${describeElapsed(elapsed)}。`, now - elapsed + 1_000),
    now,
  );

  for (let i = 0; i < wanted; i++) {
    const at = room.lastSeenAt + (elapsed * (i + 1)) / (wanted + 1);
    const speaker = pickSpeaker(room, '', at);
    if (!speaker) continue;
    const text = await generateLine(ctx, room, speaker, 'ambient', undefined, at);
    const message = personaMessage(speaker, text, at);
    room = {
      ...room,
      messages: [...room.messages, message],
      usage: { day: dayKey(now), messages: usedToday(room, now) + 1 },
    };
  }

  room = { ...room, lastSeenAt: now, lastMessageAt: now };
  return { room, calls: ctx.calls, logs: ctx.logs };
}

/**
 * 换一批群友：旧房间进存档（只读），新房间只有你的人设、没有旧记录。
 * 你自己加的步骤留着——那是你的东西，不是他们的。
 */
export function rerollRoom(room: Room, now = Date.now()): { room: Room; archived: Room } {
  const archived: Room = { ...cloneRoom(room), archivedAt: now };
  archived.messages = archived.messages.slice(-150);
  const next = newRoom(pickCast(4), now);
  next.steps = room.steps
    .filter((s) => s.ownerId === 'me' && !s.doneAt)
    .map((s) => ({ ...s, fromPersonaId: undefined, fromName: s.fromName }));
  next.messages = [systemMessage('换了一批群友。之前的房间收在「旧群聊」里。', now)];
  next.lastMessageAt = now;
  next.usage = room.usage;
  return { room: next, archived };
}

/* ------------------------------------------------------------------ *
 * 旧群聊：可以放回当下，也可以显式舍弃
 * ------------------------------------------------------------------ */

export const MAX_ARCHIVES = 8;

/**
 * 把一个旧群聊放回当下：当前房间进存档，两边交换，谁都不会消失。
 * 恢复时把排期推到未来——否则几天前的队列会在一次 tick 里全部弹出来。
 */
export function restoreArchive(
  current: Room,
  archives: Room[],
  id: string,
  now = Date.now(),
): { room: Room; archives: Room[] } | null {
  const target = archives.find((r) => r.id === id);
  if (!target) return null;
  const restored: Room = {
    ...cloneRoom(target),
    archivedAt: undefined,
    lastSeenAt: now,
    lastMessageAt: now,
    scheduled: target.scheduled.map((s) => ({ ...s, at: now + rand(3_000, 12_000) })),
  };
  const parked: Room = { ...cloneRoom(current), archivedAt: now };
  parked.messages = parked.messages.slice(-150);
  const rest = archives.filter((r) => r.id !== id);
  return { room: restored, archives: [parked, ...rest].slice(0, MAX_ARCHIVES) };
}

/** 舍弃是显式动作，不自动发生。 */
export function discardArchive(archives: Room[], id: string): Room[] {
  return archives.filter((r) => r.id !== id);
}
