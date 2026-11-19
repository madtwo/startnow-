import type {
  Card,
  DailySummary,
  Goal,
  Identity,
  LlmConfig,
  Message,
  Persona,
  Room,
  RoomSettings,
  ScheduleItem,
  Todo,
  World,
  WorldSettings,
} from '../types';
import { defaultConfig, isReady, PRESETS } from '../config/providers';
import { defaultPersonas } from './personas';
import { migratePersonaText, PERSONA_SCHEMA_KEY, PERSONA_SCHEMA_VERSION } from './personaMigration';
import { buildSeedCards } from './seed';
import { sanitizeMemoryText } from './memory';
import { findCrisis } from './safety';
import { normalizePendingBrag, unsafeBragContent } from './brag';
import { hasCrisisInArchive, hasPlayerCrisis, isSafeMemoryEntry } from './submissionGuard';
import { parseGoals, parseSchedule, parseSummaries } from './goalStorage';
import { parseMaterialExtraction, redactMaterialText } from './materialVision';
import { validateMaterialStep } from './materialAdvice';
import { isManipulative } from './agentVulnerability';
import { stripAiProvenance } from './displayText';

const KEYS = {
  config: 'shudong.config.v1',
  cards: 'shudong.cards.v6',
  personas: 'shudong.personas.v3',
  world: 'shudong.world.v1',
  settings: 'shudong.settings.v1',
  todos: 'shudong.todos.v1',
  identity: 'shudong.identity.v2',
  identityLegacy: 'shudong.identity.v1',
  room: 'shudong.room.v1',
  archives: 'shudong.archives.v1',
  roomSettings: 'shudong.roomsettings.v1',
  goals: 'shudong.goals.v1',
  schedule: 'shudong.schedule.v1',
  summaries: 'shudong.summaries.v1',
};

const LEGACY_POST_KEYS = ['shudong.posts.v3', 'shudong.posts.v2', 'shudong.posts.v1'];
const LEGACY_CARD_KEYS = ['shudong.cards.v5', 'shudong.cards.v4', 'shudong.cards.v3', 'shudong.cards.v2', 'shudong.cards.v1'];
const UI_KEYS = ['startnow.onboarded', 'startnow.mode', 'startnow.homeTab', 'startnow.calendarView', 'shudong.decomposeDraft.v1', 'shudong.decomposeUsage.v1', 'startnow.lastCrisisAt'];
// Independent room.html stores, same origin; a user's full reset should include these.
const ROOM_KEYS = ['shudong.room.v1', 'shudong.archives.v1', 'shudong.roomsettings.v1'];

/** 旧 posts 格式不兼容：不在用户不知情的情况下静默迁移或丢弃。 */
export const listLegacyPostKeys = (): string[] => {
  try { return LEGACY_POST_KEYS.filter((key) => localStorage.getItem(key) !== null); }
  catch { return []; }
};
export const deleteLegacyPosts = (): void => {
  LEGACY_POST_KEYS.forEach((key) => { try { localStorage.removeItem(key); } catch { /* 存储受限 */ } });
};

/** 加载老版本角色记忆时执行一次基础结构校验和脱敏。 */
export const cleanStoredMemory = (rows: unknown): Persona['memory'] =>
  Array.isArray(rows) ? rows.filter(isSafeMemoryEntry).map((entry) => ({
    ...entry, about: sanitizeMemoryText(entry.about), what: sanitizeMemoryText(entry.what),
  })) : [];
const DAY = 86_400_000;

const read = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式或空间不足时静默失败，不影响本次会话
  }
};

export const defaultSettings: WorldSettings = {
  paused: false,
  maxArrivals: 3,
  aiCardLimit: 8,
  dailyCalls: 60,
  maxCallsPerTick: 2,
  speed: 6,
  baselineExtra: '',
};

export const dayKey = (ts: number) => new Date(ts).toDateString();

