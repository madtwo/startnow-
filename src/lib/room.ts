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
import { captureModelFence } from './modelFence';
import { auditTone, BASELINE } from './baseline';
import { unsafeForumRaw } from './forumReplyPolicy';
import { personaCompletionExample, validatePersonaCompletion } from './personaCompletion';
import { findCrisis, isHeavyShare } from './safety';
import { ensureMind, mindAfterPeer, mindAfterReply, mindAfterStep } from './mind';
import { recordReplyMemory } from './memory';
import { buildPersonaPrompt, pickCast } from './personas';
import { refreshSituations } from './castGen';
import { emotionalSignal, isGreeting, type Tone } from './tone';
import { LlmError, streamChat } from './llm';
import { defaultRoomSettings } from './roomSettingsDefaults';
import { actionLabel, actionMinutes, inferTrouble, pickActions, smallerAction } from './actions';
import {
  cleanLine,
  PUBLIC_RULES,
  ROOM_RULES,
  ROOM_STYLE,
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

export const budgetLeft = (room: Room, settings: RoomSettings, now = Date.now()): number => {
  const used = usedToday(room, now);
  return Number.isFinite(settings.dailyMessages) && Number.isSafeInteger(used) && used >= 0
    ? Math.max(0, Math.floor(settings.dailyMessages) - used) : 0;
};

const spend = (room: Room, now: number): Room => ({
  ...room,
  usage: { day: dayKey(now), messages: usedToday(room, now) + 1 },
});

/** Three-way merge: only the delta generated by this operation can be applied
 * to a newer room. Never resurrect deleted steps or move content across rooms. */
function mergeRoomRows<T extends {id: string}>(current: T[], base: T[], result: T[], allowAdd: (r: T) => boolean = () => true): T[] {
  const prior = new Map(base.map(r => [r.id, r]));
  const generated = new Map(result.map(r => [r.id, r]));
  const currentIds = new Set(current.map(r => r.id));
  const out = current.flatMap(r => {
    const old = prior.get(r.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(r)) return [r];
    const updated = generated.get(r.id);
    return updated ? [updated] : [];
  });
  return [...out, ...result.filter(r => !prior.has(r.id) && !currentIds.has(r.id) && allowAdd(r))];
}
export function commitRoomOperation(current: Room, snapshot: Room, result: Room, now = Date.now()): Room {
  if (current === snapshot && result.id === snapshot.id) return result;
  const used = Math.max(usedToday(current, now), usedToday(result, now));
  const usage = used === usedToday(current, now) ? current.usage : { day: dayKey(now), messages: used };
  if (current.id !== snapshot.id || result.id !== snapshot.id) return { ...current, usage };
  const previousMessages = new Set(snapshot.messages.map(m => m.id));
  const currentMessages = new Set(current.messages.map(m => m.id));
  const newerPlayer = current.messages.some(m => m.authorKind === 'player' && !previousMessages.has(m.id));
  const presentPersonas = new Set(current.cast.map(p => p.id));
  const steps = mergeRoomRows(current.steps, snapshot.steps, result.steps,
    step => (step.ownerId === 'me' || presentPersonas.has(step.ownerId)) &&
      (!step.fromPersonaId || presentPersonas.has(step.fromPersonaId)));
  const stepById = new Map(steps.map(s => [s.id, s]));
  const resultStepById = new Map(result.steps.map(s => [s.id, s]));
  // The linked step must survive the merge with the exact result state.
  // A deleted/changed step cannot produce an asynchronous success claim.
  const candidates = result.messages.filter(m => !previousMessages.has(m.id) && !currentMessages.has(m.id) &&
    (m.authorKind !== 'persona' || presentPersonas.has(m.authorId)) &&
    (!m.stepId || (stepById.has(m.stepId) && JSON.stringify(stepById.get(m.stepId)) === JSON.stringify(resultStepById.get(m.stepId)))));
  // Resolve reply dependencies only against retained messages. Iterate to
  // support chains without accidentally accepting a reply to a dropped parent.
  const acceptedIds = new Set(currentMessages);
  let remaining = candidates;
  while (remaining.length) {
    const ready = remaining.filter(m => !m.replyTo || acceptedIds.has(m.replyTo));
    if (!ready.length) break;
    for (const m of ready) acceptedIds.add(m.id);
    remaining = remaining.filter(m => !acceptedIds.has(m.id));
  }
  const added = candidates.filter(m => acceptedIds.has(m.id));
  // Stable chronological merge: preserve order at equal timestamps, and
  // apply the history cap only after merging old/new messages.
  const messages = [...current.messages, ...added].sort((a, b) => a.at - b.at).slice(-400);
  const messageIds = new Set(messages.map(m => m.id));
  return {
    ...current, usage, messages,
    steps,
    scheduled: mergeRoomRows(current.scheduled, snapshot.scheduled, result.scheduled,
      job => presentPersonas.has(job.personaId) && (!job.replyTo || messageIds.has(job.replyTo)) && !(newerPlayer && job.intent === 'peer'))
      .filter(job => !job.stepId || (stepById.has(job.stepId) && (job.intent !== 'react' || !!stepById.get(job.stepId)?.doneAt))),
    cast: mergeRoomRows(current.cast, snapshot.cast, result.cast, () => false),
    lastMessageAt: Math.max(current.lastMessageAt, result.lastMessageAt),
    lastSeenAt: Math.max(current.lastSeenAt, result.lastSeenAt),
  };
}

/** 群名默认就是「都有谁」：你 + 群友的昵称，人多了折成「等 N 人」。 */
export const defaultRoomTitle = (playerName: string, cast: Persona[]): string => {
  const names = [playerName.trim() || '我', ...cast.map((p) => p.name)].filter(Boolean);
  if (!names.length) return '群聊';
  const head = names.slice(0, 3).join('、');
  return names.length > 3 ? `${head} 等 ${names.length} 人` : head;
};

/** 用户改过名就不再自动生成；没改过的旧房间顺手换成新写法。 */
export const ensureRoomTitle = (room: Room, playerName: string): Room =>
  room.titleEdited ? room : { ...room, title: defaultRoomTitle(playerName, room.cast) };

export const renameRoom = (room: Room, title: string): Room => {
  const clean = title.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!clean) return room;
  return { ...room, title: clean, titleEdited: true };
};

