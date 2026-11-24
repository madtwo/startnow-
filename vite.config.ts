import { Readable } from 'node:stream';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// opencode.ai 不返回 Access-Control-Allow-Origin，浏览器不能直连，只能由同源代理转发。
// 按量付费和 Go 是两套网关，Key 不通用，所以各挂一个前缀。
const PROXIES = [
  {
    mount: '/api/opencode',
    upstream: (process.env.OPENCODE_PROXY_UPSTREAM ?? 'https://opencode.ai/inference/openai').replace(/\/+$/, ''),
  },
  {
    mount: '/api/opencode-go',
    upstream: (
      process.env.OPENCODE_GO_PROXY_UPSTREAM ?? 'https://opencode.ai/inference/go/openai'
    ).replace(/\/+$/, ''),
  },
];
const MAX_BODY = 1_000_000;

const reply = (res: ServerResponse, status: number, message: string) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: { message } }));
};

const readBody = async (req: IncomingMessage): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

const UPSTREAM_TIMEOUT_MS = 120_000;

/** 只放行两个精确端点；先拒绝 `..`/编码斜杠，避免 fetch 规范化后跳到上游其他路由。 */
export const proxyTarget = (method: string | undefined, rawUrl: string): string | null => {
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  if (/\.\.|%2e|%2f|%5c|\\/i.test(rawPath)) return null;
  if (method === 'POST' && rawPath === '/v1/chat/completions') return rawPath;
  if (method === 'GET' && rawPath === '/v1/models') return rawPath;
  return null;
};

/** 代理带着用户 Key 转发：只接受同源页面发来的请求。 */
export const crossSite = (req: IncomingMessage): boolean => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
};

const createProxy = (upstreamBase: string) => async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('x-startnow-proxy', '1');
  if (crossSite(req)) {
    reply(res, 403, '这个代理只接受本站页面的请求。');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = proxyTarget(req.method, req.url ?? '');
  if (!path) {
    reply(res, 405, '这个代理只转发 /v1/chat/completions 和 /v1/models。');
    return;
  }

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const headers: Record<string, string> = {
    'content-type': req.headers['content-type'] ?? 'application/json',
    accept: req.headers.accept ?? 'application/json',
    'user-agent': 'shudong-forum/0.1',
  };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers['x-opencode-session']) {
    headers['x-opencode-session'] = String(req.headers['x-opencode-session']).slice(0, 128);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  };
  if (req.method === 'POST') {
    let body: Buffer | null;
    try {
      body = await readBody(req);
    } catch {
      if (!res.writableEnded) res.destroy();
      return;
    }
    if (!body) {
      reply(res, 413, '请求体太大。');
      return;
    }
    init.body = new Uint8Array(body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}${path}`, init);
  } catch (err) {
    if (controller.signal.aborted) return;
    const timeout = (err as Error)?.name === 'TimeoutError';
    reply(res, timeout ? 504 : 502, timeout ? '上游响应超时。' : `转发到 opencode.ai 失败：${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  res.statusCode = upstream.status;
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.setHeader('retry-after', retryAfter);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) res.setHeader('cache-control', cacheControl);

  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body as never);
  stream.on('error', () => {
    if (!res.writableEnded) res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
};

const safeProxy = (upstreamBase: string) => {
  const handler = createProxy(upstreamBase);
  return (req: IncomingMessage, res: ServerResponse) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, '代理内部错误。');
      else if (!res.writableEnded) res.destroy();
    });
  };
};

const proxyPlugin = (): Plugin => ({
  name: 'opencode-proxy',
  configureServer(server) {
    for (const { mount, upstream } of PROXIES) {
      server.middlewares.use(mount, safeProxy(upstream));
    }
  },
  configurePreviewServer(server) {
    for (const { mount, upstream } of PROXIES) {
      server.middlewares.use(mount, safeProxy(upstream));
    }
  },
});

// 仅开发环境：长流程测试页把每次调用的日志与汇总写到本地文件。只接受本机请求。
const soakSinkPlugin = (): Plugin => ({
  name: 'soak-sink',
  configureServer(server) {
    const dir = resolve(__dirname, '.soak-data');
    const loopback = (req: IncomingMessage) => {
      const addr = req.socket.remoteAddress ?? '';
      return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    };
    server.middlewares.use('/__soak', (req, res) => {
      if (!loopback(req)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const name = (url.searchParams.get('name') ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (req.method !== 'POST' || !name) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8_000_000) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          mkdirSync(dir, { recursive: true });
          const target = resolve(dir, name);
          const data = Buffer.concat(chunks);
          if (name.endsWith('.jsonl')) appendFileSync(target, data);
          else writeFileSync(target, data);
          res.statusCode = 204;
          res.end();
        } catch {
          res.statusCode = 500;
          res.end();
        }
      });
    });
  },
});

export default defineConfig({
  plugins: [react(), proxyPlugin(), soakSinkPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        room: resolve(__dirname, 'room.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 演示机默认仅绑定回环地址，避免局域网设备访问带 Key 的调试代理。
    host: '127.0.0.1',
    watch: {
      ignored: ['**/dist/**', '**/dist-h5/**', '**/startnow-h5-*/**', '**/feedback-*/**', '**/*.zip'],
    },
  },
  preview: { host: '127.0.0.1' },
});
