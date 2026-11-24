import { captureModelFence } from './modelFence';
import type { ChatMessage, LlmConfig } from '../types';
import { rejectQueuedProviderRequests, withProviderRequestSlot } from './providerConcurrency';
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
  | 'server'
  | 'truncated';

export class LlmError extends Error {
  kind: LlmErrorKind;
  retryAfterMs?: number;
  noFallback = false;

  constructor(kind: LlmErrorKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

import { isContentFilteredResponse, isContentFilteredBody } from './contentFilter';
const filteredError = () => Object.assign(new LlmError('server', '模型输出被上游内容过滤，未采用此结果。'), {noFallback:true});

/** 避免把浏览器 Bearer Key 通过明文 HTTP 或跨站 // URL 发给未知接口。 */
export function validateLlmEndpointBase(baseUrl: string): void {
  const value = baseUrl.trim();
  // URL 解析会删除制表/换行，`/\t/evil.com` 会变成协议相对地址，所以先拒绝空白和控制字符。
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    throw new LlmError('config', '模型 Base URL 不能包含空格或控制字符。');
  }
  if (value.startsWith('/')) {
    if (/^\/(?!\/)[A-Za-z0-9._~\-/]*$/.test(value) && !/(^|\/)\.\.?(\/|$)/.test(value)) return;
    throw new LlmError('config', '同源代理路径只能包含字母、数字和 / . _ - ~，且不能含 .. 段。');
  }
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

/** 上游错误原文会进日志和导出存档：抹掉任何像凭据的片段。 */
export const scrubSecrets = (text: string, apiKey = ''): string => {
  let out = String(text);
  const key = apiKey.trim();
  if (key.length >= 6) out = out.split(key).join('[已隐藏]');
  return out
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [已隐藏]')
    .replace(/\b(?:sk|pk|rk|ak)[-_][A-Za-z0-9_-]{8,}/g, '[已隐藏]')
    .replace(/\b(api[-_]?key|authorization|x-api-key|token)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1$2[已隐藏]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[已隐藏]');
};

/** RFC 9110 Retry-After accepts integer seconds or HTTP dates. Cap at ten minutes. */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Math.min(600_000, Number(text) * 1000);
  // Do not let Date.parse coerce arbitrary strings such as "-5" into dates.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/i.test(text)) return null;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.min(600_000, Math.max(0, date - now)) : null;
}

let opencodeRateLimitUntil = 0;
export const modelRateLimitRemainingMs = (now = Date.now()) => Math.max(0, opencodeRateLimitUntil - now);

// A provider's 429 response must not echo its detailed error body to other
// queued callers. Stop this burst with a generic redacted rate-limit error.
const stopQueuedAfterRateLimit = (baseUrl: string, error: LlmError): void => {
  const wait = error.retryAfterMs;
  const hint = wait !== undefined ? `建议等待约 ${Math.ceil(wait / 1000)} 秒。` : '稍后重试。';
  rejectQueuedProviderRequests(baseUrl,
    new LlmError('rate', `同一服务商返回 429，排队请求已停止且未发送。${hint}`, wait));
};

const parseServerError = (
  status: number,
  body: string,
  baseUrl = '',
  proxyReached = false,
  apiKey = '',
  retryAfter: string | null = null,
): LlmError => {
  if (isContentFilteredBody(body)) return filteredError();
  let detail = '';
  try {
    const json = JSON.parse(body);
    const raw = json?.error?.message ?? json?.message ?? '';
    detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } catch {
    detail = body;
  }
  detail = scrubSecrets(detail, apiKey).slice(0, 160);
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
    const retryMs = parseRetryAfterMs(retryAfter);
    if (retryMs !== null) opencodeRateLimitUntil = Math.max(opencodeRateLimitUntil, Date.now() + retryMs);
    return new LlmError('rate', `请求太频繁（429）。${retryMs !== null ? `建议等待约 ${Math.ceil(retryMs / 1000)} 秒。` : '稍后再试。'}${detail}`, retryMs ?? undefined);
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
const SESSION_KEY = 'startnow.opencode.router-session.v1';
let inMemorySessionSeed = '';
const sessionSeed = () => {
  if (inMemorySessionSeed) return inMemorySessionSeed;
  const generated = newSessionId();
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    inMemorySessionSeed = existing && /^ses_[a-z0-9_-]{12,96}$/i.test(existing) ? existing : generated;
    if (!existing || existing !== inMemorySessionSeed) sessionStorage.setItem(SESSION_KEY, inMemorySessionSeed);
  } catch {
    inMemorySessionSeed = generated;
  }
  return inMemorySessionSeed;
};

/** Stable within a browser tab and one logical role/card thread, never an API credential. */
export const scopedOpenCodeSessionId = (scope: string): string => {
  let hash = 2166136261;
  for (const character of scope) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `${sessionSeed()}_${(hash >>> 0).toString(16)}`;
};

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
  onRequestAttempt?: () => void,
  allowed: () => boolean = captureModelFence(),
) => {
  const post = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消。', 'AbortError');
    if (!allowed()) throw new LlmError('config', '本地存储已锁定，未发送模型请求。');
    onRequestAttempt?.();
    if (!allowed()) throw new LlmError('config', '本地存储已锁定，未发送模型请求。');
    return fetch(endpoint(config.baseUrl), {
      method: 'POST',
      signal,
      headers: chatHeaders(config, sessionId),
      body: JSON.stringify(chatBody(config, messages, stream, maxTokens, lowEffort)),
    });
  };
  let res = await post();
  if (res.status === 400 && lowEffort && !effortUnsupported.has(effortKey(config))) {
    const detail = await res.clone().text().catch(() => '');
    if (isContentFilteredBody(detail)) throw filteredError();
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
    headers['x-opencode-session'] = sessionId ?? scopedOpenCodeSessionId('standalone');
  }
  return headers;
};