export const newRoom = (cast: Persona[], now = Date.now(), playerName = '我'): Room => {
  const people = (cast.length ? cast : pickCast(4)).map((p) => ({
    ...p,
    mind: ensureMind(p, now),
  }));
  const first = pick(people);
  const room: Room = {
    id: uid(),
    title: defaultRoomTitle(playerName, people),
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
  // 开场只让一个人招呼新人，不要让四个人先自顾自聊起来
  room.scheduled.push({ id: uid(), personaId: first.id, at: start, intent: 'welcome', depth: 0 });
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
  maxAttempts: number;
  signal?: AbortSignal;
  reserveAttempt?: () => boolean;
  storagePermit?: () => boolean;
}
const roomSignal = (ctx: Ctx) => ctx.signal
  ? AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
const roomAttempt = (ctx: Ctx) => {
  if (ctx.calls >= ctx.maxAttempts || (ctx.reserveAttempt && !ctx.reserveAttempt())) {
    throw new LlmError('quota', '今日群聊额度已用尽或用量无法安全保存');
  }
  ctx.calls++;
};
const visibleRoomText = (line: string) => line.normalize('NFKC').replace(/[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}·•・‧∙⋅]/gu, '');
const safeRoomLine = (line: string) => !!visibleRoomText(line) && !unsafeForumRaw(line) && !auditTone(line);
const meaningfulResult = (line: string) => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(visibleRoomText(line));
const hasCrisisHistory = (messages: readonly Message[]) => messages.some(m => findCrisis(m.text));
const recentCrisis = (room: Room) => hasCrisisHistory(room.messages.filter(m => m.kind === 'chat').slice(-8));

// Real calls count attempted POSTs (including failure, retry and fallback).
// Demo mode retains its visible-message counter; no POST is made.
const spendVisible = (room: Room, ctx: Ctx, now: number) => isMock(ctx.config) ? spend(room, now) : room;
const settleRoomUsage = (room: Room, ctx: Ctx, now: number): Room => isMock(ctx.config) || !ctx.calls ? room :
  { ...room, usage: { day: dayKey(now), messages: usedToday(room, now) + ctx.calls } };

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
  const toPlayer = relOf(persona, 'me');
  const strangerNote =
    toPlayer < 10
      ? '可以报名字、专业、年级；不要问隐私、不开玩笑式亲昵、不说「我懂你」「抱抱」「我也理解你」。刚认识的人不会一上来就吐苦水：可以先问一句大家都喜欢什么（比如你自己喜欢的运动或游戏），也可以说一句轻的自己的事（起晚了、食堂排队、天气），但先别碰压力、ddl、考试这种重话题。'
      : toPlayer < 25
        ? '可以说课程、宿舍、最近在忙什么，也可以讲讲自己的事和兴趣。'
        : '可以提起之前聊过的事，语气可以随意一点。想约着一起做点什么，也只能约线上能做的（一起看直播、开黑、云自习），不要约定线下见面。';
  return `【你和这群人熟到什么程度】（数字小的时候别装熟：不叫昵称、不说「你上次」、不假装懂对方）
群里那个新来的人：${relationLabel(toPlayer)}——${strangerNote}
${rows.join('\n')}`;
};

