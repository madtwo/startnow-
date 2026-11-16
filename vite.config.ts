import { Readable } from 'node:stream';
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

const createProxy = (upstreamBase: string) => async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('x-startnow-proxy', '1');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Opencode-Session');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.end();
    return;
  }

  const url = req.url ?? '';
  const allowed =
    (req.method === 'POST' && url.startsWith('/v1/chat/completions')) ||
    (req.method === 'GET' && url.startsWith('/v1/models'));
  if (!allowed) {
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
    headers['x-opencode-session'] = String(req.headers['x-opencode-session']);
  }

  const init: RequestInit = { method: req.method, headers, signal: controller.signal };
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body) {
      reply(res, 413, '请求体太大。');
      return;
    }
    init.body = new Uint8Array(body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}${url}`, init);
  } catch (err) {
    if (controller.signal.aborted) return;
    reply(res, 502, `转发到 opencode.ai 失败：${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  res.statusCode = upstream.status;
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) res.setHeader('cache-control', cacheControl);

  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as never).pipe(res);
};

const proxyPlugin = (): Plugin => ({
  name: 'opencode-proxy',
  configureServer(server) {
    for (const { mount, upstream } of PROXIES) {
      server.middlewares.use(mount, createProxy(upstream));
    }
  },
  configurePreviewServer(server) {
    for (const { mount, upstream } of PROXIES) {
      server.middlewares.use(mount, createProxy(upstream));
    }
  },
});

export default defineConfig({
  plugins: [react(), proxyPlugin()],
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
  },
  preview: { host: '127.0.0.1' },
});
