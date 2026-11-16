import type { ChatMessage, LlmConfig } from '../types';
import {
  isMock,
  isOpenCodeBase,
  OPENCODE_CATALOG,
  OPENCODE_GO_CATALOG,
} from '../config/providers';

export type LlmErrorKind =
  | 'config'
  | 'auth'
  | 'quota'
  | 'notfound'
  | 'rate'
  | 'network'
  | 'timeout'
  | 'server';

export class LlmError extends Error {
  kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

/** 避免把浏览器 Bearer Key 通过明文 HTTP 或跨站 // URL 发给未知接口。 */
export function validateLlmEndpointBase(baseUrl: string): void {
  const value = baseUrl.trim();
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') &&
      !/[?#]/.test(value)) return; // 同源代理路径，禁止协议相对 URL。
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LlmError('config', '模型 Base URL 必须是 HTTPS 地址或同源代理路径。');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new LlmError('config', '模型接口必须使用 HTTPS；仅允许 localhost/127.0.0.1/::1 的 HTTP 开发地址。不能使用含凭据、查询参数或片段的 Base URL。');
  }
}

const endpoint = (baseUrl: string) =>
  `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;

const parseServerError = (
  status: number,
  body: string,
  baseUrl = '',
  proxyReached = false,
): LlmError => {
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
      proxyReached
        ? `代理已连通，但上游返回 404。检查模型名是否存在、Base URL 是否以 /v1 结尾。${detail}`
        : `本站代理没有生效（404）。用 npm run dev / npm run preview 启动，或部署时补上 /api/opencode 与 /api/opencode-go 转发。${detail}`,
    );
  }
  if (status === 404) {
    return new LlmError(
      'notfound',
      `接口地址或模型名不对（404）。检查 Base URL 是否以 /v1 结尾、模型名是否存在。${detail}`,
    );
  }
  if (status === 402) {
    return new LlmError(
      'quota',
      baseUrl.includes('/opencode-go')
        ? `Go 套餐额度用完了，或订阅没生效（402）。到 opencode.ai/console 的 Go 页面确认订阅。${detail}`
        : `这个 Key 属于 Go 套餐，不能走按量付费网关（402）。服务商换成「OpenCode Go · 订阅套餐」再试。${detail}`,
    );
  }
  if (status === 429) {
    return new LlmError('rate', `请求太频繁或额度用完了（429）。稍后再试，或换个模型。${detail}`);
  }
  return new LlmError('server', `服务端返回 ${status}。${detail}`);
};

const requestError = (err: unknown, signal?: AbortSignal): Error => {
  const reason = signal?.reason as { name?: string } | undefined;
  if ((err as Error)?.name === 'TimeoutError' || reason?.name === 'TimeoutError') {
    return new LlmError('timeout', '模型响应超时，可以稍后重试。');
  }
  if ((err as Error)?.name === 'AbortError' || signal?.aborted) {
    return new LlmError('network', '请求已取消。');
  }
  return networkError();
};

const extractText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((row) =>
      row && typeof row === 'object' && 'text' in row && typeof row.text === 'string'
        ? row.text : '',
    ).join('');
  }
  return '';
};

const networkError = () =>
  new LlmError(
    'network',
    '连不上这个接口。常见原因：地址写错，或该服务不允许浏览器直连（CORS）。可以换 DeepSeek / OpenAI，或填一个自建代理地址。',
  );

const newSessionId = () => `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

// 居民都是随手发帖，默认只给最低思考度；模型不认这个参数时记住并回退
const effortUnsupported = new Set<string>();
const effortKey = (config: LlmConfig) => `${config.baseUrl.trim()}|${config.model.trim()}`;

const chatBody = (
  config: LlmConfig,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens: number,
  lowEffort: boolean,
) => {
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    messages,
    stream,
    max_tokens: maxTokens,
  };
  if (lowEffort && !effortUnsupported.has(effortKey(config))) {
    body.reasoning_effort = 'low';
  }
  return body;
};

const sendChat = async (
  config: LlmConfig,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  sessionId: string | undefined,
  stream: boolean,
  maxTokens: number,
  lowEffort: boolean,
) => {
  const post = () =>
    fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal,
      headers: chatHeaders(config, sessionId),
      body: JSON.stringify(chatBody(config, messages, stream, maxTokens, lowEffort)),
    });
  let res = await post();
  if (res.status === 400 && lowEffort && !effortUnsupported.has(effortKey(config))) {
    const detail = await res.clone().text().catch(() => '');
    if (/reasoning_effort|thinking|unsupported|unknown (param|field)/i.test(detail)) {
      effortUnsupported.add(effortKey(config));
      res = await post();
    }
  }
  return res;
};