export const emptyWorld = (now = Date.now()): World => ({
  lastTickAt: now,
  dayKey: dayKey(now),
  callsToday: 0,
  logs: [],
});

export function loadConfig(): LlmConfig {
  const saved = read(KEYS.config) as Partial<LlmConfig> | null;
  if (!saved || typeof saved !== 'object') return defaultConfig;
  const providerId = PRESETS.some((p) => p.id === saved.providerId)
    ? saved.providerId!
    : defaultConfig.providerId;
  const config: LlmConfig = {
    providerId,
    baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : defaultConfig.baseUrl,
    model: typeof saved.model === 'string' ? saved.model : defaultConfig.model,
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    fallbackModel:
      typeof saved.fallbackModel === 'string'
        ? saved.fallbackModel
        : PRESETS.find((p) => p.id === providerId)?.fallbackModel ?? '',
    visionModel: typeof saved.visionModel === 'string' ? saved.visionModel.slice(0, 200).trim() : '',
    // Measured 2026-11-19: single-call DS4.1 drops anchors to 19/25 and P95 to 44.6s;
    // keep the two-step flow as the safe default until a faster vision model is verified.
    captureMode: saved.captureMode === 'vision-template' || saved.captureMode === 'single' ? saved.captureMode : 'two-step',
  };
  return isReady(config) ? config : defaultConfig;
}

export const saveConfig = (config: LlmConfig) => write(KEYS.config, config);

const hasLegacyCards = () =>
  LEGACY_CARD_KEYS.some((key) => localStorage.getItem(key) !== null);

// `posts.v*` 是很早版本的帖子格式，当前没有兼容迁移；它不应挡住新版开场种子。
export const isFirstRun = () =>
  localStorage.getItem(KEYS.cards) === null && !hasLegacyCards();

export const needsUpgrade = () =>
  localStorage.getItem(KEYS.cards) === null && hasLegacyCards();

const retention = (cards: Card[], now = Date.now()) =>
  cards
    .filter((c) => now - c.createdAt < 14 * DAY)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);

const isTimedPersonaRow = (row: unknown): row is { personaId: string; at: number } =>
  Boolean(row) && typeof (row as { personaId?: unknown }).personaId === 'string' &&
  Number.isFinite((row as { at?: unknown }).at);

