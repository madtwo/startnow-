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
  voice: string;
  color: string;
  avatarKey: string;
  gender: Gender;
  age: number;
  school: string;
  major: string;
  cohort: string;
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

export type CardStatus = 'stuck' | 'arrived' | 'talking' | 'advised' | 'noted' | 'done' | 'handled';

export interface Comment {
  id: string;
  authorId: string;
  authorKind: 'player' | 'persona' | 'helper';
  text: string;
  at: number;
  kind?: 'comment' | 'advice';
  peer?: string;
}

export interface Advice {
  text: string;
  actionId?: string;
  fromPersonaId: string;
  at: number;
  accepted: boolean;
}

export interface Note {
  text: string;
  actionId?: string;
  fromPersonaId: string;
  at: number;
  dueAt: number;
}

export interface PlannedArrival {
  personaId: string;
  at: number;
}

export interface PendingReply {
  personaId: string;
  at: number;
  phase: 'reply' | 'reaction' | 'decide';
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
  kind?: 'worry' | 'brag' | 'guide';
  likes?: number;
  helperAt?: number;
  likedByMe?: boolean;
  text: string;
  weight?: 1 | 2 | 3;
  image?: string;
  createdAt: number;
  status: CardStatus;
  arrivals: string[];
  plan: PlannedArrival[];
  pending: PendingReply[];
  comments: Comment[];
  advice?: Advice;
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
