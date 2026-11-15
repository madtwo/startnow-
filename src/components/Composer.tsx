import type { CSSProperties, KeyboardEvent } from 'react';
import { personas } from '../lib/personas';

interface Props {
  value: string;
  busy: boolean;
  ready: boolean;
  label: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

export default function Composer({
  value,
  busy,
  ready,
  label,
  onChange,
  onSubmit,
  onStop,
  onOpenSettings,
}: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!busy && value.trim()) onSubmit();
    }
  };

  return (
    <section className="composer">
      <textarea
        className="composer-input"
        value={value}
        rows={3}
        placeholder="比如：明天要交的东西一点没动，但我就是坐不下来……"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="写下你想说的话"
      />
      <div className="composer-foot">
        <div className="who">
          <span className="who-avatars">
            {personas.map((p) => (
              <span
                key={p.id}
                className="avatar mini"
                style={{ '--pc': p.color } as CSSProperties}
                title={`${p.name} · ${p.tagline}`}
              >
                {p.avatar}
              </span>
            ))}
          </span>
          <span className="who-text">4 位 AI 居民会看到</span>
        </div>

        <div className="composer-actions">
          {ready ? (
            <span className="mini-status ok" title="当前模型">
              {label}
            </span>
          ) : (
            <button className="mini-status warn" onClick={onOpenSettings}>
              未接入 API · 去设置
            </button>
          )}
          {busy ? (
            <button className="btn btn-ghost" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!value.trim()} onClick={onSubmit}>
              发出去
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
