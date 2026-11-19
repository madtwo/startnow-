import type { LlmConfig, ProviderId } from '../types';

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  model: string;
  fallbackModel?: string;
  hint: string;
  needsKey: boolean;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '便宜、中文口语自然，浏览器可直连',
    needsKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要海外网络环境',
    needsKey: true,
  },
  {
    id: 'qwen',
    name: '通义千问 · 百炼兼容模式',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '阿里云百炼控制台申请 Key',
    needsKey: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '长文本友好',
    needsKey: true,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '有免费额度',
    needsKey: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode · 按量付费',
    baseUrl: '/api/opencode/v1',
    model: 'glm-5.3-flash',
    hint: 'Console 里充值按量付费的 Key 走这里。和 Go 套餐的 Key 不通用。',
    needsKey: true,
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go · 订阅套餐',
    baseUrl: '/api/opencode-go/v1',
    // New presets only: do not silently change an existing browser configuration.
    model: 'deepseek-v4.1-flash',
    fallbackModel: 'glm-5.3-flash',
    hint: 'Go / Go Plus 订阅 Key；新配置默认 DeepSeek，GLM 备用。已有配置不会自动改动。',
    needsKey: true,
  },
  {
    id: 'compatible',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    hint: '任何兼容 /chat/completions 的服务，含自建代理',
    needsKey: true,
  },
  {
    id: 'mock',
    name: '演示模式（不调用 API）',
    baseUrl: '',
    model: 'demo',
    hint: '本地模拟回帖，用来先看交互',
    needsKey: false,
  },
];

export const OPENCODE_CATALOG = 'https://opencode.ai/inference/v1/models';
export const OPENCODE_GO_CATALOG = 'https://opencode.ai/inference/go/v1/models';

export const isOpenCodeBase = (baseUrl: string) => baseUrl.trim().startsWith('/api/opencode');

export const getPreset = (id: ProviderId): ProviderPreset =>
  PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export const defaultConfig: LlmConfig = {
  providerId: 'mock',
  baseUrl: '',
  model: 'demo',
  apiKey: '',
};

export const isMock = (config: LlmConfig) => config.providerId === 'mock';

export const isReady = (config: LlmConfig) =>
  isMock(config) ||
  Boolean(config.baseUrl.trim() && config.model.trim() && config.apiKey.trim());

export const configLabel = (config: LlmConfig) =>
  isMock(config) ? '演示模式' : isReady(config) ? config.model : '未接入';
