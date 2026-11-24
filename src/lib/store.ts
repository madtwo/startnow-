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
  RoomUsage,
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
import { OPENING_GATE_KEY, validPlayerIntroText } from './openingGate';
import { repairForumComments, repairForumPending, repairForumPlan } from './forumArchive';
import { registerModelFence } from './modelFence';

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
  roomUsage: 'shudong.roomusage.v1',
  goals: 'shudong.goals.v1',
  schedule: 'shudong.schedule.v1',
  summaries: 'shudong.summaries.v1',
};

const LEGACY_POST_KEYS = ['shudong.posts.v3', 'shudong.posts.v2', 'shudong.posts.v1'];
const LEGACY_CARD_KEYS = ['shudong.cards.v5', 'shudong.cards.v4', 'shudong.cards.v3', 'shudong.cards.v2', 'shudong.cards.v1'];
const UI_KEYS = ['startnow.onboarded', 'startnow.modeChosen', 'startnow.mode', 'startnow.homeTab', 'startnow.calendarView', 'shudong.decomposeDraft.v1', 'shudong.decomposeUsage.v1', 'startnow.lastCrisisAt', OPENING_GATE_KEY];
// Independent room.html stores, same origin; a user's full reset should include these.
const ROOM_KEYS = ['shudong.room.v1', 'shudong.archives.v1', 'shudong.roomsettings.v1'];

// Corrupt JSON must never be silently replaced by an empty default on mount.
// Keep the ORIGINAL bytes only in memory, so the owner can download a rescue
// copy before explicitly discarding that particular entry. No logs or network.
const corruptEntries = new Map<string, string>();
const failedStorageKeys = new Set<string>();
// A failed read is not a missing key. Keep the write barrier for the lifetime
// of this page; a later successful read cannot make an already mounted empty
// React snapshot authoritative. Reload or explicit destructive reset to recover.
const unreadableEntries = new Set<string>();
let storageReadOnly = false;
let clearIncomplete = false;
// A small non-private reset journal survives refresh. Retain the completed
// epoch so an old page cannot pass the guard merely because deletion finished.
// localStorage has no transaction/CAS: this is a pre-write fence, not an
// atomic cross-tab transaction. A racing writer can still interleave.
const RESET_KEY = 'shudong.reset.v1';
type ResetMarker = { epoch: string; pending: boolean };
let resetObservation: { storage: Storage; raw: string | null } | undefined;
function resetState(): { raw: string | null; pending: boolean; changed: boolean; readable: boolean } {
  try {
    const storage = localStorage;
    const raw = storage.getItem(RESET_KEY) ?? null;
    if (!resetObservation || resetObservation.storage !== storage) resetObservation = { storage, raw };
    const changed = resetObservation.raw !== raw;
    if (raw === null) return { raw, pending: false, changed, readable: true };
    try {
      const marker = JSON.parse(raw) as Partial<ResetMarker> | null;
      if (marker && typeof marker.epoch === 'string' && marker.epoch && typeof marker.pending === 'boolean') {
        return { raw, pending: marker.pending, changed, readable: true };
      }
    } catch { /* malformed marker: require explicit recovery */ }
    return { raw, pending: true, changed, readable: true };
  } catch { return { raw: null, pending: false, changed: false, readable: false }; }
}
type FenceReason = 'read-only' | 'unreadable' | 'reset-pending' | 'stale-epoch';
/** One source of truth for write/generation/recovery permission. */
export function storageFence(): { reason: FenceReason | null; raw: string | null; incomplete: boolean } {
  const state = resetState();
  const incomplete = clearIncomplete || !state.readable || state.pending;
  const reason = !state.readable ? 'unreadable' : incomplete ? 'reset-pending' :
    state.changed ? 'stale-epoch' : storageReadOnly ? 'read-only' : null;
  return { reason, raw: state.raw, incomplete };
}
function resetWriteBlocked(): boolean { return storageFence().reason !== null; }
/** A capability pinned before loading any component snapshot. A completed
 * same-page clear advances the marker but can never renew an old capability. */