const normalizeCard = (raw: Partial<Card>): Card | null => {
  if (!raw || typeof raw.text !== 'string' || hasPlayerCrisis(raw) ||
      (raw.authorKind==='persona' && isManipulative(raw.text))) return null;
  const validImage = typeof raw.image==='string' &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw.image) && raw.image.length<=1_200_000;
  // An imported JSON object cannot add supposed visual evidence to a text-only
  // card or impersonate the player's image material.
  const material = validImage && raw.authorKind==='player' && raw.material && typeof raw.material === 'object'
    ? parseMaterialExtraction(JSON.stringify(raw.material)).extraction : undefined;
  const rawCapture=raw.materialCaptureStep;
  // Imported material suggestions are untrusted. Discard malformed / unanchored / PII-bearing steps.
  const captureValid=material && raw.authorKind==='player' && rawCapture &&
    typeof rawCapture==='object' && typeof rawCapture.text==='string' &&
    typeof rawCapture.anchorId==='string' && typeof rawCapture.personaId==='string' &&
    ['shenmo','weini','miaoze','yanggao'].includes(rawCapture.personaId) &&
    ['model','template'].includes(String(rawCapture.source)) &&
    redactMaterialText(rawCapture.text)===rawCapture.text &&
    (()=>{const checked=validateMaterialStep(rawCapture.text,material);
      return checked.ok && checked.anchorId===rawCapture.anchorId;})();
  const vulnerability = raw.vulnerability;
  const cleanVulnerability = raw.authorKind==='persona' && vulnerability &&
    ['misread','missed','lost'].includes(vulnerability.kind) &&
    vulnerability.personaId===raw.authorId && Number.isFinite(vulnerability.at)
      ? {kind:vulnerability.kind,personaId:vulnerability.personaId,at:vulnerability.at,
        comfortRequested:vulnerability.comfortRequested===true,
        resolvedAt:Number.isFinite(vulnerability.resolvedAt)?vulnerability.resolvedAt:undefined}
      : undefined;
  // Imported action provenance is untrusted: a forged 'material' label must
  // never bypass the same anchor/physical-action check as live generations.
  const rawAdvice = raw.advice && typeof raw.advice === 'object' ? raw.advice : undefined;
  const importMaterialAdviceValid = (() => {
    if (rawAdvice?.origin !== 'material') return true;
    if (!material || typeof rawAdvice.text !== 'string' || !rawAdvice.materialAnchorId) return false;
    const checked = validateMaterialStep(rawAdvice.text, material);
    return checked.ok && checked.anchorId === rawAdvice.materialAnchorId;
  })();
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    authorId: typeof raw.authorId === 'string' ? raw.authorId : 'me',
    authorName: typeof raw.authorName === 'string' ? raw.authorName : '我',
    authorKind:
      raw.authorKind === 'persona' ? 'persona' : raw.authorKind === 'helper' ? 'helper' : 'player',
    title: typeof raw.title === 'string' ? raw.title : undefined,
    image: validImage ? raw.image : undefined,
    material,
    materialCaptureStep: captureValid ? {
      text: rawCapture!.text, anchorId: rawCapture!.anchorId,
      source: rawCapture!.source, personaId: rawCapture!.personaId,
    } : undefined,
    materialAttemptAt: Number.isFinite(raw.materialAttemptAt) ? raw.materialAttemptAt : undefined,
    // A page refresh cancels an in-flight browser fetch. Never show an
    // eternally spinning recognition indicator after restoring its card.
    materialError: typeof raw.materialError==='string' &&
      /^(vision_unsupported|session_missing|auth|rate_limit|timeout|server|format_invalid|no_anchor|unsafe_output|invalid_image|cancelled|advice_invalid)$/.test(raw.materialError)
      ? raw.materialError : raw.materialAttemptAt && !material ? 'cancelled' : undefined,
    materialGoalId: material && typeof raw.materialGoalId==='string' && raw.materialGoalId.length<=128 ? raw.materialGoalId : undefined,
    deadlineConfirmedAt: Number.isFinite(raw.deadlineConfirmedAt)?raw.deadlineConfirmedAt:undefined,
    vulnerability: cleanVulnerability,
    goalReplyBackfillAt: Number.isFinite(raw.goalReplyBackfillAt) ? raw.goalReplyBackfillAt : undefined,
    origin: raw.origin === 'model' || raw.origin === 'demo' || raw.origin === 'simulated' ? raw.origin : undefined,
    kind: raw.kind === 'brag' ? 'brag' : raw.kind === 'life' ? 'life' : raw.kind === 'guide' ? 'guide' :
      raw.kind === 'goal' ? 'goal' : raw.kind === 'progress' ? 'progress' : 'worry',
    goalId: typeof raw.goalId === 'string' && raw.goalId.length <= 128 ? raw.goalId : undefined,
    cheerCount: Number.isInteger(raw.cheerCount) && (raw.cheerCount as number) >= 0 && (raw.cheerCount as number) <= 100000 ? raw.cheerCount : 0,
    cheeredByMe: raw.cheeredByMe === true,
    intro: raw.intro === true,
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    helperAt: typeof raw.helperAt === 'number' ? raw.helperAt : undefined,
    likedByMe: Boolean(raw.likedByMe),
    text: stripAiProvenance(raw.text),
    createdAt,
    status: raw.status ?? 'stuck',
    arrivals: Array.isArray(raw.arrivals) ? raw.arrivals.filter((id): id is string => typeof id === 'string') : [],
    plan: Array.isArray(raw.plan) ? raw.plan.filter(isTimedPersonaRow) : [],
    pending: Array.isArray(raw.pending) ? raw.pending.filter(isTimedPersonaRow) : [],
    comments: Array.isArray(raw.comments)
      ? raw.comments.filter((row) => row && typeof row.text === 'string' &&
          typeof row.authorId === 'string' &&
          ['player', 'persona', 'helper'].includes(row.authorKind) &&
          !(row.authorKind==='persona' && isManipulative(row.text)))
        .map((row) => ({...row,growthReference:row.authorKind==='persona' && row.growthReference===true}))
      : [],
    advice: rawAdvice && importMaterialAdviceValid
      ? { ...rawAdvice, text: typeof rawAdvice.text === 'string' ? rawAdvice.text : '一个办法' }
      : undefined,
    pendingBrag: normalizePendingBrag(raw.pendingBrag, raw),
    sourceCardId: typeof raw.sourceCardId === 'string' && raw.sourceCardId.length <= 128 ? raw.sourceCardId : undefined,
    sourceCommentId: typeof raw.sourceCommentId === 'string' && raw.sourceCommentId.length <= 128 ? raw.sourceCommentId : undefined,
    sourceAdviceText: typeof raw.sourceAdviceText === 'string' && raw.sourceAdviceText.length <= 600 &&
      !unsafeBragContent(raw.sourceAdviceText) ? raw.sourceAdviceText : undefined,
    bragCardId: typeof raw.bragCardId === 'string' && raw.bragCardId.length <= 128 ? raw.bragCardId : undefined,
    note: raw.note && typeof raw.note === 'object'
      ? { ...raw.note, text: typeof raw.note.text === 'string' ? raw.note.text : '一件小事' }
      : undefined,
    doneAt: typeof raw.doneAt === 'number' ? raw.doneAt : undefined,
    seenAt: typeof raw.seenAt === 'number' ? raw.seenAt : undefined,
    readAt: typeof raw.readAt === 'number' ? raw.readAt : undefined,
    handledAt: typeof raw.handledAt === 'number' ? raw.handledAt : undefined,
    refused: typeof raw.refused === 'number' ? raw.refused : undefined,
    topic: typeof raw.topic === 'string' ? raw.topic : undefined,
    noMemory: raw.noMemory === true,
  };
};