const interestBlock = (persona: Persona): string => {
  const parts: string[] = [];
  const list = persona.interests ?? [];
  if (list.length) {
    parts.push(
      `【你自己喜欢的事】${list.join('、')}（刚认识时用来找话题，别一上来就约；熟了才可能约着一起做，而且只能是线上能一起做的）`,
    );
  }
  const habits = persona.speechHabit ?? [];
  if (habits.length) {
    parts.push(`【你打字的习惯】${habits.join('；')}。照这个感觉写，但不许每句都一模一样。`);
  }
  return parts.join('\n');
};

export const systemForRoom = (persona: Persona, cast: Persona[]): string =>
  [
    BASELINE,
    PUBLIC_RULES,
    ROOM_RULES,
    ROOM_STYLE,
    buildPersonaPrompt(persona),
    situationBlock(persona),
    interestBlock(persona),
    relationBlock(persona, cast),
  ]
    .filter(Boolean)
    .join('\n\n');

const findMessage = (room: Room, id?: string): Message | undefined =>
  id ? room.messages.find((m) => m.id === id) : undefined;

type Mode = 'welcome' | 'room' | 'reply' | 'peer' | 'ambient' | 'react' | 'comfort' | 'advise';

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

/** 模型爱用的书面腔、总结句、破折号，在这里统一掐掉。 */
export const polishLine = (text: string): string =>
  text
    .replace(/[—–]+/g, '，')
    .replace(/；/g, '，')
    .replace(/^(其实|或许|也许|总的来说|另外)[，,]?\s*/, '')
    .replace(/[，,]?\s*(希望对你有帮助|希望[你它]能帮到你|加油|一切都会好(起来)?|慢慢来)[。！!]?$/g, '')
    .replace(/，{2,}/g, '，')
    .replace(/^[，,。！!]+/, '')
    .replace(/[，,、]+$/, '')
    .trim();

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
  if (mode === 'welcome') return `你好，我是${persona.name}，${persona.major}${persona.cohort}。`;
  if (mode === 'room') return mockLine(persona, 'reply');
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
): Promise<string | null> => {
  const replyMessage = findMessage(room, replyTo);
  if (recentCrisis(room) || (replyMessage && findCrisis(replyMessage.text)) ||
      extra.alreadySaid?.some(findCrisis)) return null;
  if (isMock(ctx.config)) {
    // 演示模式也要能接住招呼，否则「大家好」会换来一句心事
    if (mode === 'reply' && replyMessage && isGreeting(replyMessage.text)) {
      return pick([
        `你好，我是${persona.name}，${persona.major}${persona.cohort}。`,
        `${persona.name}，${persona.major}${persona.cohort}。你好。`,
      ]);
    }
    return fallbackLine(persona, mode, extra);
  }
  if (ctx.signal?.aborted || ctx.calls >= ctx.maxAttempts) return null;
  const replyName = replyMessage?.authorName;
  const topic = room.messages.filter((m) => m.kind === 'chat').slice(-1)[0]?.text;
  try {
    const text = await streamChat({
      config: ctx.config,
      storagePermit: ctx.storagePermit,
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
      signal: roomSignal(ctx),
      onRequestAttempt: () => roomAttempt(ctx),
      sessionId: `ses_r_${Math.random().toString(36).slice(2, 10)}`,
      onDelta: () => {},
      maxTokens: 110,
      lowEffort: true,
    });
    const line = polishLine(cleanLine(text, 100));
    if (!unsafeForumRaw(text) && safeRoomLine(line)) return line;
    ctx.logs.push(`${persona.name} 那句未通过安全或内容校验，未发布`);
  } catch {
    ctx.logs.push(`${persona.name} 这次没说出来`);
  }
  // 真实模式失败就让这张嘴闭上：发一条和上下文无关的兜底台词，比不说话更糟
  return null;
};

const updateMind = (room: Room, personaId: string, patch: (p: Persona) => Persona): Room => ({
  ...room,
  cast: room.cast.map((p) => (p.id === personaId ? patch(p) : p)),
});

/* ------------------------------------------------------------------ *
 * 谁会被一条消息吸引：每个人自己掷骰，而不是「玩家说话就必有人回」
 * ------------------------------------------------------------------ */