export type StorageSession = Readonly<{ storage: Storage; raw: string | null }>;
export function captureStorageSession(): StorageSession | null {
  const fence = storageFence();
  if (fence.reason) return null;
  try { return Object.freeze({ storage: localStorage, raw: fence.raw }); } catch { return null; }
}
export function storageSessionCurrent(session: StorageSession | null): boolean {
  if (!session) return false;
  const fence = storageFence();
  try { return !fence.reason && session.storage === localStorage && session.raw === fence.raw; }
  catch { return false; }
}
registerModelFence(() => {
  const session = captureStorageSession();
  return () => storageSessionCurrent(session);
});
function persistResetMarker(marker: ResetMarker): string {
  const raw = JSON.stringify(marker);
  localStorage.setItem(RESET_KEY, raw);
  if (localStorage.getItem(RESET_KEY) !== raw) throw new Error('reset journal not persisted');
  resetObservation = { storage: localStorage, raw };
  return raw;
}
const ARRAY_KEYS = new Set([
  KEYS.cards, KEYS.personas, KEYS.todos, KEYS.archives, KEYS.goals,
  KEYS.schedule, KEYS.summaries, ...LEGACY_CARD_KEYS,
]);
const OBJECT_KEYS = new Set([
  KEYS.config, KEYS.world, KEYS.settings, KEYS.identity,
  KEYS.identityLegacy, KEYS.room, KEYS.roomSettings, KEYS.roomUsage,
]);

/** A second tab has newer data: block writes from this stale React tree. */
export const setStorageReadOnly = (value: boolean): void => { storageReadOnly = value; };
export const listCorruptStorageKeys = (): string[] => [...corruptEntries.keys()];
export const listFailedStorageKeys = (): string[] => [...failedStorageKeys];
const ROOM_DOMAIN_KEYS = [KEYS.room, KEYS.roomSettings, KEYS.roomUsage];
const roomDomainFailed = () => ROOM_DOMAIN_KEYS.some(key => corruptEntries.has(key) || unreadableEntries.has(key));
// Validate all related persisted domains on every write/authorization, even if
// the bad bytes appeared after the component mounted. Never treat unreadable
// or malformed data as a missing ledger. Recovery is explicit (discard/reload).
export function roomStorageBlocked(session?: StorageSession | null): boolean {
  if (resetWriteBlocked() || (session !== undefined && !storageSessionCurrent(session)) || roomDomainFailed()) return true;
  read(KEYS.room, raw => normalizeRoom(raw as Partial<Room>));
  read(KEYS.roomSettings, validateRoomSettings);
  loadRoomUsage();
  return roomDomainFailed() || resetWriteBlocked() || (session !== undefined && !storageSessionCurrent(session));
}
export const archiveStorageBlocked = (session?: StorageSession | null): boolean => roomStorageBlocked(session) ||
  corruptEntries.has(KEYS.archives) || unreadableEntries.has(KEYS.archives);
export const isClearIncomplete = (): boolean => storageFence().incomplete;
export const canWriteAppStorage = (): boolean => !resetWriteBlocked();
export const resetBlocksGeneration = (): boolean => resetWriteBlocked();

/** This backup can contain PRIVATE content or an API key; download locally only. */
export const exportCorruptStorage = (): string => JSON.stringify({
  format: 'startnow-corrupt-local-storage-v1',
  exportedAt: Date.now(),
  entries: [...corruptEntries].map(([key, raw]) => ({ key, raw })),
}, null, 2);

/** Explicit, surgical recovery: never delete a key changed by another tab. */
export function discardCorruptStorage(): { removed: string[]; failed: string[] } {
  if (storageReadOnly || resetWriteBlocked()) return { removed: [], failed: listCorruptStorageKeys() };
  const removed: string[] = [];
  const failed: string[] = [];
  for (const [key, raw] of corruptEntries) {
    try {
      if (localStorage.getItem(key) !== raw) { failed.push(key); continue; }
      localStorage.removeItem(key);
      corruptEntries.delete(key);
      failedStorageKeys.delete(key);
      unreadableEntries.delete(key);
      removed.push(key);
    } catch { failed.push(key); }
  }
  return { removed, failed };
}

const safeGetItem = (key: string): string | null => {
  // Pin the epoch before loading snapshots, not just when saving them.
  resetState();
  try { return localStorage.getItem(key); }
  catch {
    const first = !unreadableEntries.has(key);
    unreadableEntries.add(key); failedStorageKeys.add(key);
    if (first && storageErrorHandler) queueMicrotask(() => reportStorageFailure(key));
    return null;
  }
};

/** 旧 posts 格式不兼容：不在用户不知情的情况下静默迁移或丢弃。 */
export const listLegacyPostKeys = (): string[] => {
  try { return LEGACY_POST_KEYS.filter((key) => localStorage.getItem(key) !== null); }
  catch { return []; }
};
export const deleteLegacyPosts = (): void => {
  if (storageReadOnly || resetWriteBlocked()) return;
  LEGACY_POST_KEYS.forEach((key) => { try { localStorage.removeItem(key); } catch { /* 存储受限 */ } });
};