export function loadCards(): Card[] {
  const saved = read(KEYS.cards);
  if (Array.isArray(saved)) {
    return retention(saved.map(normalizeCard).filter((c): c is Card => Boolean(c)));
  }
  // 旧版卡片：保留你自己开的卡，AI 的卡换成新种子
  const legacy =
    read('shudong.cards.v5') ??
    read('shudong.cards.v4') ??
    read('shudong.cards.v3') ??
    read('shudong.cards.v2') ??
    read('shudong.cards.v1');
  if (Array.isArray(legacy)) {
    const mine = legacy
      .map(normalizeCard)
      .filter((c): c is Card => Boolean(c))
      .filter((c) => c.authorId === 'me');
    return retention([...mine, ...buildSeedCards()]);
  }
  return [];
}

export const saveCards = (cards: Card[]) => write(KEYS.cards, retention(cards.filter((c) => !hasPlayerCrisis(c))));

function mergePersonas(rows: unknown[]): Persona[] {
  const defaults = defaultPersonas();
  const merged = defaults.map((base) => {
    const found = rows.find((p) => p && (p as Persona).id === base.id) as
      | Partial<Persona>
      | undefined;
    if (!found) return base;
    const savedBackground = typeof found.background === 'string' ? found.background : base.background;
    const background = base.id === 'weini'
      ? savedBackground.replace('专业暂未定', '金融学专业')
      : base.id === 'yanggao'
        ? savedBackground.replace(/^临南学院大一/u, '临南学院风景园林学大一')
        : savedBackground;
    return {
      ...base,
      ...found,
      background,
      major: typeof found.major === 'string' && found.major.trim() ? found.major : base.major,
      memory: cleanStoredMemory(found.memory),
      weekLog: cleanWeekLog(found.weekLog),
      mind: cleanMind(found.mind),
      // 旧默认是截断；现在统一为摘要压缩，避免上下文到顶后只剩硬截断。
      memoryMode: 'summary',
      weights: found.weights ?? base.weights,
      intimacy: typeof found.intimacy === 'number' ? found.intimacy : base.intimacy,
    } as Persona;
  });
  const extra = rows
    .filter((p) => p && typeof (p as Persona).id === 'string')
    .filter((p) => (p as Persona).id.startsWith('custom-'))
    .filter((p) => !defaults.some((d) => d.id === (p as Persona).id))
    .slice(0, 2)
    .map((p) => {
      const row = p as Partial<Persona>;
      const fallback = defaults[0];
      return {
        ...fallback,
        ...row,
        id: row.id as string,
        name: row.name ?? '新同伴',
        background: row.background ?? '',
        voice: row.voice ?? '',
        weights: row.weights ?? fallback.weights,
        intimacy: typeof row.intimacy === 'number' ? row.intimacy : 10,
        followUp: row.followUp ?? 'sometimes',
        memory: cleanStoredMemory(row.memory),
        weekLog: cleanWeekLog(row.weekLog),
        mind: cleanMind(row.mind),
      } as Persona;
    });
  return [...merged, ...extra];
}