interface ReactionOptions {
  /** 这条是 AI 说的：最多引一个人接，避免 AI 之间无限对聊 */
  aiTrigger?: boolean;
  /** 兜底规则：玩家的话太久没人接，强制安排一个人回 */
  forced?: boolean;
  /** 覆盖默认上限：演示模式下一个就够，别太吵 */
  max?: number;
}

/** 这个人对这条消息的插嘴概率。 */
const reactionChance = (
  room: Room,
  persona: Persona,
  trigger: Message,
  now: number,
  liveliness: number,
): number => {
  const hour = new Date(now).getHours();
  const awake = awakeFactor(persona, hour);
  const base = persona.reactivity ?? 0.45;
  if (awake < 0.4) return base * 0.15; // 睡着的人基本不接
  if (trigger.mentions?.includes(persona.id)) return 1; // 被点名，一定回
  const topic = inferTrouble(trigger.text, 'self');
  const relevance = (persona.weights[topic] ?? 0) / 100;
  const peak = persona.peak ? inWindow(hour, persona.peak) : false;
  const asked = /[?？]|吗|呢|怎么|为什么|要不要|有没有/.test(trigger.text) ? 0.15 : 0;
  const last = [...room.messages].reverse().find((m) => m.authorId === persona.id);
  const gap = last ? (now - last.at) / 1000 : 999;
  const cooldown = gap < 20 ? -0.35 : gap < 45 ? -0.15 : 0;
  const lively = (clamp01(liveliness) - 0.5) * 0.3;
  return clamp01(base + relevance + awake * 0.1 + (peak ? 0.15 : 0) + asked + cooldown + lively);
};

const delayFor = (persona: Persona, now: number): number => {
  const [lo, hi] = persona.pace ?? [6, 18];
  return now + rand(lo, hi) * 1000;
};

/**
 * 一条新消息进来：每个 AI 各自决定要不要接。
 * 负面情绪优先走「安慰 + 建议」，同一条只触发一次。
 */
function considerReactions(
  room: Room,
  trigger: Message,
  now: number,
  liveliness: number,
  opts: ReactionOptions = {},
): Room {
  if (trigger.kind !== 'chat') return room;
  const tone = emotionalSignal(trigger.text);
  if (tone !== 'neutral' && !trigger.careHandled) {
    const guarded: Room = {
      ...room,
      messages: room.messages.map((m) => (m.id === trigger.id ? { ...m, careHandled: true } : m)),
    };
    return scheduleComfortThenAdvice(guarded, trigger, trigger.text, tone, now);
  }

  const queued = new Set(room.scheduled.map((s) => s.personaId));
  const limit = opts.max ?? (opts.forced || opts.aiTrigger ? 1 : 2);
  const candidates = room.cast
    .filter((p) => p.id !== trigger.authorId && !queued.has(p.id))
    .map((p) => ({ p, chance: reactionChance(room, p, trigger, now, liveliness) }))
    .sort((a, b) => b.chance - a.chance);

  const scheduled: ScheduledMessage[] = [];
  for (const { p, chance } of candidates) {
    if (scheduled.length >= limit) break;
    if (!opts.forced && Math.random() >= chance) continue;
    const direct = opts.forced || Boolean(trigger.mentions?.includes(p.id));
    scheduled.push({
      id: uid(),
      personaId: p.id,
      at: delayFor(p, now),
      intent: 'reply',
      // 点名的才定向回；否则就是对着群里说
      replyTo: direct ? trigger.id : undefined,
      depth: opts.aiTrigger ? 1 : 0,
    });
  }
  if (!scheduled.length) return room;
  return { ...room, scheduled: [...room.scheduled, ...scheduled] };
}