/** 加载老版本角色记忆时执行一次基础结构校验和脱敏。 */
export const cleanStoredMemory = (rows: unknown): Persona['memory'] =>
  Array.isArray(rows) ? rows.filter(isSafeMemoryEntry).map((entry) => ({
    ...entry, about: sanitizeMemoryText(entry.about), what: sanitizeMemoryText(entry.what),
  })) : [];
const DAY = 86_400_000;

const read = (key: string, validate?: (value: unknown) => unknown): unknown => {
  const raw = safeGetItem(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // JSON can be syntactically valid but impossible for this storage domain.
    // Quarantine only unequivocal shape errors; the normal loaders still
    // validate/migrate finer details of legitimate legacy objects.
    if ((ARRAY_KEYS.has(key) && !Array.isArray(parsed)) ||
        (OBJECT_KEYS.has(key) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))) {
      throw new SyntaxError('unexpected storage root shape');
    }
    if (validate) {
      const checked = validate(parsed);
      if (checked === null || checked === undefined) throw new SyntaxError('invalid domain archive');
      return checked;
    }
    return parsed;
  } catch {
    // Do not retain in console or analytics; an archive can include private data.
    if (!corruptEntries.has(key)) {
      corruptEntries.set(key, raw);
      if (storageErrorHandler) queueMicrotask(() => reportStorageFailure(key));
    }
    return null;
  }
};

type StorageErrorHandler = (key: string) => void;
let storageErrorHandler: StorageErrorHandler | null = null;

/** Surface quota/private-mode failures instead of silently losing local data. */
export const setStorageErrorHandler = (handler: StorageErrorHandler | null): void => {
  storageErrorHandler = handler;
};

function reportStorageFailure(key: string): void {
  failedStorageKeys.add(key);
  try { storageErrorHandler?.(key); } catch { /* warning handlers are non-fatal */ }
}

const writeChecked = (key: string, value: unknown): boolean => {
  // A write must not overwrite data we did not load or a newer reset epoch.
  if (storageReadOnly || corruptEntries.has(key)) return false;
  if (resetWriteBlocked() || unreadableEntries.has(key)) { reportStorageFailure(key); return false; }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    reportStorageFailure(key);
    return false;
  }
};
const write = (key: string, value: unknown): void => { writeChecked(key, value); };

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
  LEGACY_CARD_KEYS.some((key) => safeGetItem(key) !== null);

// `posts.v*` 是很早版本的帖子格式，当前没有兼容迁移；它不应挡住新版开场种子。
export const isFirstRun = () =>
  safeGetItem(KEYS.cards) === null && !hasLegacyCards();

export const needsUpgrade = () =>
  safeGetItem(KEYS.cards) === null && hasLegacyCards();

const retention = (cards: Card[], now = Date.now()) =>
  cards
    .filter((c) => now - c.createdAt < 14 * DAY)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);