const cleanWeekLog = (rows: unknown): Persona['weekLog'] =>
  Array.isArray(rows) ? rows.filter((row) => row && typeof row.at === 'number' &&
    typeof row.text === 'string' && !findCrisis(row.text)).slice(-8).map((row) => ({
      at: row.at, text: sanitizeMemoryText(row.text),
    })) : [];

const cleanMind = (mind: unknown): Persona['mind'] => {
  if (!mind || typeof mind !== 'object') return undefined;
  const row = mind as Partial<NonNullable<Persona['mind']>>;
  if (['thought', 'focus'].some((key) => typeof row[key as 'thought' | 'focus'] !== 'string') ||
    findCrisis(`${row.thought ?? ''} ${row.focus ?? ''} ${row.movedBy?.what ?? ''} ${row.movedBy?.by ?? ''}`)) return undefined;
  const movedBy = row.movedBy && typeof row.movedBy.what === 'string' && typeof row.movedBy.by === 'string' &&
    Number.isFinite(row.movedBy.at)
    ? { by: sanitizeMemoryText(row.movedBy.by).slice(0, 40), what: sanitizeMemoryText(row.movedBy.what).slice(0, 60), at: row.movedBy.at }
    : undefined;
  return {
    ...row,
    thought: sanitizeMemoryText(row.thought as string).slice(0, 120),
    focus: sanitizeMemoryText(row.focus as string).slice(0, 80),
    movedBy,
  } as Persona['mind'];
};

/** Imported stories may supply history, but never privileged role definitions.
 * The code-shipped persona is the only source of system-prompt identity/rules.
 * This also excludes untrusted custom-* characters from a foreign archive.
 */
export function mergeImportedPersonaHistory(rows: unknown): Persona[] {
  const incoming = Array.isArray(rows) ? rows : [];
  return defaultPersonas().map((base) => {
    const item = incoming.find((row) => row && typeof row === 'object' &&
      (row as { id?: unknown }).id === base.id) as Partial<Persona> | undefined;
    if (!item) return base;
    return {
      ...base,
      memory: cleanStoredMemory(item.memory),
      weekLog: cleanWeekLog(item.weekLog),
      mind: cleanMind(item.mind),
      intimacy: bound(item.intimacy, 0, 100, base.intimacy),
      lastDistillAt: typeof item.lastDistillAt === 'number' && Number.isFinite(item.lastDistillAt)
        ? Math.max(0, item.lastDistillAt) : base.lastDistillAt,
    };
  });
}

