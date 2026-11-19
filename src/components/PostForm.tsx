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
  onChange,
  onTitle,
  onImage,
  onSubmit,
  onOpenSettings,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);

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
          <div className="post-form-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              加一张图
            </button>
            {ready ? (
              <button className="btn btn-primary" disabled={!value.trim() || busy} onClick={onSubmit}>
                放出去
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onOpenSettings}>
                先接入 API
              </button>
            )}
          </div>
        </div>

        <p className="compose-tip">放出去后，会有 AI 同伴来回应你。不用守着，忙完回来看看。</p>
    </section>
  );
}
