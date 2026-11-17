import { useEffect, useState } from 'react';
import type { LlmConfig, ProviderId } from '../types';
import { getPreset, isMock, isReady, PRESETS } from '../config/providers';
import { describeError, fetchOpenCodeModels, testConnection, type ModelOption } from '../lib/llm';
import { useDialogFocus } from '../lib/useDialogFocus';

interface Props {
  config: LlmConfig;
  notice?: string;
  onSave: (config: LlmConfig) => void;
  onClose: () => void;
}

export default function SettingsDialog({ config, notice, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<LlmConfig>({ ...config });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState('');
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [customModel, setCustomModel] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const preset = getPreset(draft.providerId);
  const isOpenCode = draft.providerId === 'opencode' || draft.providerId === 'opencode-go';
  const isGo = draft.providerId === 'opencode-go';

  useEffect(() => {
    if (!isOpenCode) return;
    const controller = new AbortController();
    fetchOpenCodeModels(isGo ? 'go' : 'console', controller.signal)
      .then(setModels)
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setModelsError(describeError(err));
      });
    return () => controller.abort();
  }, [isOpenCode, isGo]);

  const changeProvider = (id: ProviderId) => {
    if (id === draft.providerId) return;
    const next = getPreset(id);
    // 按量付费和 Go 用的是同一个 Console Key，切换时不用重贴
    const keepKey =
      (draft.providerId === 'opencode' || draft.providerId === 'opencode-go') &&
      (id === 'opencode' || id === 'opencode-go');
    setDraft({
      providerId: id,
      baseUrl: next.baseUrl,
      model: next.model,
      apiKey: keepKey ? draft.apiKey : '',
      fallbackModel: next.fallbackModel ?? '',
    });
    setResult(null);
    setError('');
    setCustomModel(false);
    setModelsError('');
    setModels(null);
  };

  const knownModel = models?.some((m) => m.id === draft.model) ?? false;
  const modelChoice = customModel || !knownModel ? '__custom' : draft.model;
  const showModelInput = !isOpenCode || !models || modelChoice === '__custom';

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setError('');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const text = await testConnection(draft, controller.signal);
      setResult({ ok: true, text });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setResult({ ok: false, text: '等了 20 秒没有响应，可能是网络或 CORS 挡住了。' });
      } else {
        setResult({ ok: false, text: describeError(err) });
      }
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  };

  const save = () => {
    if (!isReady(draft)) {
      setError('接口地址、模型名和 API Key 都要填完整。');
      return;
    }
    onSave({
      ...draft,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      fallbackModel: (draft.fallbackModel ?? '').trim(),
    });
  };

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="sheet-head">
          <div>
            <h2 id="settings-title">接入你的 API</h2>
            <p>
              {isOpenCode
                ? '密钥只留在这台浏览器；请求经本站代理转发给 opencode.ai。'
                : '请求从这台浏览器直接发给你填的服务，不经过我们的服务器。'}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {notice && <p className="notice">{notice}</p>}

        <label className="field">
          <span className="field-label">服务商</span>
          <select
            value={draft.providerId}
            onChange={(e) => changeProvider(e.target.value as ProviderId)}
            data-autofocus
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="field-hint">{preset.hint}</span>
        </label>

        {!isMock(draft) ? (
          <>
            <div className="field-grid">
              <label className={`field ${isOpenCode ? 'field-wide' : ''}`}>
                <span className="field-label">接口地址</span>
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                />
              </label>
              {!isOpenCode && (
                <label className="field">
                  <span className="field-label">模型名</span>
                  <input
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    placeholder="模型 ID"
                    spellCheck={false}
                  />
                </label>
              )}
            </div>

            {isOpenCode && (
              <label className="field">
                <span className="field-label">模型名</span>
                {models ? (
                  <select
                    value={modelChoice}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '__custom') {
                        setCustomModel(true);
                        return;
                      }
                      setCustomModel(false);
                      setDraft({ ...draft, model: value });
                    }}
                  >
                    <option value="__custom">自定义模型名…</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ·{' '}
                        {m.inputPrice > 0
                          ? `$${m.inputPrice.toFixed(2)}/$${m.outputPrice.toFixed(2)}`
                          : '免费'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    placeholder="模型 ID"
                    spellCheck={false}
                  />
                )}
                <span className="field-hint">
                  {isGo
                    ? 'Go 套餐内的模型都在这里。token 价只用来折算每月额度，不另外扣费。'
                    : '美元 / 百万 tokens，按输入价排序。免费模型只对 OpenCode 客户端开放，这里不列。'}
                  {modelsError ? ` ${modelsError}` : ''}
                </span>
              </label>
            )}

            {isOpenCode && models && showModelInput && (
              <label className="field">
                <span className="field-label">自定义模型名</span>
                <input
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="例如 glm-5.3-flash"
                  spellCheck={false}
                />
                <span className="field-hint">照抄 OpenCode 控制台里的模型 ID。</span>
              </label>
            )}

            <label className="field">
              <span className="field-label">API Key</span>
              <div className="key-row">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey(!showKey)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              <span className="field-hint">只保存在本机浏览器，不会上传。公共电脑上请勿保存。</span>
            </label>

            <label className="field">
              <span className="field-label">备用模型（可选）</span>
              <input
                value={draft.fallbackModel ?? ''}
                onChange={(e) => setDraft({ ...draft, fallbackModel: e.target.value })}
                placeholder="例如 deepseek-v4.1-flash"
                spellCheck={false}
              />
              <span className="field-hint">
                主模型空流、超时、429 或服务端失败时，用同一个接口和 Key 再试一次这个模型；留空关闭。
              </span>
            </label>
          </>
        ) : (
          <p className="mock-note">
            演示模式用本地脚本生成回帖，不消耗任何额度。接入 API 后，四位居民会由你自己的模型来扮演。
          </p>
        )}

        {result && <p className={`result ${result.ok ? 'ok' : 'bad'}`}>{result.text}</p>}
        {error && <p className="result bad">{error}</p>}

        <div className="sheet-actions">
          {!isMock(draft) && (
            <button className="btn btn-ghost" onClick={runTest} disabled={testing}>
              {testing ? '连接中…' : '测试连接'}
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save}>
            保存
          </button>
        </div>

        <p className="fineprint">
          若提示“连不上”，多半是该服务不允许浏览器直连（CORS）。可以换 DeepSeek / OpenAI，或把自建代理地址填进“接口地址”。
        </p>
      </div>
    </div>
  );
}