const markPersonaSchema = () => {
  try {
    localStorage.setItem(PERSONA_SCHEMA_KEY, String(PERSONA_SCHEMA_VERSION));
  } catch {
    // 隐私模式：本次会话仍用迁移后的内存数据。
  }
};

export function loadPersonas(): Persona[] {
  const saved = read(KEYS.personas);
  if (!Array.isArray(saved) || !saved.length) {
    markPersonaSchema();
    return defaultPersonas();
  }
  // 只替换仍等于旧版内置文案的字段；手改过的文本和记忆原样保留。
  const migrated = migratePersonaText(saved as { id?: string }[], defaultPersonas());
  if (migrated.changed) write(KEYS.personas, migrated.rows);
  markPersonaSchema();
  return mergePersonas(migrated.rows);
}

export const savePersonas = (personas: Persona[]) => write(KEYS.personas, personas.map((p) => ({
  ...p, memory: cleanStoredMemory(p.memory), weekLog: cleanWeekLog(p.weekLog), mind: cleanMind(p.mind),
})));

export function loadWorld(now = Date.now()): World {
  return cleanWorld(read(KEYS.world), now);
}

function cleanWorld(raw: unknown, now = Date.now()): World {
  if (!raw || typeof raw !== 'object') return emptyWorld(now);
  const saved = raw as Partial<World>;
  const today = dayKey(now);
  // 跨天后计数归零，避免界面显示昨天的调用数。
  const sameDay = saved.dayKey === today;
  return {
    lastTickAt: Number.isFinite(saved.lastTickAt) ? Math.min(saved.lastTickAt as number, now) : now,
    dayKey: today,
    callsToday: sameDay && Number.isFinite(saved.callsToday) ? Math.max(0, saved.callsToday as number) : 0,
    lastBragAt: Number.isFinite(saved.lastBragAt) ? saved.lastBragAt : undefined,
    logs: Array.isArray(saved.logs)
      ? saved.logs.filter((row): row is string => typeof row === 'string' && !findCrisis(row)).slice(0, 20)
      : [],
  };
}

export const saveWorld = (world: World) =>
  write(KEYS.world, { ...world, logs: world.logs.slice(0, 20) });

const bound = (value: unknown, low: number, high: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value as number))) : fallback;

function cleanSettings(raw: unknown): WorldSettings {
  if (!raw || typeof raw !== 'object') return { ...defaultSettings };
  const saved = raw as Partial<WorldSettings>;
  const d = defaultSettings;
  return {
    paused: Boolean(saved.paused),
    maxArrivals: bound(saved.maxArrivals, 1, 4, d.maxArrivals),
    aiCardLimit: bound(saved.aiCardLimit, 0, 8, d.aiCardLimit),
    dailyCalls: bound(saved.dailyCalls, 0, 2000, d.dailyCalls),
    maxCallsPerTick: bound(saved.maxCallsPerTick, 0, 10, d.maxCallsPerTick),
    speed: bound(saved.speed, 1, 30, d.speed),
    baselineExtra: typeof saved.baselineExtra === 'string' ? saved.baselineExtra.slice(0, 2000) : d.baselineExtra,
  };
}

export function loadSettings(): WorldSettings {
  return cleanSettings(read(KEYS.settings));
}

export const saveSettings = (settings: WorldSettings) => write(KEYS.settings, settings);

export function loadTodos(): Todo[] {
  const saved = read(KEYS.todos);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((t): t is Todo => Boolean(t) && typeof t.text === 'string' && !findCrisis(t.text))
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);
}

export const saveTodos = (todos: Todo[]) => write(KEYS.todos, todos.filter((t) => !findCrisis(t.text)).slice(0, 60));

