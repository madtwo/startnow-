export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'moonshot'
  | 'zhipu'
  | 'opencode'
  | 'compatible'
  | 'mock';

export interface LlmConfig {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface Persona {
  id: string;
  name: string;
  avatar: string;
  handle: string;
  role: string;
  tagline: string;
  color: string;
  systemPrompt: string;
}

export type ReplyStatus = 'streaming' | 'done' | 'error' | 'stopped';

export interface Reply {
  id: string;
  personaId: string;
  content: string;
  createdAt: number;
  status: ReplyStatus;
  error?: string;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  replies: Reply[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