const normalizeCard = (raw: Partial<Card>, allowedPersonas?: ReadonlySet<string>): Card | null => {
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
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt >= 0 ? raw.createdAt : Date.now();
  const text = stripAiProvenance(raw.text);
  const validComments = Array.isArray(raw.comments)
    ? raw.comments.filter((row) => row && typeof row.text === 'string' &&
        typeof row.authorId === 'string' &&
        ['player', 'persona', 'helper'].includes(row.authorKind) &&
        !(row.authorKind === 'persona' && isManipulative(row.text)))
      .map((row) => ({ ...row, growthReference: row.authorKind === 'persona' && row.growthReference === true }))
    : [];
  const { comments, ambiguousIds } = repairForumComments(validComments, createdAt);
  const playerIntro = raw.playerIntro === true && raw.authorKind === 'player' && raw.authorId === 'me' &&
    (raw.kind === 'worry' || raw.kind === undefined) && !raw.goalId && !raw.image &&
    !raw.material && !raw.intro && validPlayerIntroText(text);
  return {
    id: typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 128 ? raw.id : crypto.randomUUID(),
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
    // Imported flags cannot bypass onboarding or impersonate a player's intro.
    playerIntro,
    likes: typeof raw.likes === 'number' ? raw.likes : 0,
    helperAt: playerIntro ? undefined :
      typeof raw.helperAt === 'number' ? raw.helperAt : undefined,
    likedByMe: Boolean(raw.likedByMe),
    text,
    createdAt,
    // Preserve only plausible local activity markers backed by a real player
    // comment at the same timestamp; legacy imports without a marker expire
    // from creation time, even if a comment timestamp looks recent.
    lastPlayerActivityAt: Number.isFinite(raw.lastPlayerActivityAt) &&
      (raw.lastPlayerActivityAt as number) >= createdAt &&
      (raw.lastPlayerActivityAt as number) <= Date.now() &&
      comments.some(row => row.authorKind === 'player' && row.at === raw.lastPlayerActivityAt)
      ? raw.lastPlayerActivityAt : undefined,
    status: raw.status ?? 'stuck',
    arrivals: playerIntro ? [] : Array.isArray(raw.arrivals)
      ? [...new Set(raw.arrivals.filter((id): id is string => typeof id === 'string' &&
          id.length > 0 && id.length <= 128 && (!allowedPersonas || allowedPersonas.has(id))))] : [],
    plan: playerIntro ? [] : repairForumPlan(raw.plan, allowedPersonas),
    pending: playerIntro ? [] : repairForumPending(raw.pending, comments, ambiguousIds, allowedPersonas),
    comments,
    advice: rawAdvice && importMaterialAdviceValid
      ? { ...rawAdvice, text: typeof rawAdvice.text === 'string' ? rawAdvice.text : '一个办法' }
      : undefined,
    pendingBrag: playerIntro ? undefined : normalizePendingBrag(raw.pendingBrag, raw),
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
    noMemory: playerIntro || raw.noMemory === true,
  };
};

/** Only the earliest valid introduction is authoritative, even for an imported archive. */
export function normalizeCardRows(rows: readonly Partial<Card>[], personaIds?: readonly string[]): Card[] {
  const allowedPersonas = personaIds ? new Set(personaIds) : undefined;
  const parsed = rows.map(row => normalizeCard(row, allowedPersonas)).filter((card): card is Card => Boolean(card));
  const counts = new Map<string, number>();
  for (const card of parsed) counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  const ambiguous = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  const used = new Set(counts.keys());
  for (const card of parsed) {
    // Keep both conversations; an ambiguous card id must not route UI updates
    // into the first match or give a brag a fabricated source relationship.
    if (ambiguous.has(card.id)) {
      do { card.id = crypto.randomUUID(); } while (used.has(card.id));
      used.add(card.id);
    }
    if (card.sourceCardId && ambiguous.has(card.sourceCardId)) card.sourceCardId = undefined;
    if (card.bragCardId && ambiguous.has(card.bragCardId)) card.bragCardId = undefined;
  }
  const firstIntro = parsed.filter(card => card.playerIntro).sort((a, b) => a.createdAt - b.createdAt)[0];
  let found = false;
  return parsed.map(card => {
    if (!card.playerIntro) return card;
    if (card === firstIntro && !found) { found = true; return card; }
    return { ...card, playerIntro: undefined };
  });
}