export function loadIdentity(): Identity {
  const saved = read(KEYS.identity) as Partial<Identity> | null;
  if (saved && typeof saved.id === 'string' && typeof saved.name === 'string') {
    return {
      id: saved.id,
      name: saved.name,
      avatarKey: typeof saved.avatarKey === 'string' ? saved.avatarKey : 'petal',
      bio: typeof saved.bio === 'string' ? saved.bio : '',
    };
  }
  const legacy = read(KEYS.identityLegacy) as Partial<Identity> | null;
  const identity: Identity = {
    id: typeof legacy?.id === 'string' ? legacy.id : crypto.randomUUID(),
    name:
      typeof legacy?.name === 'string' ? legacy.name : `匿名 · ${Math.floor(100 + Math.random() * 900)}`,
    avatarKey: 'petal',
    bio: '',
  };
  write(KEYS.identity, identity);
  return identity;
}

export const saveIdentity = (identity: Identity) => write(KEYS.identity, identity);

/* ------------------------------------------------------------------ *
 * 群聊
 * ------------------------------------------------------------------ */

export const defaultRoomSettings: RoomSettings = {
  liveliness: 0.5,
  timeFlow: false,
  dailyMessages: 400,
};

export function loadRoomSettings(): RoomSettings {
  const saved = read(KEYS.roomSettings) as Partial<RoomSettings> | null;
  if (!saved || typeof saved !== 'object') return { ...defaultRoomSettings };
  return {
    liveliness:
      typeof saved.liveliness === 'number' && Number.isFinite(saved.liveliness)
        ? Math.max(0, Math.min(1, saved.liveliness))
        : defaultRoomSettings.liveliness,
    timeFlow: saved.timeFlow === true,
    dailyMessages:
      typeof saved.dailyMessages === 'number' && saved.dailyMessages > 0
        ? Math.round(saved.dailyMessages)
        : defaultRoomSettings.dailyMessages,
  };
}

export const saveRoomSettings = (settings: RoomSettings) => write(KEYS.roomSettings, settings);

const normalizeRoom = (raw: Partial<Room> | null): Room | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.messages) || !Array.isArray(raw.cast) || !raw.cast.length) return null;
  const now = Date.now();
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title : '群聊',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    messages: (raw.messages as Message[]).filter((m) => m && typeof m.text === 'string'),
    scheduled: Array.isArray(raw.scheduled) ? raw.scheduled : [],
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    cast: raw.cast as Persona[],
    gone: Array.isArray(raw.gone) ? raw.gone : [],
    lastSeenAt: typeof raw.lastSeenAt === 'number' ? raw.lastSeenAt : now,
    lastMessageAt: typeof raw.lastMessageAt === 'number' ? raw.lastMessageAt : now,
    usage:
      raw.usage && typeof raw.usage === 'object'
        ? { day: String(raw.usage.day ?? dayKey(now)), messages: Number(raw.usage.messages) || 0 }
        : { day: dayKey(now), messages: 0 },
    archivedAt: typeof raw.archivedAt === 'number' ? raw.archivedAt : undefined,
  };
};

export function loadRoom(): Room | null {
  return normalizeRoom(read(KEYS.room) as Partial<Room> | null);
}

export const saveRoom = (room: Room) => write(KEYS.room, room);

export function loadArchives(): Room[] {
  const raw = read(KEYS.archives);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => normalizeRoom(row as Partial<Room>))
    .filter((row): row is Room => Boolean(row))
    .slice(0, 8);
}

export const saveArchives = (rooms: Room[]) => write(KEYS.archives, rooms.slice(0, 8));

export const loadGoals = (): Goal[] => parseGoals(read(KEYS.goals)) ?? [];
export const saveGoals = (goals: Goal[]): void => {
  const safe = parseGoals(goals);
  if (safe) write(KEYS.goals, safe);
};
export const loadSchedule = (): ScheduleItem[] => parseSchedule(read(KEYS.schedule)) ?? [];
export const saveSchedule = (items: ScheduleItem[]): void => {
  const safe = parseSchedule(items);
  if (safe) write(KEYS.schedule, safe);
};
export const loadSummaries = (): DailySummary[] => parseSummaries(read(KEYS.summaries)) ?? [];
export const saveSummaries = (items: DailySummary[]): void => {
  const safe = parseSummaries(items);
  if (safe) write(KEYS.summaries, safe);
};

