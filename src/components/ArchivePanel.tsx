import { useMemo, useState } from 'react';
import type { Message, Room } from '../types';
import Avatar from './Avatar';

interface Props {
  archives: Room[];
  onClose: () => void;
  /** 把这个房间放回当下（当前房间会被换进存档） */
  onRestore: (id: string) => void;
  /** 显式舍弃，不自动发生 */
  onDiscard: (id: string) => void;
}

const stamp = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
};

const clock = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function ArchivePanel({ archives, onClose, onRestore, onDiscard }: Props) {
  const [activeId, setActiveId] = useState<string>(archives[0]?.id ?? '');
  const active = archives.find((r) => r.id === activeId) ?? archives[0];

  const rows = useMemo(() => {
    if (!active) return [] as Message[];
    return [...active.messages].filter((m) => m.kind === 'chat').sort((a, b) => a.at - b.at);
  }, [active]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>旧群聊</h2>
          <p>可以把其中一个放回当下，也可以舍弃。放着不动就不会消失。</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      {archives.length === 0 && (
        <p className="panel-empty">还没有旧群聊。换一批群友之后，这里会有记录。</p>
      )}

      {archives.length > 0 && (
        <>
          <div className="archive-tabs">
            {archives.map((room) => (
              <button
                key={room.id}
                type="button"
                className={`archive-tab ${active?.id === room.id ? 'on' : ''}`}
                onClick={() => setActiveId(room.id)}
              >
                <span>{room.title}</span>
                <em>{stamp(room.archivedAt ?? room.createdAt)}</em>
              </button>
            ))}
          </div>

          {active && (
            <>
              <div className="archive-cast">
                {active.cast.map((p) => (
                  <span key={p.id} className="archive-face" title={p.name}>
                    <Avatar avatarKey={p.avatarKey} color={p.color} size="xs" />
                    <em>{p.name}</em>
                  </span>
                ))}
              </div>

              <div className="archive-actions">
                <button type="button" className="btn btn-primary panel-wide" onClick={() => onRestore(active.id)}>
                  放回当下
                </button>
                <button type="button" className="btn btn-ghost panel-wide" onClick={() => onDiscard(active.id)}>
                  舍弃这个群聊
                </button>
                <p className="panel-hint">
                  「放回当下」会把现在的房间换进这里，两边都不会丢；舍弃是永久的，没有撤回。
                </p>
              </div>

              <div className="archive-list">
                {rows.length === 0 && <p className="panel-empty">这个房间里没有留下对话。</p>}
                {rows.map((m) => (
                  <div key={m.id} className={`archive-row ${m.authorKind === 'player' ? 'is-me' : ''}`}>
                    <span className="archive-time">{clock(m.at)}</span>
                    <span className="archive-name" style={{ color: m.color }}>
                      {m.authorName}
                    </span>
                    <span className="archive-text">{m.text}</span>
                  </div>
                ))}
              </div>

              <p className="panel-foot">放回当下之后，这几个人会接着跟你聊。</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