/** No prompts or API keys are included. One entry is emitted per provider attempt. */
export interface ChatTelemetry {
  model: string;
  requestedMaxTokens: number;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  visibleChars: number;
  durationMs: number;
  outcome: 'ok' | 'empty' | 'truncated' | 'error';
  reasoningBudgetExhausted: boolean;
}

type StreamChatOptions = {
  config: LlmConfig;
  messages: ChatMessage[];
  signal: AbortSignal;
  sessionId?: string;
  onDelta: (text: string) => void;
  maxTokens?: number;
  lowEffort?: boolean;
  onTelemetry?: (entry: ChatTelemetry) => void;
  /** Invoked before each actual HTTP attempt (including retry/fallback). May reject authorization. */
  onRequestAttempt?: () => void;
  /** Captured once for the entire logical operation, including fallback. */
  storagePermit?: () => boolean;
  /** Internal per-attempt usage/finish snapshot; not user text. */
  onStreamMetadata?: (part: Partial<ChatTelemetry>) => void;
};

async function rawStreamChatOnce(opts: StreamChatOptions): Promise<string> {
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
    res = await sendChat(config, messages, signal, sessionId, true, maxTokens, lowEffort, opts.onRequestAttempt, opts.storagePermit);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw requestError(err, signal);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const error = parseServerError(
      res.status,
      body,
      config.baseUrl,
      res.headers.get('x-startnow-proxy') === '1',
      config.apiKey,
      res.headers.get('retry-after'),
    );
    if (error.kind === 'rate') stopQueuedAfterRateLimit(config.baseUrl, error);
    throw error;
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    if (isContentFilteredResponse(data)) throw filteredError();
    if (data?.error) throw new LlmError('server', '模型返回错误。');
    const text = extractText(data?.choices?.[0]?.message?.content);
    const usage = data?.usage;
    opts.onStreamMetadata?.({
      finishReason: data?.choices?.[0]?.finish_reason ?? undefined,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
    });
    if (text.length > 20_000) throw new LlmError('server', '模型输出超过安全长度限制。');
    if (data?.choices?.[0]?.finish_reason === 'length') {
      throw new LlmError('truncated', '模型达到输出 Token 上限，已丢弃可能不完整的回复。');
    }
    if (!text.trim()) {
      throw new LlmError('server', '模型没有返回任何文字，请检查推理 Token 与输出上限。');
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

  let finished = false;
  let finishReason: string | undefined;
  let completionTokens: number | undefined;
  let reasoningTokens: number | undefined;
  const parsePayload = (payload: string): unknown => {
    if (payload === '[DONE]') { finished = true; return null; }
    try {
      return JSON.parse(payload);
    } catch {
      throw new LlmError('server', '模型返回了无法解析的流式数据。');
    }
  };
  const applyPayload = (json: any) => {
    if (!json) return;
    if (isContentFilteredResponse(json)) throw filteredError();
    if (typeof json?.choices?.[0]?.finish_reason === 'string') {
      finishReason = json.choices[0].finish_reason;
      opts.onStreamMetadata?.({ finishReason });
    }
    if (json?.usage) {
      completionTokens = json.usage.completion_tokens;
      reasoningTokens = json.usage.completion_tokens_details?.reasoning_tokens;
      opts.onStreamMetadata?.({
        promptTokens: json.usage.prompt_tokens,
        completionTokens, reasoningTokens,
      });
    }
    if (json?.error) {
      throw new LlmError('server', `模型返回错误：${scrubSecrets(String(json.error?.message ?? 'stream error'), config.apiKey).slice(0, 160)}`);
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
    while (!finished) {
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
    if (!finished) {
      buffer += decoder.decode();
      if (buffer) parseLine(buffer); // 支持末尾没有换行的最后一帧
      flushEvent();
    }
  } catch (err) {
    if (err instanceof LlmError) throw err;
    const classified = requestError(err, signal);
    // 接口流已经启动却在读取中报错：不要将半截回复当成正常结果。
    if (classified instanceof LlmError && classified.kind === 'network' && !signal.aborted) {
      throw new LlmError('network', '模型响应中途断开，未保存不完整回复；稍后再试。');
    }
    throw classified;
  } finally {
    await reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* 已释放 */ }
  }

  if (finishReason === 'length') {
    throw new LlmError('truncated', '模型达到输出 Token 上限，已丢弃可能不完整的回复。');
  }
  if (finishReason === 'content_filter') {
    throw Object.assign(new LlmError('server', '模型输出被上游内容过滤，未采用此结果。'), {noFallback:true});
  }
  if (!full.trim()) {
    const exhausted = completionTokens !== undefined && reasoningTokens !== undefined &&
      completionTokens > 0 && reasoningTokens >= completionTokens;
    throw new LlmError('server', exhausted
      ? '模型没有返回任何文字：完成 Token 全部用于推理。'
      : '模型没有返回任何文字，请检查流结束原因。');
  }
  // Compatibility mode: services without a terminal marker must at least end
  // at a complete sentence, not leave the user with an unfinished instruction.
  if (!finished && !finishReason && /(?:先把|请把|再把|可以先把|准备|正在|然后|因为|但是|如果|以及|并且|或者|一个|一份|一条|一段|先|将|让|给|把|要|地|得|的|，|、|：|:)$/.test(full.trim())) {
    throw new LlmError('server', '模型流没有结束标记，而且停在未说完的连接词或动作上；已丢弃可能被截断的回复。');
  }
  return full;
}

async function streamChatOnce(opts: StreamChatOptions): Promise<string> {
  const started = performance.now();
  const meta: ChatTelemetry = {
    model: opts.config.model.trim(),
    requestedMaxTokens: opts.maxTokens ?? 600,
    visibleChars: 0,
    durationMs: 0,
    outcome: 'error',
    reasoningBudgetExhausted: false,
  };
  try {
    // Hold the slot until the JSON body or final SSE event has been consumed.
    const text = await withProviderRequestSlot(opts.config.baseUrl, opts.signal, () => rawStreamChatOnce({
      ...opts,
      onDelta: (chunk) => {
        if (opts.storagePermit && !opts.storagePermit()) throw new LlmError('config', '数据已重置，本次回复未采用。');
        meta.visibleChars += chunk.length;
        opts.onDelta(chunk);
      },
      onStreamMetadata: (part) => {
        Object.assign(meta, part);
        opts.onStreamMetadata?.(part);
      },
    }));
    if (opts.storagePermit && !opts.storagePermit()) throw new LlmError('config', '数据已重置，本次回复未采用。');
    meta.visibleChars = text.length;
    meta.outcome = 'ok';
    return text;
  } catch (err) {
    // Queued requests can time out before fetch() starts. Keep the same error
    // classification and retry semantics as requests cancelled during fetch.
    const classified = (err as Error)?.name === 'AbortError' ? requestError(err, opts.signal) : err;
    meta.outcome = classified instanceof LlmError && classified.kind === 'truncated' ? 'truncated'
      : classified instanceof LlmError && /没有返回任何文字/.test(classified.message) ? 'empty' : 'error';
    throw classified;
  } finally {
    meta.durationMs = Math.round(performance.now() - started);
    meta.reasoningBudgetExhausted = (meta.outcome === 'empty' || meta.outcome === 'truncated') &&
      meta.visibleChars === 0 && (meta.completionTokens ?? 0) > 0 &&
      (meta.reasoningTokens ?? -1) >= (meta.completionTokens ?? 0);
    try { opts.onTelemetry?.(meta); } catch { /* telemetry must never affect a user response */ }
  }
}

/**
 * 主模型失败时自动尝试备用模型。
 * 只有“还没输出任何文字”的失败才切换；已经吐了半句再断流不重试，避免重复。
 */
export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const captured = captureModelFence();
  const parent = opts.storagePermit;
  opts = { ...opts, storagePermit: () => captured() && (!parent || parent()) };
  const fallback = opts.config.fallbackModel?.trim();
  if (!fallback || fallback === opts.config.model.trim()) return streamChatOnce(opts);

  let emitted = false;
  try {
    return await streamChatOnce({
      ...opts,
      onDelta: (text) => {
        if (text) emitted = true;
        opts.onDelta(text);
      },
    });
  } catch (err) {
    if (emitted || opts.signal.aborted) throw err;
    if (!(err instanceof LlmError) || err.noFallback || err.kind === 'auth' || err.kind === 'config' || err.kind === 'quota' || err.kind === 'rate') throw err;
    return streamChatOnce({
      ...opts,
      config: { ...opts.config, model: fallback },
    });
  }
}

export async function testConnection(config: LlmConfig, signal?: AbortSignal): Promise<string> {
  if (isMock(config)) return '演示模式可用，不需要 API。';
  const allowed = captureModelFence();
  if (!config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
    throw new LlmError('config', '先把接口地址、模型名和密钥填完整。');
  }
  validateLlmEndpointBase(config.baseUrl);
  const safeSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000);

  try {
    return await withProviderRequestSlot(config.baseUrl, safeSignal, async () => {
      let res: Response;
      try {
        if (!allowed()) throw new LlmError('config', '本地存储已锁定，未发送模型请求。');
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
        throw requestError(err, safeSignal);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = parseServerError(
          res.status, body, config.baseUrl,
          res.headers.get('x-startnow-proxy') === '1',
          config.apiKey, res.headers.get('retry-after'),
        );
        if (error.kind === 'rate') stopQueuedAfterRateLimit(config.baseUrl, error);
        throw error;
      }

      const data = await res.json().catch(() => null);
      if (isContentFilteredResponse(data)) throw filteredError();
      if (data?.error) throw new LlmError('server', '模型返回错误。');
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
    });
  } catch (err) {
    // A timeout/abort while waiting in the queue has the same public error
    // semantics as cancelling a request already sent to the provider.
    if ((err as Error)?.name === 'AbortError') throw requestError(err, safeSignal);
    throw err;
  }
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
