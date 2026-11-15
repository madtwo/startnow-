import type { ChatMessage, LlmConfig } from '../types';
import { isMock, OPENCODE_CATALOG } from '../config/providers';

export type LlmErrorKind =
  | 'config'
  | 'auth'
  | 'notfound'
  | 'rate'
  | 'network'
  | 'server';

export class LlmError extends Error {
  kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

const endpoint = (baseUrl: string) =>
  `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;

const parseServerError = (status: number, body: string, baseUrl = ''): LlmError => {
  let detail = '';
  try {
    const json = JSON.parse(body);
    detail = json?.error?.message ?? json?.message ?? '';
  } catch {
    detail = body.slice(0, 160);
  }
  if (status === 401 || status === 403) {
    return new LlmError('auth', `密钥无效或没有权限（${status}）。${detail}`);
  }
  if (status === 404 && baseUrl.startsWith('/')) {
    return new LlmError(
      'notfound',
      `本站代理没有生效（404）。用 npm run dev / npm run preview 启动，或部署时补上 /api/opencode 转发。${detail}`,
    );
  }
  if (status === 404) {
    return new LlmError(
      'notfound',
      `接口地址或模型名不对（404）。检查 Base URL 是否以 /v1 结尾、模型名是否存在。${detail}`,
    );
  }
  if (status === 429) {
    return new LlmError('rate', `请求太频繁或额度用完了（429）。稍后再试，或换个模型。${detail}`);
  }
  return new LlmError('server', `服务端返回 ${status}。${detail}`);
};

const networkError = () =>
  new LlmError(
    'network',
    '连不上这个接口。常见原因：地址写错，或该服务不允许浏览器直连（CORS）。可以换 DeepSeek / OpenAI，或填一个自建代理地址。',
  );

export async function streamChat(opts: {
  config: LlmConfig;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<string> {
  const { config, messages, signal, onDelta } = opts;
  if (isMock(config)) {
    throw new LlmError('config', '演示模式不走网络请求。');
  }
  if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
    throw new LlmError('config', '还没填好接口地址、模型名或密钥。');
  }

  let res: Response;
  try {
    res = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        stream: true,
        max_tokens: 600,
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw networkError();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw parseServerError(res.status, body, config.baseUrl);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    if (text) onDelta(text);
    return text;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new LlmError('server', '响应为空，服务没有返回内容。');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 一行被截断时忽略，下一次 read 会补齐
      }
    }
  }

  if (!full.trim()) throw new LlmError('server', '模型没有返回任何文字，换个模型试试。');
  return full;
}

export async function testConnection(config: LlmConfig, signal?: AbortSignal): Promise<string> {
  if (isMock(config)) return '演示模式可用，不需要 API。';
  if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
    throw new LlmError('config', '先把接口地址、模型名和密钥填完整。');
  }

  let res: Response;
  try {
    res = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{ role: 'user', content: '只回复两个字：可以' }],
        stream: false,
        max_tokens: 16,
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw networkError();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw parseServerError(res.status, body, config.baseUrl);
  }

  const data = await res.json().catch(() => null);
  if (!data) throw new LlmError('server', '返回的不是合法 JSON，这个地址可能不是 OpenAI 兼容接口。');
  const servedModel = data?.model ?? config.model;
  return `连接成功 · ${servedModel}`;
}

export interface ModelOption {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  cost?: { text?: { input?: { price?: unknown }; output?: { price?: unknown } } };
}

export async function fetchOpenCodeModels(signal?: AbortSignal): Promise<ModelOption[]> {
  let res: Response;
  try {
    res = await fetch(OPENCODE_CATALOG, { signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new LlmError('network', '拉不到 OpenCode 的模型列表，先手动填模型名也能用。');
  }
  if (!res.ok) {
    throw new LlmError('server', `拉取模型列表失败（${res.status}），先手动填模型名也能用。`);
  }
  const json = await res.json().catch(() => null);
  const rows: RawModel[] = Array.isArray(json?.data) ? json.data : [];
  return rows
    .filter((m) => typeof m.id === 'string' && m.type === 'chat' && !m.id.endsWith('-free'))
    .map((m) => ({
      id: m.id as string,
      name: typeof m.name === 'string' && m.name ? m.name : (m.id as string),
      inputPrice: Number(m.cost?.text?.input?.price),
      outputPrice: Number(m.cost?.text?.output?.price),
    }))
    .filter((m) => Number.isFinite(m.inputPrice) && m.inputPrice > 0)
    .sort((a, b) => a.inputPrice - b.inputPrice);
}

export function describeError(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if ((err as Error)?.name === 'AbortError') return '已停止';
  return `出了点问题：${err instanceof Error ? err.message : String(err)}`;
}

export async function streamMock(
  text: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
) {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 4) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    onDelta(chars.slice(i, i + 4).join(''));
    await new Promise((r) => setTimeout(r, 14));
  }
}