export interface Bundle {
  version: 3;
  exportedAt: number;
  cards: Card[];
  personas: Persona[];
  world: World;
  settings: WorldSettings;
  identity: Identity;
  todos?: Todo[];
  goals?: Goal[];
  schedule?: ScheduleItem[];
  summaries?: DailySummary[];
}

export function exportBundle(state: Omit<Bundle, 'version' | 'exportedAt'>): string {
  const bundle: Bundle = { version: 3, exportedAt: Date.now(), ...state };
  return JSON.stringify(bundle, null, 2);
}

const cleanIdentity = (raw: unknown): Identity | null => {
  const row = raw as Partial<Identity> | null;
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.name !== 'string' ||
    !row.id || row.id.length > 128 || !row.name.trim() || findCrisis(row.name)) return null;
  return {
    id: row.id,
    name: row.name.slice(0, 40),
    avatarKey: typeof row.avatarKey === 'string' && row.avatarKey.length <= 40 ? row.avatarKey : 'petal',
    bio: typeof row.bio === 'string' && !findCrisis(row.bio) ? row.bio.slice(0, 200) : '',
  };
};

export function importBundle(raw: string): Bundle | null {
  try {
    const data = JSON.parse(raw) as Partial<Bundle>;
    if (!data || data.version !== 3 || !Array.isArray(data.cards) || hasCrisisInArchive(data)) return null;
    // 显式 null 与非法对象都整体拒绝，不能被“旧存档缺键”兼容规则吞掉。
    const goals = parseGoals(data.goals === undefined ? [] : data.goals);
    const schedule = parseSchedule(data.schedule === undefined ? [] : data.schedule);
    const summaries = parseSummaries(data.summaries === undefined ? [] : data.summaries);
    if (!goals || !schedule || !summaries) return null;
    // 日程里的目标/步骤引用必须存在，防止伪造关联。
    const goalById = new Map(goals.map((goal) => [goal.id, goal]));
    const valid = schedule.every((item) => {
      if (item.goalId && !goalById.has(item.goalId)) return false;
      if (item.stepId) {
        const owner = item.goalId ? goalById.get(item.goalId) : goals.find((goal) => goal.steps.some((step) => step.id === item.stepId));
        if (!owner || !owner.steps.some((step) => step.id === item.stepId)) return false;
      }
      return true;
    });
    if (!valid) return null;
    return {
      version: 3,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : Date.now(),
      cards: retention(
        (data.cards as Partial<Card>[]).map(normalizeCard).filter((c): c is Card => Boolean(c)),
      ),
      personas: mergeImportedPersonaHistory(data.personas),
      // 调用计数属于本设备的当日预算，导入存档不能把它清零或改写。
      world: { ...cleanWorld(data.world), dayKey: loadWorld().dayKey, callsToday: loadWorld().callsToday },
      settings: {
        ...cleanSettings(data.settings),
        // Imported JSON is data, never a source of higher-priority system rules
        // or permission to resume paid background calls on this device.
        baselineExtra: loadSettings().baselineExtra,
        paused: loadSettings().paused,
        dailyCalls: loadSettings().dailyCalls,
      },
      identity: cleanIdentity(data.identity) ?? loadIdentity(),
      todos: Array.isArray(data.todos) ? data.todos.filter((t) =>
        t && typeof t.text === 'string' && !findCrisis(t.text)).slice(0, 60) : [],
      goals,
      schedule,
      summaries,
    };
  } catch {
    return null;
  }
}

export function clearAll() {
  [...Object.values(KEYS), ...LEGACY_POST_KEYS, ...LEGACY_CARD_KEYS, ...UI_KEYS, ...ROOM_KEYS].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略
    }
  });
}
