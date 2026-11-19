export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'moonshot'
  | 'zhipu'
  | 'opencode'
  | 'opencode-go'
  | 'compatible'
  | 'mock';

export interface LlmConfig {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  fallbackModel?: string;
  /** Explicit opt-in vision model sharing the configured API endpoint and key. */
  visionModel?: string;
  /** Single image+step request (default); two-step remains as a compatible fallback. */
  /** Two-step is production default; vision-template and single are opt-in experiments. */
  captureMode?: 'two-step' | 'vision-template' | 'single';
}

export type Gender = 'female' | 'male' | 'none';

/** 台词、心智、选人统统按原型取，不按人名取；换一批群友时这些内容还能复用。 */
export type Archetype = 'quiet' | 'shy' | 'rational' | 'warm';
export type MemoryWeight = 'light' | 'deep';
export type MemoryMode = 'trim' | 'summary';
export type TroubleKind = 'study' | 'people' | 'love' | 'family' | 'self' | 'future';

export interface MemoryEntry {
  id: string;
  at: number;
  about: string;
  what: string;
  weight: MemoryWeight;
  postId: string;
  merged?: boolean;
}

export interface WeekFact {
  at: number;
  text: string;
}

export type Mood = 'calm' | 'low' | 'tense' | 'warm' | 'restless';

export interface PersonaMind {
  mood: Mood;
  thought: string;
  focus: string;
  lastAct: 'lurk' | 'post' | 'reply' | 'brag' | 'rest' | 'step';
  lastActAt: number;
  movedBy?: { by: string; what: string; at: number };
}

export interface Persona {
  id: string;
  archetype?: Archetype;
  name: string;
  handle: string;
  tagline: string;
  background: string;
  /** 这学期在学业/科研上具体卡在哪；公开帖子以它为主，生活线只做背景。 */
  academicFocus?: string;
  voice: string;
  color: string;
  avatarKey: string;
  gender: Gender;
  age: number;
  school: string;
  major: string;
  cohort: string;
  /** 自我介绍里会写出来；只影响表达方式，不主动拿它贴标签。 */
  mbti?: string;
  personality: string;
  speech: string;
  approach: string;
  weights: Record<TroubleKind, number>;
  followUp: 'rare' | 'sometimes' | 'often';
  intimacy: number;
  shareBoost?: number;
  replyDesire: number;
  memoryMode: MemoryMode;
  memory: MemoryEntry[];
  lastDistillAt: number;
  weekLog: WeekFact[];
  mind?: PersonaMind;
}

export interface Identity {
  id: string;
  name: string;
  avatarKey: string;
  bio: string;
}

import type { MaterialExtraction } from './lib/materialVision';

export type CardStatus = 'stuck' | 'arrived' | 'talking' | 'advised' | 'noted' | 'done' | 'handled';

export interface Comment {
  id: string;
  authorId: string;
  authorKind: 'player' | 'persona' | 'helper';
  text: string;
  at: number;
  kind?: 'comment' | 'advice';
  peer?: string;
  replyTo?: string;
  /** A proposed smaller action, not automatically adopted. */
  shrinkDepth?: number;
  parentAdviceSource?: string;
  // 不给本地生成或审查回退的台词伪装成真实模型输出。
  origin?: 'model' | 'demo' | 'boundary' | 'curated' | 'simulated' | 'system' | 'material';
  /** Stable ID for local curated action copy; never set for model prose. */
  actionId?: string;
  /** Source-backed once-per-week acknowledgment of a player's suggestion. */
  growthReference?: boolean;
  /** Non-sensitive reason code for a simulated completion reaction, if applicable. */
  fallbackReason?: 'demo' | 'unsafe_anchor' | 'reasoning_budget' | 'empty_body' | 'truncated' | 'invalid_action' | 'timeout' | 'rate_limit' | 'network' | 'model_error';
}

