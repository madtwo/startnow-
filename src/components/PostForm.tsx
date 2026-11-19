import { useRef } from 'react';
import type { Persona } from '../types';
import { fileToImage } from '../lib/image';
import Avatar from './Avatar';

interface Props {
  value: string;
  title: string;
  image: string;
  busy: boolean;
  ready: boolean;
  personas: Persona[];
  visionModel: string;
  captureMode: 'two-step' | 'vision-template' | 'single';
  onCaptureModeChange: (value:'two-step'|'vision-template'|'single')=>void;
  onVisionModelChange: (model: string) => void;
  onChange: (value: string) => void;
  onTitle: (value: string) => void;
  onImage: (image: string) => void;
  onSubmit: () => void;
  onOpenSettings: () => void;
}

export default function PostForm({
  value,
  title,
  image,
  busy,
  ready,
  personas,
  visionModel,
  onVisionModelChange,
  captureMode,
  onCaptureModeChange,
  onChange,
  onTitle,
  onImage,
  onSubmit,
  onOpenSettings,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    try {
      onImage(await fileToImage(file));
    } catch {
      alert('这张图读不了，换一张试试。');
    }
  };

  return (
    <section className="post-form card compose-card">
        <label className="field">
          <span className="field-label">标题（可以不写）</span>
          <input
            className="post-form-title"
            value={title}
            placeholder="比如：材料物理小测，还没背完"
            onChange={(e) => onTitle(e.target.value)}
            aria-label="标题，可以不写"
          />
        </label>

        <label className="field">
          <span className="field-label">说说你当下的困难</span>
          <textarea
            className="post-form-input"
            rows={6}
            value={value}
            placeholder="比如：明天材料物理小测，书才背到第三章。室友在打游戏，我戴着耳机也听不进去。"
            onChange={(e) => onChange(e.target.value)}
            aria-label="写下你当下的困难"
          />
        </label>

        {image && (
          <div className="post-image">
            <img src={image} alt="" />
            <button className="post-image-remove" onClick={() => onImage('')}>
              移除
            </button>
          </div>
        )}

        {image && (
          <label className="field">
            <span className="field-label">视觉识别模型（需支持图片输入）</span>
            <input
              className="post-form-title"
              value={visionModel}
              placeholder="填写已开通视觉能力的模型名称"
              onChange={(e) => onVisionModelChange(e.target.value)}
              aria-label="视觉识别模型名称"
              maxLength={160}
            />
          </label>
        )}

        {image && <label className="field">
          <span className="field-label">识别方式</span>
          <select value={captureMode} aria-label="材料识别方式"
            onChange={e=>onCaptureModeChange(e.target.value==='vision-template'?'vision-template':e.target.value==='single'?'single':'two-step')}
            style={{maxWidth:'100%'}}>
            <option value="two-step">默认：先识别，再给下一步（两次调用）</option>
            <option value="vision-template">实验：只识别一次，由本地模板给第一步</option>
            <option value="single">实验：一次生成识别和步骤（实测较慢）</option>
          </select>
        </label>}
        {image && <p className="compose-tip">目前默认使用两步模式。模板实验模式仅做一次视觉请求，不再请求文字模型；15 秒内完成仍需实测验证。</p>}
        <div className="post-form-foot">
          <div className="who">
            <span className="who-avatars">
              {personas.map((p) => (
                <span key={p.id} className="who-avatar" title={`${p.name} · ${p.tagline}`}>
                  <Avatar avatarKey={p.avatarKey} name={p.name} color={p.color} size="xs" />
                </span>
              ))}
            </span>
            <span className="who-text">
              <b>{personas.map((p) => p.name).join('、')}</b>
              <span>{personas.length} 位同伴，来不来不一定</span>
            </span>
          </div>
          <div className="post-form-actions" style={{flexWrap:'wrap',maxWidth:'100%'}}>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              hidden
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button className="btn btn-ghost" onClick={() => cameraRef.current?.click()}>
              拍一下卡住你的东西
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              选材料图片
            </button>
            {ready ? (
              <button className="btn btn-primary" disabled={(!value.trim() && !image) || busy} onClick={onSubmit}>
                放出去
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onOpenSettings}>
                先接入 API
              </button>
            )}
          </div>
        </div>

        {image && <p className="compose-tip">点击「放出去」后，图片会发送给你配置的视觉模型识别；原图保存在本地卡片中，导出存档也会包含它。请先遮住姓名、学号等隐私信息；未配置视觉模型时，仍可使用普通建议。</p>}
        <p className="compose-tip">放出去后，会有同伴来回应你。不用守着，忙完回来看看。</p>
    </section>
  );
}