const chatHeaders = (config: LlmConfig, sessionId?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey.trim()}`,
  };
  // Go 套餐要求每个会话带稳定 session id，用于路由和缓存
  if (isOpenCodeBase(config.baseUrl)) {
    headers['x-opencode-session'] = sessionId ?? newSessionId();
  }
  return headers;
};

export async function streamChat(opts: {
  config: LlmConfig;
  messages: ChatMessage[];
  signal: AbortSignal;
  sessionId?: string;
  onDelta: (text: string) => void;
  maxTokens?: number;
  lowEffort?: boolean;
}): Promise<string> {
  const { config, messages, signal, sessionId, onDelta } = opts;
  const maxTokens = opts.maxTokens ?? 600;
  const lowEffort = opts.lowEffort ?? true;
  if (isMock(config)) {
    throw new LlmError('config', '演示模式不走网络请求。');
  }
  if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
    throw new LlmError('config', '还没填好接口地址、模型名或密钥。');
  }
  validateLlmEndpointBase(config.baseUrl);

  let res: Response;
  try {
    res = await sendChat(config, messages, signal, sessionId, true, maxTokens, lowEffort);
  } catch (err) {
    throw requestError(err, signal);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw parseServerError(
      res.status,
      body,
      config.baseUrl,
      res.headers.get('x-startnow-proxy') === '1',
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    const text = extractText(data?.choices?.[0]?.message?.content);
    if (!text.trim()) {
      throw new LlmError('server', '模型没有返回任何文字，换个模型试试。');
    }
    onDelta(text);
    return text;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new LlmError('server', '响应为空，服务没有返回内容。');

  const decoder = new TextDecoder();
  const MAX_SSE_EVENT = 256_000;
  let buffer = '';
  let full = '';
  let dataLines: string[] = [];
  let eventSize = 0;

  const parsePayload = (payload: string): unknown => {
    if (payload === '[DONE]') return null;
    try {
      return JSON.parse(payload);
    } catch {
      throw new LlmError('server', '模型返回了无法解析的流式数据。');
    }
  };
  const applyPayload = (json: any) => {
    if (!json) return;
    if (json?.error) {
      throw new LlmError('server', `模型返回错误：${String(json.error?.message ?? 'stream error').slice(0, 160)}`);
    }
    const delta = extractText(json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content);
    if (delta) {
      full += delta;
      if (full.length > 20_000) throw new LlmError('server', '模型输出超过安全长度限制。');
      onDelta(delta);
    }
  };
  const flushEvent = () => {
    if (!dataLines.length) return;
    const lines = dataLines;
    dataLines = [];
    eventSize = 0;
    const joined = lines.join('\n').trim();
    try {
      applyPayload(parsePayload(joined));
    } catch (err) {
      // SSE 正规格式是多行 data 合成一个 event。个别兼容服务缺少空行，
      // 此时仅在每一行自身都是合法 JSON/[DONE] 时，宽容处理为独立事件。
      if (lines.length <= 1 || !(err instanceof LlmError) || !err.message.includes('无法解析')) throw err;
      const individual = lines.map((line) => parsePayload(line.trim()));
      individual.forEach(applyPayload);
    }
  };
  const parseLine = (raw: string) => {
    const line = raw.replace(/\r$/, '');
    if (!line) {
      flushEvent();
    } else if (line.startsWith('data:')) {
      const content = line.slice(5).replace(/^ /, '');
      eventSize += content.length;
      if (eventSize > MAX_SSE_EVENT) throw new LlmError('server', '模型单帧流式数据过长。');
      dataLines.push(content);
    }
    // 忽略 SSE 的 :ping、event:、id:、retry: 字段。
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_SSE_EVENT) throw new LlmError('server', '模型单行流式数据过长。');
    }
    buffer += decoder.decode();
    if (buffer) parseLine(buffer); // 支持末尾没有换行的最后一帧
    flushEvent();
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw requestError(err, signal);
  } finally {
    reader.releaseLock();
  }

  if (!full.trim()) throw new LlmError('server', '模型没有返回任何文字，换个模型试试。');
  return full;
}

export async function testConnection(config: LlmConfig, signal?: AbortSignal): Promise<string> {
  if (isMock(config)) return '演示模式可用，不需要 API。';
  if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
    throw new LlmError('config', '先把接口地址、模型名和密钥填完整。');
  }
  validateLlmEndpointBase(config.baseUrl);

  let res: Response;
  try {
    const safeSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000);
    res = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal: safeSignal,
      headers: chatHeaders(config),
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{ role: 'user', content: '只回复两个字：可以' }],
        stream: false,
        max_tokens: 240,
      }),
    });
  } catch (err) {
    throw requestError(err, signal);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw parseServerError(
      res.status,
      body,
      config.baseUrl,
      res.headers.get('x-startnow-proxy') === '1',
    );
  }

  const data = await res.json().catch(() => null);
  if (!data) throw new LlmError('server', '返回的不是合法 JSON，这个地址可能不是 OpenAI 兼容接口。');
  const content = extractText(data?.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new LlmError(
      'server',
      '接口通了，但模型没有返回文字。它可能把 token 全用在 reasoning 上，换一个模型或调高 max_tokens。',
    );
  }
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

export async function fetchOpenCodeModels(
  plan: 'console' | 'go',
  signal?: AbortSignal,
): Promise<ModelOption[]> {
  const isGo = plan === 'go';
  let res: Response;
  try {
    res = await fetch(isGo ? OPENCODE_GO_CATALOG : OPENCODE_CATALOG, { signal });
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
    .filter((m) => typeof m.id === 'string' && m.type === 'chat')
    .map((m) => ({
      id: m.id as string,
      name: typeof m.name === 'string' && m.name ? m.name : (m.id as string),
      inputPrice: Number(m.cost?.text?.input?.price ?? 0),
      outputPrice: Number(m.cost?.text?.output?.price ?? 0),
    }))
    .filter((m) => isGo || (Number.isFinite(m.inputPrice) && m.inputPrice > 0))
    .sort((a, b) => a.inputPrice - b.inputPrice || a.name.localeCompare(b.name));
}

export function describeError(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if ((err as Error)?.name === 'AbortError') return '已停止';
  if ((err as Error)?.name === 'TimeoutError') return '模型响应超时';
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
