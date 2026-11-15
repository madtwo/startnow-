import type { LlmConfig, Post } from '../types';
import { defaultConfig, PRESETS } from '../config/providers';

const CONFIG_KEY = 'shudong.config.v1';
const POSTS_KEY = 'shudong.posts.v1';
const IDENTITY_KEY = 'shudong.identity.v1';

export interface Identity {
  id: string;
  name: string;
}

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

export function loadConfig(): LlmConfig {
  const saved = read(CONFIG_KEY) as Partial<LlmConfig> | null;
  if (!saved || typeof saved !== 'object') return defaultConfig;
  const providerId = PRESETS.some((p) => p.id === saved.providerId)
    ? saved.providerId!
    : defaultConfig.providerId;
  return {
    providerId,
    baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : defaultConfig.baseUrl,
    model: typeof saved.model === 'string' ? saved.model : defaultConfig.model,
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
  };
}

export const saveConfig = (config: LlmConfig) => write(CONFIG_KEY, config);

export function loadPosts(): Post[] {
  const saved = read(POSTS_KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((p): p is Post => Boolean(p) && typeof p.content === 'string')
    .slice(0, 30)
    .map((post) => ({
      ...post,
      replies: (Array.isArray(post.replies) ? post.replies : []).map((r) =>
        r.status === 'streaming'
          ? { ...r, status: 'stopped' as const, error: '页面刷新，生成中断' }
          : r,
      ),
    }));
}

export const savePosts = (posts: Post[]) => write(POSTS_KEY, posts.slice(0, 30));

export function loadIdentity(): Identity {
  const saved = read(IDENTITY_KEY) as Identity | null;
  if (saved && typeof saved.id === 'string' && typeof saved.name === 'string') {
    return saved;
  }
  const identity: Identity = {
    id: crypto.randomUUID(),
    name: `匿名 · ${Math.floor(100 + Math.random() * 900)}`,
  };
  write(IDENTITY_KEY, identity);
  return identity;
}