/** 玩家最近一句还没有人接的那条消息。 */
const unansweredPlayerMessage = (room: Room): Message | null => {
  const player = [...room.messages].reverse().find((m) => m.authorKind === 'player' && m.kind === 'chat');
  if (!player) return null;
  const answered = room.messages.some((m) => m.replyTo === player.id);
  return answered ? null : player;
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
  signal?: AbortSignal;
  reserveAttempt?: () => boolean;
  storagePermit?: () => boolean;
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

/** 让一个 AI 真的说完一句话，并处理心智、记忆、关系，以及这条会不会引来别人。 */
const speak = async (
  room: Room,
  ctx: Ctx,
  persona: Persona,
  intent: 'welcome' | 'room' | 'reply' | 'peer' | 'ambient' | 'react' | 'comfort' | 'advise',
  replyTo: string | undefined,
  now: number,
  liveliness: number,
  extra: LineExtra = {},
  allowReactions = true,
): Promise<Room> => {
  const text = await generateLine(ctx, room, persona, intent, replyTo, now, extra);
  // 说不出来就不发：一张假台词会把整段对话带偏
  if (!text) return room;
  const message = personaMessage(persona, text, now, replyTo);
  let next = pushMessage(room, message, now);
  next = spendVisible(next, ctx, now);
  const last = findMessage(next, replyTo);
  next = updateMind(next, persona.id, (p) =>
    last?.authorKind === 'persona'
      ? { ...p, mind: mindAfterPeer(p, last.authorName, last.text, now) }
      : { ...p, mind: mindAfterReply(p, last?.authorName ?? '群里的人', now) },
  );
  // 安慰 / 建议比普通闲聊更拉近关系
  const caring = intent === 'comfort' || intent === 'advise';
  if (last?.authorKind === 'player') {
    next = updateMind(next, persona.id, (p) => ({
      ...bump(p, 'me', caring || isHeavyShare(last.text) ? 2 : 1, now),
      memory: recordReplyMemory(p, last.authorName, last.text, next.id, now),
    }));
  } else if (last?.authorKind === 'persona') {
    next = updateMind(next, persona.id, (p) => bump(p, last.authorId, caring ? 1.5 : 0.6, now));
    if (caring) {
      // 被安慰的那个人也记住了这份好
      next = updateMind(next, last.authorId, (p) => bump(p, persona.id, 1.5, now));
    }
  }
  // 别人说话你听着，也算一点点认识
  if (text.replace(/\s+/g, '').length > 6) next = heardAbout(next, persona.id, now);
  // 陪伴、建议、欢迎、收尾不再引别人接话：这几类被接一句会很怪
  if (allowReactions && !caring && intent !== 'welcome' && intent !== 'react') {
    next = considerReactions(next, message, now, liveliness, { aiTrigger: true });
  }
  return next;
};

const deliver = async (
  room: Room,
  ctx: Ctx,
  item: ScheduledMessage,
  now: number,
  liveliness: number,
): Promise<Room> => {
  const persona = room.cast.find((p) => p.id === item.personaId);
  let next = { ...room, scheduled: room.scheduled.filter((s) => s.id !== item.id) };
  if (!persona) return next;

  if (item.intent === 'react') {
    if (item.stepId && !next.steps.some(s => s.id === item.stepId && s.doneAt && s.ownerId === 'me')) return next;
    const text = await generateLine(ctx, next, persona, 'react', undefined, now);
    if (!text) return next;
    next = pushMessage(next, { ...personaMessage(persona, text, now), stepId: item.stepId }, now);
    next = spendVisible(next, ctx, now);
    return updateMind(next, persona.id, (p) => ({ ...p, mind: mindAfterReply(p, '你', now) }));
  }

  // 群里刚进来人：先打个招呼，说清自己是谁
  if (item.intent === 'welcome') {
    return speak(next, ctx, persona, 'welcome', undefined, now, liveliness, {}, false);
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
      liveliness,
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

  // 定向回某一条 vs 对着群里说一句
  const mode: Mode =
    item.intent === 'peer' ? 'peer' : item.intent === 'reply' ? (item.replyTo ? 'reply' : 'room') : 'ambient';
  next = await speak(next, ctx, persona, mode, item.replyTo, now, liveliness);
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
  settings: RoomSettings,
): Promise<Room> => {
  let next = room;
  for (const step of room.steps) {
    if (ctx.signal?.aborted || budgetLeft(next, settings, now) <= 0 ||
        (!isMock(ctx.config) && ctx.calls >= ctx.maxAttempts)) break;
    if (step.ownerId === 'me' || step.doneAt) continue;
    if (!step.dueAt || step.dueAt > now) continue;
    const persona = next.cast.find((p) => p.id === step.ownerId);
    if (!persona) continue;
    if (findCrisis(step.text)) {
      // Imported historical steps may predate the current input guard.
      next = { ...next, steps: next.steps.map(s => s.id === step.id ? { ...s, dueAt: now + 5 * MIN } : s) };
      ctx.logs.push('历史步骤需要先处理危机支持');
      continue;
    }
    // Only demo mode may synthesize a fictional completion locally. In real
    // mode the original task, not the model, selects the evidence contract.
    let text: string | null = null;
    let failure = '这次未能确认完成，稍后再试';
    if (isMock(ctx.config)) {
      text = mockLine(persona, 'step');
    } else {
      const evidence = personaCompletionExample(step);
      if (!evidence) {
        // Unknown legacy/imported tasks must not spend quota every tick on
        // results that cannot be verified. Keep the step, not a fake success.
        failure = '这件小事暂不支持自动完成校验，已保留待办';
      } else try {
        const raw = await streamChat({
          config: ctx.config,
          storagePermit: ctx.storagePermit,
          messages: [
            { role: 'system', content: systemForRoom(persona, next.cast) },
            { role: 'user', content: `这是一个只输出状态行的格式任务，不是聊天。请先在心里模拟这件虚构小事：${step.text}

只输出一行 DONE|一句结果 或 NOT_DONE|一句原因。
必须遵守：
1. 只有任务要求的动作、对象、数量和范围全部达到，且结果仍然有效，才可以用 DONE。
2. 这件任务的完成证据口径是「${evidence}」。这只是校验口径，不表示已经完成；不要为了套格式虚构成功。
3. 未完成、不确定、只完成一部分、结果已撤销或未保存，一律用 NOT_DONE，并简短说明原因。允许模拟这次没有做成。
4. 不要加名字、过程、解释、引号、代码块、第二行。结果或原因尽量不超过20字。不要夸大效果，不要换成别的任务。` },
          ],
          signal: roomSignal(ctx),
          onRequestAttempt: () => roomAttempt(ctx),
          onDelta: () => {},
          maxTokens: 90,
          lowEffort: true,
        });
        const checked = validatePersonaCompletion(step, raw);
        if (checked.kind === 'done') text = checked.text;
        else if (checked.kind === 'not_done') failure = '这次小事还没完成，稍后再试';
        else failure = '小事结果未通过校验，已保留待办';
      } catch {
        // Failed real generation never falls back to a success claim. Do not
        // expose provider errors, raw model text or credentials in the toast.
      }
    }
    if (ctx.signal?.aborted) break;
    if (!text) {
      // Keep the step pending and defer the next try, otherwise the 4s pump
      // could spend today's quota on the same failed persona step.
      next = { ...next, steps: next.steps.map(s => s.id === step.id ? { ...s, dueAt: now + 5 * MIN } : s) };
      ctx.logs.push(`${persona.name}：${failure}`);
      continue;
    }
    next = {
      ...next,
      steps: next.steps.map((s) => (s.id === step.id ? { ...s, doneAt: now } : s)),
    };
    next = pushMessage(next, { ...personaMessage(persona, text, now), stepId: step.id }, now);
    next = spendVisible(next, ctx, now);
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
  const ctx: Ctx = { config: input.config, calls: 0, logs: [], storagePermit: captureModelFence(),
    maxAttempts: budgetLeft(input.room, input.settings, now), signal: input.signal, reserveAttempt: input.reserveAttempt };
  let room = ensureUsage(cloneRoom(input.room), now);
  // 每天把处境重算一次；聊天冷却久了关系会淡
  room = { ...room, cast: prepareCast(room.cast, now) };
  const profile = livelinessProfile(input.settings.liveliness);

  if (input.signal?.aborted || budgetLeft(room, input.settings, now) <= 0) {
    return { room, calls: 0, logs: ['今天的热闹额度用完了'] };
  }

  if (recentCrisis(room)) return { room, calls: 0, logs: ['当前内容需先处理危机支持'] };
  room = await tickPersonaSteps(room, ctx, now, input.settings);
  if (ctx.signal?.aborted || budgetLeft(room, input.settings, now) <= 0 ||
      (!isMock(ctx.config) && ctx.calls >= ctx.maxAttempts)) return { room: settleRoomUsage(room, ctx, now), calls: ctx.calls, logs: ctx.logs };
  room = maybePersonaStep(room, now, input.settings.liveliness);

  // 兜底：你说完话以后，群里已经过了 10 条还没人回你，下一个就安排人回你。
  // 一个集体总得照顾每个人，不能让人一直站在那儿。
  const pending = unansweredPlayerMessage(room);
  if (pending) {
    const since = room.messages.filter((m) => m.kind === 'chat' && m.at > pending.at).length;
    if (since >= 10) {
      room = considerReactions(room, pending, now, input.settings.liveliness, { forced: true });
    }
  }

  const due = room.scheduled.filter((s) => s.at <= now).sort((a, b) => a.at - b.at);
  if (due.length) {
    const item = due[0];
    const person = room.cast.find((p) => p.id === item.personaId);
    if (person) {
      room = await deliver(room, ctx, item, now, input.settings.liveliness);
    } else {
      room = { ...room, scheduled: room.scheduled.filter((s) => s.id !== item.id) };
    }
  } else if (shouldAmbient(room, now, profile)) {
    const speaker = pickSpeaker(room, room.messages.filter((m) => m.kind === 'chat').slice(-1)[0]?.text ?? '', now);
    // 主动开口的人得是真的醒着；没醒的人只在你说话时可能应一声
    if (speaker && awakeFactor(speaker, new Date(now).getHours()) >= 0.6 && cooldownOk(room, speaker.id, now, profile.cooldown)) {
      room = await speak(room, ctx, speaker, 'ambient', undefined, now, input.settings.liveliness);
    }
  }

  room = { ...room, lastSeenAt: now };
  return { room: settleRoomUsage(room, ctx, now), calls: ctx.calls, logs: ctx.logs };
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
  /** 演示模式传 1：台词是模板，人多会显得吵 */
  maxReactions?: number,
): Room {
  const clean = text.trim();
  if (!clean || findCrisis(clean)) return room;
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
    messages: [...room.messages, message].slice(-400),
    // 你刚说完话，先把场子留给你：清掉还排着的 AI 互聊
    scheduled: room.scheduled.filter((s) => s.intent !== 'peer'),
    lastMessageAt: now,
    lastSeenAt: now,
  };

  // 交给统一反应机制：谁接、几个人接，由每个人自己的阈值决定。
  // 负面情绪在 considerReactions 里走「先安慰、再建议」的专用通道。
  return considerReactions(next, message, now, liveliness, { max: maxReactions });
}

/** 玩家自己加一条下一步。 */
export function addStep(room: Room, text: string, group: string, identity: Identity, now = Date.now()): Room {
  const clean = text.trim();
  if (!clean || findCrisis(clean) || findCrisis(group)) return room;
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
  if (!step || step.ownerId !== 'me' || step.doneAt || findCrisis(step.text)) return room;
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

export type StepMutation = { ok: true; room: Room } | { ok: false; room: Room; reason: string };
export function tryAddStep(room: Room, text: string, group: string, identity: Identity, now = Date.now()): StepMutation {
  const next = addStep(room, text, group, identity, now);
  return next === room ? { ok: false, room, reason: '这条内容不能添加为下一步，请检查文字或使用危机求助。' } : { ok: true, room: next };
}
export function tryCompleteStep(room: Room, stepId: string, now = Date.now(), liveliness = 0.5): StepMutation {
  const next = completeStep(room, stepId, now, liveliness);
  return next === room ? { ok: false, room, reason: '这一步不存在、已经完成、不是你的步骤或需要先处理危机支持。' } : { ok: true, room: next };
}
export function dropStep(room: Room, stepId: string): Room {
  return { ...room, steps: room.steps.filter((s) => s.id !== stepId) };
}

/** 「做不到」：同一条动作链里再小一级。 */
export function shrinkStep(room: Room, stepId: string): Room {
  const step = room.steps.find((s) => s.id === stepId);
  if (!step?.actionId || step.ownerId !== 'me' || step.doneAt || findCrisis(step.text)) return room;
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
  ctxInput: { config: LlmConfig; now?: number; settings?: RoomSettings; signal?: AbortSignal; reserveAttempt?: () => boolean },
): Promise<{ room: Room; calls: number; logs: string[] }> {
  const now = ctxInput.now ?? Date.now();
  const settings = ctxInput.settings ?? defaultRoomSettings;
  const left = budgetLeft(room, settings, now);
  if (ctxInput.signal?.aborted || left <= 0) return { room, calls: 0, logs: ['今天的热闹额度用完了'] };
  const ctx: Ctx = { config: ctxInput.config, calls: 0, logs: [], storagePermit: captureModelFence(), maxAttempts: left, signal: ctxInput.signal, reserveAttempt: ctxInput.reserveAttempt };
  const recent = room.messages.filter((m) => m.kind === 'chat').slice(-6);
  const text = recent.filter((m) => m.authorKind === 'player').slice(-1)[0]?.text ?? recent.slice(-1)[0]?.text ?? '';
  if (findCrisis(text) || recentCrisis(room)) return { room, calls: 0, logs: ['当前内容需先处理危机支持'] };
  const trouble = inferTrouble(text, 'self');
  const options = pickActions(new Date(now).getHours(), 3, trouble, text);
  let action = options[0];
  if (!action) return { room, calls: 0, logs: ['其实我也不是很知道……要不换个说法，或者自己加一件小事？'] };
  const persona = pickSpeaker(room, text, now);
  if (!persona) return { room, calls: 0, logs: ['群里暂时没人'] };

  let line: string | null = isMock(ctx.config) ? action.line : null;
  if (!isMock(ctx.config)) {
    try {
      const raw = await streamChat({
        config: ctx.config,
        storagePermit: ctx.storagePermit,
        messages: [
          { role: 'system', content: systemForRoom(persona, room.cast) },
          {
            role: 'user',
            content: `群里刚在聊这些：\n${recent.map((m) => `${m.authorName}：${m.text}`).join('\n')}\n\n从下面三个小步里挑一个最适合的，用「我卡住的时候一般会……」的口气说出来，不超过 30 字，优先选跟上面最相关的。只输出一行：精确的 actionId|你说的话（复制下方 ID，不是列表序号）\n\n${options
              .map((o) => `${o.id} | ${o.label}（${o.minutes} 分钟）`)
              .join('\n')}`,
          },
        ],
        signal: roomSignal(ctx),
        onRequestAttempt: () => roomAttempt(ctx),
        onDelta: () => {},
        maxTokens: 120,
        lowEffort: true,
      });
      const parsed = /^([A-Za-z0-9_-]+)[ \t]*\|([^|\r\n\u2028\u2029]+)$/u.exec(raw.trim());
      const selected = parsed && !/[\p{Cc}\u2028\u2029]/u.test(parsed[2].trim()) && options.find(option => option.id === parsed[1]);
      const said = parsed ? cleanLine(parsed[2], 60) : '';
      if (!selected) ctx.logs.push('模型未返回有效的动作 ID，没有创建步骤');
      else if (unsafeForumRaw(raw) || !safeRoomLine(said) || !meaningfulResult(said)) ctx.logs.push('模型建议未通过安全或内容校验，没有创建步骤');
      if (selected && !unsafeForumRaw(raw) && safeRoomLine(said) && meaningfulResult(said)) {
        action = selected;
        // Store and display the same trusted executable action. Do not let a
        // model's free-form wording change the action attached to the step.
        line = selected.label;
      }
    } catch {
      // A real failed request is not an AI-origin suggestion.
      ctx.logs.push('模型请求失败，没有创建步骤');
    }
  }

  if (ctx.signal?.aborted || !line) return { room: settleRoomUsage(room, ctx, now), calls: ctx.calls, logs: ctx.logs.length ? ctx.logs : ['这次未能生成下一步'] };
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
  let next = pushMessage(room, { ...personaMessage(persona, line, now), stepId: step.id }, now);
  next = spendVisible(next, ctx, now);
  next = { ...next, steps: [step, ...next.steps] };
  next = updateMind(next, persona.id, (p) => ({ ...p, mind: mindAfterReply(p, '你', now) }));
  return { room: settleRoomUsage(next, ctx, now), calls: ctx.calls, logs: ctx.logs };
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
  const ctx: Ctx = { config: input.config, calls: 0, logs: [], storagePermit: captureModelFence(),
    maxAttempts: budgetLeft(input.room, input.settings, now), signal: input.signal, reserveAttempt: input.reserveAttempt };
  let room = ensureUsage(cloneRoom(input.room), now);
  room = { ...room, cast: prepareCast(room.cast, now) };
  const elapsed = now - room.lastSeenAt;
  if (recentCrisis(room)) return { room: { ...room, lastSeenAt: now }, calls: 0, logs: ['当前内容需先处理危机支持'] };

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
    if (ctx.signal?.aborted || (!isMock(ctx.config) && ctx.calls >= ctx.maxAttempts)) break;
    const at = room.lastSeenAt + (elapsed * (i + 1)) / (wanted + 1);
    const speaker = pickSpeaker(room, '', at);
    if (!speaker) continue;
    const text = await generateLine(ctx, room, speaker, 'ambient', undefined, at);
    if (!text) continue;
    const message = personaMessage(speaker, text, at);
    room = {
      ...room,
      messages: [...room.messages, message].slice(-400),
      usage: spendVisible(room, ctx, now).usage,
    };
  }

  room = { ...room, lastSeenAt: now, lastMessageAt: now };
  return { room: settleRoomUsage(room, ctx, now), calls: ctx.calls, logs: ctx.logs };
}

/**
 * 换一批群友：旧房间进存档（只读），新房间只有你的人设、没有旧记录。
 * 你自己加的步骤留着——那是你的东西，不是他们的。
 */
export function rerollRoom(
  room: Room,
  playerName = '我',
  now = Date.now(),
): { room: Room; archived: Room } {
  const archived: Room = { ...cloneRoom(room), archivedAt: now };
  archived.messages = archived.messages.slice(-150);
  const next = newRoom(pickCast(4), now, playerName);
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
    // Usage belongs to today, not to the archived storyline.
    usage: { day: dayKey(now), messages: Math.max(usedToday(current, now), usedToday(target, now)) },
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