export interface Advice {
  text: string;
  actionId?: string;
  fromPersonaId: string;
  at: number;
  accepted: boolean;
  /** Links a user-selected action back to the original persona comment. */
  sourceCommentId?: string;
  /** Depth of accepted smaller suggestions (not a failure count). */
  shrinkDepth?: number;
  parentAdviceSource?: string;
  origin?: 'curated' | 'demo' | 'adopted' | 'material';
  materialAnchorId?: string;
  materialSource?: 'model' | 'template';
}

export interface Note {
  text: string;
  actionId?: string;
  /** Optional provenance kept when an adopted reply is pinned. */
  sourceCommentId?: string;
  fromPersonaId: string;
  at: number;
  dueAt: number;
  materialAnchorId?: string;
}

export interface PlannedArrival {
  personaId: string;
  at: number;
  attempt?: number;
}

export interface PendingReply {
  personaId: string;
  at: number;
  attempt?: number;
  phase: 'reply' | 'reaction' | 'decide';
  sourceCommentId?: string; // 精确关联触发此次待回复的玩家评论，旧存档可为空。
}

/** A durable job stored on the original persona worry, not a Comment. */
export interface PendingBrag {
  personaId: string;
  acceptedAt: number;
  dueAt: number;
  adviceText: string;
  actionId?: string;
  sourceCommentId?: string;
}

export interface Todo {
  id: string;
  text: string;
  at: number;
  doneAt?: number;
}

export interface Card {
  id: string;
  authorId: string;
  authorName: string;
  authorKind: 'player' | 'persona' | 'helper';
  title?: string;
  kind?: 'worry' | 'brag' | 'life' | 'guide' | 'goal' | 'progress';
  goalId?: string;
  cheerCount?: number;
  cheeredByMe?: boolean;
  intro?: boolean;
  origin?: 'model' | 'demo' | 'simulated';
  likes?: number;
  helperAt?: number;
  likedByMe?: boolean;
  text: string;
  weight?: 1 | 2 | 3;
  image?: string;
  /** Redacted, user-visible material extraction only; the image is never logged. */
  material?: MaterialExtraction;
  /** A validated first step returned by single multimodal capture. Never trust imports without revalidation. */
  materialCaptureStep?: {text: string; anchorId: string; source: 'model' | 'template'; personaId: string};
  materialAttemptAt?: number;
  materialError?: string;
  materialGoalId?: string;
  deadlineConfirmedAt?: number;
  vulnerability?: {kind: 'misread' | 'missed' | 'lost'; personaId: string; at: number; comfortRequested?: boolean; resolvedAt?: number};
  /** One-time repair marker for old goal-card comments that lost their reply queue. */
  goalReplyBackfillAt?: number;
  createdAt: number;
  status: CardStatus;
  arrivals: string[];
  plan: PlannedArrival[];
  pending: PendingReply[];
  comments: Comment[];
  advice?: Advice;
  /** One accepted player suggestion may schedule at most one fictional follow-up card. */
  pendingBrag?: PendingBrag;
  /** Provenance on the new persona brag card. */
  sourceCardId?: string;
  sourceCommentId?: string;
  sourceAdviceText?: string;
  /** Link from source worry to its published follow-up. */
  bragCardId?: string;
  note?: Note;
  doneAt?: number;
  handledAt?: number;
  seenAt?: number;
  readAt?: number;
  refused?: number;
  topic?: string;
  noMemory?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}



/* ------------------------------------------------------------------ *
 * 目标 / 日程 / 今日总结（2026-11-18 会议需求）
 * ------------------------------------------------------------------ */

export type GoalOwner = 'me' | string;
export type GoalStatus = 'active' | 'done' | 'paused' | 'dropped';
export type GoalSource = 'manual' | 'ai' | 'image';

export interface GoalStep {
  id: string;
  goalId: string;
  text: string;
  kind: 'research' | 'draft' | 'review' | 'admin' | 'other';
  estimateMin?: number;
  dueAt?: number;
  status: 'todo' | 'doing' | 'done';
  completedAt?: number;
}