export function loadCards(): Card[] {
  const saved = read(KEYS.cards);
  if (Array.isArray(saved)) {
    return retention(normalizeCardRows(saved, loadPersonas().map(persona => persona.id)));
  }
  // 旧版卡片：保留你自己开的卡，AI 的卡换成新种子
  const legacy =
    read('shudong.cards.v5') ??
    read('shudong.cards.v4') ??
    read('shudong.cards.v3') ??
    read('shudong.cards.v2') ??
    read('shudong.cards.v1');
  if (Array.isArray(legacy)) {
    const mine = normalizeCardRows(legacy, loadPersonas().map(persona => persona.id))
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
  // Never stamp a successful migration when the persona record is quarantined,
  // nor bypass the stale-tab write lock via a metadata-only localStorage call.
  if (storageReadOnly || resetWriteBlocked() || corruptEntries.has(KEYS.personas) ||
      corruptEntries.has(PERSONA_SCHEMA_KEY) || unreadableEntries.has(KEYS.personas) ||
      unreadableEntries.has(PERSONA_SCHEMA_KEY)) return;
  try {
    localStorage.setItem(PERSONA_SCHEMA_KEY, String(PERSONA_SCHEMA_VERSION));
  } catch {
    // A schema-marker write is still a failed persistence operation. Surface it
    // to the same persistent banner as all other local-storage failures.
    failedStorageKeys.add(PERSONA_SCHEMA_KEY);
    try { storageErrorHandler?.(PERSONA_SCHEMA_KEY); } catch { /* non-fatal warning */ }
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

const cleanAvatarUrl = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw.startsWith('data:image/') && raw.length <= 400_000 ? raw : undefined;

export function loadIdentity(): Identity {
  const saved = read(KEYS.identity) as Partial<Identity> | null;
  if (saved && typeof saved.id === 'string' && typeof saved.name === 'string') {
    return {
      id: saved.id,
      name: saved.name,
      avatarKey: typeof saved.avatarKey === 'string' ? saved.avatarKey : 'petal',
      avatarUrl: cleanAvatarUrl(saved.avatarUrl),
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

import { defaultRoomSettings } from './roomSettingsDefaults';
export { defaultRoomSettings };

function validateRoomSettings(raw: unknown): Partial<RoomSettings> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<RoomSettings>;
  if (value.liveliness !== undefined && (typeof value.liveliness !== 'number' || !Number.isFinite(value.liveliness) || value.liveliness < 0 || value.liveliness > 1)) return null;
  if (value.timeFlow !== undefined && typeof value.timeFlow !== 'boolean') return null;
  if (value.dailyMessages !== undefined && (typeof value.dailyMessages !== 'number' || !Number.isFinite(value.dailyMessages) || value.dailyMessages < 0)) return null;
  return value;
}
export function loadRoomSettings(): RoomSettings {
  const saved = read(KEYS.roomSettings, validateRoomSettings) as Partial<RoomSettings> | null;
  if (!saved) return { ...defaultRoomSettings, ...(corruptEntries.has(KEYS.roomSettings) || unreadableEntries.has(KEYS.roomSettings) ? { dailyMessages: 0 } : {}) };
  return {
    liveliness:
      typeof saved.liveliness === 'number' && Number.isFinite(saved.liveliness)
        ? Math.max(0, Math.min(1, saved.liveliness))
        : defaultRoomSettings.liveliness,
    timeFlow: saved.timeFlow === true,
    dailyMessages: saved.dailyMessages === undefined ? defaultRoomSettings.dailyMessages :
      typeof saved.dailyMessages === 'number' && Number.isFinite(saved.dailyMessages) && saved.dailyMessages >= 0
        ? Math.min(5000, Math.floor(saved.dailyMessages)) : 0,
  };
}

export function saveRoomSettings(settings: RoomSettings, session?: StorageSession | null): boolean {
  if (session !== undefined && !storageSessionCurrent(session)) return false;
  if (roomStorageBlocked(session) || !validateRoomSettings(settings)) { reportStorageFailure(KEYS.roomSettings); return false; }
  return writeChecked(KEYS.roomSettings, settings);
}

const roomString = (value: unknown): value is string => typeof value === 'string';
const roomNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const roomId = (value: unknown): value is string => roomString(value) && !!value.trim();
function validRoomPersona(value: unknown): value is Persona {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Persona>;
  return roomId(p.id) && roomId(p.name) && roomId(p.archetype ?? 'quiet') &&
    ['quiet','shy','rational','warm'].includes(p.archetype ?? 'quiet') &&
    [p.handle,p.tagline,p.background,p.voice,p.color,p.avatarKey,p.gender,p.school,p.major,
      p.cohort,p.personality,p.speech,p.approach].every(roomString) &&
    [p.age,p.intimacy,p.replyDesire,p.lastDistillAt].every(roomNumber) &&
    !!p.weights && typeof p.weights === 'object' &&
    ['study','people','love','family','self','future'].every(k => roomNumber(p.weights?.[k as keyof Persona['weights']])) &&
    Array.isArray(p.memory) && p.memory.every(isSafeMemoryEntry) &&
    Array.isArray(p.weekLog) && p.weekLog.every(row => row && roomNumber(row.at) && roomString(row.text)) &&
    (!p.awake || (Array.isArray(p.awake) && p.awake.length === 2 && p.awake.every(roomNumber))) &&
    (!p.peak || (Array.isArray(p.peak) && p.peak.length === 2 && p.peak.every(roomNumber))) &&
    (!p.pace || (Array.isArray(p.pace) && p.pace.length === 2 && p.pace.every(roomNumber))) &&
    (p.interests === undefined || (Array.isArray(p.interests) && p.interests.every(roomString))) &&
    (p.speechHabit === undefined || (Array.isArray(p.speechHabit) && p.speechHabit.every(roomString))) &&
    (p.situation === undefined || (!!p.situation && [p.situation.day,p.situation.agenda,p.situation.worry,p.situation.busyLabel].every(roomString) &&
      roomNumber(p.situation.busy) && Array.isArray(p.situation.knows) && p.situation.knows.every(roomString))) &&
    (p.relations === undefined || (!!p.relations && typeof p.relations === 'object' && !Array.isArray(p.relations) &&
      Object.values(p.relations).every(roomNumber))) &&
    (p.relationsAt === undefined || roomNumber(p.relationsAt)) &&
    (p.mind === undefined || (!!p.mind && ['calm','low','tense','warm','restless'].includes(p.mind.mood) &&
      roomString(p.mind.thought) && roomString(p.mind.focus) && roomNumber(p.mind.lastActAt) &&
      ['lurk','post','reply','brag','rest','step'].includes(p.mind.lastAct) &&
      (p.mind.movedBy === undefined || (!!p.mind.movedBy && roomString(p.mind.movedBy.by) &&
        roomString(p.mind.movedBy.what) && roomNumber(p.mind.movedBy.at)))));
}
const uniqueRoomIds = (rows: {id: string}[]) => new Set(rows.map(row => row.id)).size === rows.length;
const normalizeRoom = (raw: Partial<Room> | null): Room | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.messages) || !Array.isArray(raw.cast) || !raw.cast.length ||
      !raw.cast.every(validRoomPersona) || !uniqueRoomIds(raw.cast)) return null;
  if (!raw.messages.every(m => m && roomId(m.id) && roomId(m.authorId) && roomString(m.authorName) &&
      roomString(m.text) && roomNumber(m.at) && ['chat','system'].includes(m.kind) &&
      ['player','persona','system'].includes(m.authorKind) &&
      (m.mentions === undefined || (Array.isArray(m.mentions) && m.mentions.every(roomString))) &&
      (m.replyTo === undefined || roomId(m.replyTo)) && (m.stepId === undefined || roomId(m.stepId))) ||
      !uniqueRoomIds(raw.messages)) return null;
  if (raw.scheduled !== undefined && (!Array.isArray(raw.scheduled) || !raw.scheduled.every(s => s &&
      roomId(s.id) && roomId(s.personaId) && roomNumber(s.at) &&
      ['welcome','reply','peer','ambient','react','comfort','advise'].includes(s.intent) &&
      (s.replyTo === undefined || roomId(s.replyTo)) && (s.stepId === undefined || roomId(s.stepId))) || !uniqueRoomIds(raw.scheduled))) return null;
  if (raw.steps !== undefined && (!Array.isArray(raw.steps) || !raw.steps.every(s => s &&
      roomId(s.id) && roomString(s.text) && roomId(s.ownerId) && roomString(s.ownerName) &&
      roomNumber(s.createdAt) && ['ai','self','persona'].includes(s.origin) &&
      (s.dueAt === undefined || roomNumber(s.dueAt)) && (s.doneAt === undefined || roomNumber(s.doneAt))) ||
      !uniqueRoomIds(raw.steps))) return null;
  if (raw.gone !== undefined && (!Array.isArray(raw.gone) || !raw.gone.every(validRoomPersona))) return null;
  if (raw.usage !== undefined && (!raw.usage || !roomString(raw.usage.day) ||
      !Number.isSafeInteger(raw.usage.messages) || raw.usage.messages < 0)) return null;
  if ([raw.createdAt, raw.lastSeenAt, raw.lastMessageAt, raw.archivedAt].some(value => value !== undefined && !roomNumber(value))) return null;
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
    titleEdited: raw.titleEdited === true,
  };
};

function loadRoomUsage(): RoomUsage | null {
  return read(KEYS.roomUsage, raw => {
    const usage = raw as Partial<RoomUsage> | null;
    return usage && roomString(usage.day) && Number.isSafeInteger(usage.messages) && usage.messages! >= 0 ? usage : null;
  }) as RoomUsage | null;
}

/** Keep paid attempts independent of React mount/unmount and room archives. */
export function withRoomUsageFloor(room: Room, now = Date.now()): Room {
  const day = dayKey(now);
  const ledger = loadRoomUsage();
  const used = room.usage?.day === day ? room.usage.messages : 0;
  return ledger?.day === day && ledger.messages > used ? { ...room, usage: ledger } : room;
}

/** Reserve synchronously before each real POST. If storage is blocked, do
 * not send the paid request. Conservative: a reservation is not refunded
 * after a network error. Cross-tab atomicity remains a separate migration. */
export function reserveRoomRequest(room: Room, limit: number, now = Date.now(), session?: StorageSession | null): boolean {
  session = roomSession(room, session);
  if (roomStorageBlocked(session) || !Number.isFinite(limit) || limit <= 0) return false;
  const current = withRoomUsageFloor(room, now);
  if (roomStorageBlocked(session)) return false; // loading the ledger may quarantine it
  const day = dayKey(now);
  const used = current.usage?.day === day ? current.usage.messages : 0;
  if (!Number.isSafeInteger(used) || used < 0 || used >= Math.floor(limit)) return false;
  const next = { day, messages: used + 1 };
  if (!writeChecked(KEYS.roomUsage, next)) return false;
  if (safeGetItem(KEYS.roomUsage) !== JSON.stringify(next) || roomStorageBlocked(session)) {
    reportStorageFailure(KEYS.roomUsage);
    return false;
  }
  return true;
}

// Also remember loaded/saved room IDs for older callers of the domain API.
// The mounted UI always passes its explicit session, including for new IDs.
const roomSessionsByStorage = new WeakMap<Storage, Map<string, StorageSession | null>>();
function roomSessions(): Map<string, StorageSession | null> | null {
  try {
    const storage = localStorage;
    let sessions = roomSessionsByStorage.get(storage);
    if (!sessions) { sessions = new Map(); roomSessionsByStorage.set(storage, sessions); }
    return sessions;
  } catch { return null; }
}
function roomSession(room: Room, supplied?: StorageSession | null): StorageSession | null {
  const known = roomSessions()?.get(room.id);
  if (known !== undefined && !storageSessionCurrent(known)) return null;
  return supplied !== undefined ? supplied : known ?? captureStorageSession();
}
export function loadRoom(): Room | null {
  const session = captureStorageSession();
  const room = read(KEYS.room, raw => normalizeRoom(raw as Partial<Room>)) as Room | null;
  if (!room) return null;
  // Re-reading a room does not renew an earlier ID from a revoked epoch.
  const sessions = roomSessions();
  if (sessions && !sessions.has(room.id) && session) sessions.set(room.id, session);
  return withRoomUsageFloor(room);
}

export function saveRoom(room: Room, session?: StorageSession | null): boolean {
  session = roomSession(room, session);
  if (!storageSessionCurrent(session)) return false; // expected cleanup of a revoked session
  if (roomStorageBlocked(session) || !normalizeRoom(room)) { reportStorageFailure(KEYS.room); return false; }
  const next = withRoomUsageFloor(room);
  if (roomStorageBlocked(session)) { reportStorageFailure(KEYS.room); return false; }
  const ok = writeChecked(KEYS.room, next);
  if (ok) roomSessions()?.set(room.id, session);
  return ok;
}

export function loadArchives(): Room[] {
  return (read(KEYS.archives, raw => {
    if (!Array.isArray(raw) || raw.length > 8) return null;
    const normalized = raw.map(row => normalizeRoom(row as Partial<Room>));
    return normalized.every(row => row !== null) && uniqueRoomIds(normalized as Room[]) ? normalized : null;
  }) as Room[] | null) ?? [];
}

export function saveArchives(rooms: Room[], session?: StorageSession | null): boolean {
  // Validate the existing archive before replacing it; an unreadable archive
  // alone need not stop the active room, but must not be overwritten.
  if (session !== undefined && !storageSessionCurrent(session)) return false;
  loadArchives();
  if (archiveStorageBlocked(session) || !rooms.every(room => normalizeRoom(room)) || !uniqueRoomIds(rooms)) {
    reportStorageFailure(KEYS.archives); return false;
  }
  return writeChecked(KEYS.archives, rooms.slice(0, 8));
}

export const loadGoals = (): Goal[] => (read(KEYS.goals, parseGoals) as Goal[] | null) ?? [];
export const saveGoals = (goals: Goal[]): void => {
  const safe = parseGoals(goals);
  if (safe) write(KEYS.goals, safe);
  else reportStorageFailure(KEYS.goals);
};
export const loadSchedule = (): ScheduleItem[] => (read(KEYS.schedule, raw => parseSchedule(raw, loadGoals())) as ScheduleItem[] | null) ?? [];
export const saveSchedule = (items: ScheduleItem[]): void => {
  const safe = parseSchedule(items);
  if (safe) write(KEYS.schedule, safe);
  else reportStorageFailure(KEYS.schedule);
};
export const loadSummaries = (): DailySummary[] => (read(KEYS.summaries, parseSummaries) as DailySummary[] | null) ?? [];
export const saveSummaries = (items: DailySummary[]): void => {
  const safe = parseSummaries(items);
  if (safe) write(KEYS.summaries, safe);
  else reportStorageFailure(KEYS.summaries);
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
    avatarUrl: cleanAvatarUrl(row.avatarUrl),
    bio: typeof row.bio === 'string' && !findCrisis(row.bio) ? row.bio.slice(0, 200) : '',
  };
};

