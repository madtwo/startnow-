import type { Card, Identity, LlmConfig, Persona, Todo, World, WorldSettings } from '../types';
import { defaultConfig, isReady, PRESETS } from '../config/providers';
import { defaultPersonas } from './personas';
import { buildSeedCards } from './seed';
import { sanitizeMemoryText } from './memory';
import { findCrisis } from './safety';
import { hasCrisisInArchive, hasPlayerCrisis, isSafeMemoryEntry } from './submissionGuard';

const KEYS = {
  config: 'shudong.config.v1',
  cards: 'shudong.cards.v6',
  personas: 'shudong.personas.v3',
  world: 'shudong.world.v1',
  settings: 'shudong.settings.v1',
  todos: 'shudong.todos.v1',
  identity: 'shudong.identity.v2',
  identityLegacy: 'shudong.identity.v1',
};

const LEGACY_POST_KEYS = ['shudong.posts.v3', 'shudong.posts.v2', 'shudong.posts.v1'];
const LEGACY_CARD_KEYS = ['shudong.cards.v5', 'shudong.cards.v4', 'shudong.cards.v3', 'shudong.cards.v2', 'shudong.cards.v1'];
const UI_KEYS = ['startnow.onboarded', 'startnow.mode', 'startnow.homeTab'];

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
  aiCardLimit: 2,
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

const normalizeCard = (raw: Partial<Card>): Card | null => {
  if (!raw || typeof raw.text !== 'string' || hasPlayerCrisis(raw)) return null;
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    authorId: typeof raw.authorId === 'string' ? raw.authorId : 'me',
    authorName: typeof raw.authorName === 'string' ? raw.authorName : '我',
    authorKind:
      raw.authorKind === 'persona' ? 'persona' : raw.authorKind === 'helper' ? 'helper' : 'player',
    title: typeof raw.title === 'string' ? raw.title : undefined,
    image: typeof raw.image === 'string' && raw.image.startsWith('data:image/') ? raw.image : undefined,
    origin: raw.origin === 'model' || raw.origin === 'demo' || raw.origin === 'simulated' ? raw.origin : undefined,
    kind: raw.kind === 'brag' ? 'brag' : raw.kind === 'guide' ? 'guide' : 'worry',
    intro: raw.intro === true,
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    helperAt: typeof raw.helperAt === 'number' ? raw.helperAt : undefined,
    likedByMe: Boolean(raw.likedByMe),
    text: raw.text,
    createdAt,
    status: raw.status ?? 'stuck',
    arrivals: Array.isArray(raw.arrivals) ? raw.arrivals : [],
    plan: Array.isArray(raw.plan) ? raw.plan : [],
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    comments: Array.isArray(raw.comments)
      ? raw.comments.filter((row) => row && typeof row.text === 'string' &&
          typeof row.authorId === 'string' &&
          ['player', 'persona', 'helper'].includes(row.authorKind))
      : [],
    advice: raw.advice
      ? { ...raw.advice, text: raw.advice.text ?? '一个办法' }
      : undefined,
    note: raw.note
      ? { ...raw.note, text: raw.note.text ?? '一件小事' }
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
    return {
      ...base,
      ...found,
      memory: cleanStoredMemory(found.memory),
      weekLog: cleanWeekLog(found.weekLog),
      mind: cleanMind(found.mind),
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
    findCrisis(`${row.thought ?? ''} ${row.focus ?? ''} ${row.movedBy?.what ?? ''}`)) return undefined;
  return row as Persona['mind'];
};

export function loadPersonas(): Persona[] {
  const saved = read(KEYS.personas);
  if (!Array.isArray(saved) || !saved.length) return defaultPersonas();
  return mergePersonas(saved);
}

export const savePersonas = (personas: Persona[]) => write(KEYS.personas, personas.map((p) => ({
  ...p, memory: cleanStoredMemory(p.memory), weekLog: cleanWeekLog(p.weekLog), mind: cleanMind(p.mind),
})));

export function loadWorld(now = Date.now()): World {
  const saved = read(KEYS.world) as Partial<World> | null;
  if (!saved || typeof saved !== 'object') return emptyWorld(now);
  return {
    lastTickAt: typeof saved.lastTickAt === 'number' ? saved.lastTickAt : now,
    dayKey: typeof saved.dayKey === 'string' ? saved.dayKey : dayKey(now),
    callsToday: typeof saved.callsToday === 'number' ? saved.callsToday : 0,
    lastBragAt: typeof saved.lastBragAt === 'number' ? saved.lastBragAt : undefined,
    logs: Array.isArray(saved.logs) ? saved.logs.slice(0, 20) : [],
  };
}

export const saveWorld = (world: World) =>
  write(KEYS.world, { ...world, logs: world.logs.slice(0, 20) });

export function loadSettings(): WorldSettings {
  const saved = read(KEYS.settings) as Partial<WorldSettings> | null;
  if (!saved || typeof saved !== 'object') return { ...defaultSettings };
  return { ...defaultSettings, ...saved, paused: Boolean(saved.paused) };
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

export interface Bundle {
  version: 3;
  exportedAt: number;
  cards: Card[];
  personas: Persona[];
  world: World;
  settings: WorldSettings;
  identity: Identity;
  todos?: Todo[];
}

export function exportBundle(state: Omit<Bundle, 'version' | 'exportedAt'>): string {
  const bundle: Bundle = { version: 3, exportedAt: Date.now(), ...state };
  return JSON.stringify(bundle, null, 2);
}

export function importBundle(raw: string): Bundle | null {
  try {
    const data = JSON.parse(raw) as Partial<Bundle>;
    if (!data || data.version !== 3 || !Array.isArray(data.cards) || hasCrisisInArchive(data)) return null;
    return {
      version: 3,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : Date.now(),
      cards: retention(
        (data.cards as Partial<Card>[]).map(normalizeCard).filter((c): c is Card => Boolean(c)),
      ),
      personas:
        Array.isArray(data.personas) && data.personas.length
          ? mergePersonas(data.personas)
          : defaultPersonas(),
      world: data.world && typeof data.world === 'object' ? (data.world as World) : emptyWorld(),
      settings: data.settings
        ? { ...defaultSettings, ...(data.settings as Partial<WorldSettings>) }
        : { ...defaultSettings },
      identity: (data.identity as Identity) ?? loadIdentity(),
      todos: Array.isArray(data.todos) ? data.todos.filter((t) =>
        t && typeof t.text === 'string' && !findCrisis(t.text)).slice(0, 60) : [],
    };
  } catch {
    return null;
  }
}

export function clearAll() {
  [...Object.values(KEYS), ...LEGACY_POST_KEYS, ...LEGACY_CARD_KEYS, ...UI_KEYS].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // 忽略
    }
  });
}