export interface Goal {
  id: string;
  ownerId: GoalOwner;
  title: string;
  detail?: string;
  source: GoalSource;
  createdAt: number;
  dueAt?: number;
  status: GoalStatus;
  steps: GoalStep[];
  visibility: 'private' | 'forum';
  sharedCardId?: string;
  sharedAt?: number;
  /** Fictional AI goal outcome is planned at creation, not a real-world assertion. */
  postPlan?: { outcome: 'done' | 'partial' | 'missed'; dueAt: number; reportedAt?: number };
  resultCardId?: string;
}

export interface ScheduleItem {
  id: string;
  ownerId: GoalOwner;
  goalId?: string;
  stepId?: string;
  title: string;
  dateKey: string;
  startMin?: number;
  endMin?: number;
  status: 'todo' | 'done';
  source: 'goal' | 'todo' | 'manual' | 'ai';
  createdAt: number;
}

export interface DailySummary {
  id: string;
  ownerId: GoalOwner;
  dateKey: string;
  text: string;
  origin: 'model' | 'local';
  createdAt: number;
  refreshedAt?: number;
}

export interface WorldSettings {
  paused: boolean;
  maxArrivals: number;
  aiCardLimit: number;
  dailyCalls: number;
  maxCallsPerTick: number;
  speed: number;
  baselineExtra: string;
}

export interface World {
  lastTickAt: number;
  dayKey: string;
  callsToday: number;
  lastBragAt?: number;
  logs: string[];
}

/* ------------------------------------------------------------------ *
 * 群聊：房间 / 消息 / 下一步
 * 房间是唯一的容器；卡片状态机退役，「下一步」成为一等公民。
 * ------------------------------------------------------------------ */

export type MessageKind = 'chat' | 'system';

export interface Message {
  id: string;
  authorId: string;
  authorKind: 'player' | 'persona' | 'system';
  /** 作者信息冗余存一份：换一批群友之后，旧消息仍然有名字和头像。 */
  authorName: string;
  color?: string;
  avatarKey?: string;
  text: string;
  at: number;
  kind: MessageKind;
  /** 引用回复的是哪条消息的 id */
  replyTo?: string;
  /** @ 到的人 */
  mentions?: string[];
}

export type StepOrigin = 'ai' | 'self' | 'persona';

export interface NextStep {
  id: string;
  text: string;
  /** 'me' 或 personaId */
  ownerId: string;
  ownerName: string;
  origin: StepOrigin;
  fromPersonaId?: string;
  fromName?: string;
  /** 挂在哪个目标下；只是一行文字标签，不做进度 */
  group?: string;
  actionId?: string;
  createdAt: number;
  /** AI 给自己排的完成时间 */
  dueAt?: number;
  doneAt?: number;
}

export type ScheduleIntent = 'reply' | 'peer' | 'ambient' | 'react';

export interface ScheduledMessage {
  id: string;
  personaId: string;
  at: number;
  intent: ScheduleIntent;
  replyTo?: string;
  stepId?: string;
  /** 追话深度，用来限制 AI 之间无限接龙 */
  depth?: number;
}

export interface RoomUsage {
  day: string;
  messages: number;
}

export interface Room {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
  scheduled: ScheduledMessage[];
  steps: NextStep[];
  cast: Persona[];
  /** 已经离开的群友，用来显示「这人不在群里了」 */
  gone: Persona[];
  lastSeenAt: number;
  lastMessageAt: number;
  usage: RoomUsage;
  archivedAt?: number;
}

/** 玩家的两个旋钮：多热闹、时间停不停。 */
export interface RoomSettings {
  /** 0..1 */
  liveliness: number;
  /** 时间不停止：关闭页面后也补算，默认关 */
  timeFlow: boolean;
  /** 每天最多生成多少条消息 */
  dailyMessages: number;
}
