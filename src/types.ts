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

export interface Persona {
  id: string;
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
  logs: string[];
}