export function importBundle(raw: string): Bundle | null {
  try {
    const data = JSON.parse(raw) as Partial<Bundle>;
    if (!data || data.version !== 3 || !Array.isArray(data.cards) || hasCrisisInArchive(data)) return null;
    // 显式 null 与非法对象都整体拒绝，不能被“旧存档缺键”兼容规则吞掉。
    const goals = parseGoals(data.goals === undefined ? [] : data.goals);
    const schedule = parseSchedule(data.schedule === undefined ? [] : data.schedule, goals ?? undefined);
    const summaries = parseSummaries(data.summaries === undefined ? [] : data.summaries);
    if (!goals || !schedule || !summaries) return null;
    // 日程里的目标/步骤引用必须存在，防止伪造关联。
    const goalById = new Map(goals.map((goal) => [goal.id, goal]));
    const valid = schedule.every((item) => {
      const owner = item.goalId ? goalById.get(item.goalId) : undefined;
      if (item.goalId && (!owner || owner.ownerId !== item.ownerId)) return false;
      if (item.stepId && item.goalId && (!owner || !owner.steps.some((step) => step.id === item.stepId))) return false;
      return true;
    });
    if (!valid) return null;
    const personas = mergeImportedPersonaHistory(data.personas);
    return {
      version: 3,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : Date.now(),
      cards: retention(normalizeCardRows(data.cards as Partial<Card>[], personas.map(persona => persona.id))),
      personas,
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

export interface ClearAllResult { ok: boolean; removed: string[]; failed: string[]; }
export function clearAll(): ClearAllResult {
  const known = [...Object.values(KEYS), ...LEGACY_POST_KEYS, ...LEGACY_CARD_KEYS,
    ...UI_KEYS, ...ROOM_KEYS, PERSONA_SCHEMA_KEY];
  // Include app-owned keys introduced by legacy/auxiliary views. The journal
  // itself is deliberately retained, without private user content.
  let discovered: string[];
  try {
    discovered = Object.keys(localStorage).filter(key => key !== RESET_KEY &&
      (key.startsWith('shudong.') || key.startsWith('startnow.')));
  } catch {
    clearIncomplete = true;
    reportStorageFailure(RESET_KEY);
    return { ok: false, removed: [], failed: [RESET_KEY, ...new Set(known)] };
  }
  const keys = [...new Set([...known, ...discovered])];
  const state = resetState();
  if (storageReadOnly || state.changed) return { ok: false, removed: [], failed: keys };
  const removed: string[] = [], failed: string[] = [];
  // Persist the pending epoch BEFORE deleting anything. Failed or interrupted
  // clears stay blocked on refresh and can be explicitly retried.
  clearIncomplete = true;
  const epoch = crypto.randomUUID();
  let pending: string;
  try {
    if (!state.readable || localStorage.getItem(RESET_KEY) !== state.raw) throw new Error('reset epoch changed');
    pending = persistResetMarker({ epoch, pending: true });
  } catch {
    reportStorageFailure(RESET_KEY);
    return { ok: false, removed, failed: [RESET_KEY, ...keys] };
  }
  for (const key of keys) {
    try {
      if (localStorage.getItem(RESET_KEY) !== pending) throw new Error('reset epoch changed');
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) throw new Error('key remains');
      corruptEntries.delete(key);
      failedStorageKeys.delete(key);
      unreadableEntries.delete(key);
      removed.push(key);
    } catch {
      failed.push(key);
      reportStorageFailure(key);
    }
  }
  if (!failed.length) {
    try {
      if (localStorage.getItem(RESET_KEY) !== pending) throw new Error('reset epoch changed');
      persistResetMarker({ epoch, pending: false });
      failedStorageKeys.delete(RESET_KEY);
    } catch { failed.push(RESET_KEY); reportStorageFailure(RESET_KEY); }
  }
  clearIncomplete = failed.length > 0;
  return { ok: !clearIncomplete, removed, failed };
}
