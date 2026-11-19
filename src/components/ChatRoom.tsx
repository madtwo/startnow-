import { useEffect, useMemo, useRef, useState } from 'react';
import type { Identity, Message, Room } from '../types';
import Avatar from './Avatar';

interface Props {
  room: Room;
  identity: Identity;
  typingName?: string;
  busy: boolean;
  stepCount: number;
  usage: { used: number; limit: number };
  apiLabel: string;
  apiReady: boolean;
  onSend: (text: string, mentions: string[], replyTo?: string) => void;
  onOpenSteps: () => void;
  onOpenRoom: () => void;
  onOpenArchive: () => void;
  onOpenApi: () => void;
}

const clock = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? '' : `${d.getMonth() + 1}/${d.getDate()} `;
};

interface Row {
  message: Message;
  first: boolean;
  last: boolean;
  /** 要显示在上面的引用；已经引用过同一句就不重复挂 */
  quoted?: Message;
}

export default function ChatRoom({
  room,
  identity,
  typingName,
  busy,
  stepCount,
  usage,
  apiLabel,
  apiReady,
  onSend,
  onOpenSteps,
  onOpenRoom,
  onOpenArchive,
  onOpenApi,
}: Props) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string>('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of room.messages) map.set(m.id, m);
    return map;
  }, [room.messages]);

  const rows = useMemo<Row[]>(() => {
    const sorted = [...room.messages].sort((a, b) => a.at - b.at);
    const position = new Map<string, number>();
    sorted.forEach((m, i) => position.set(m.id, i));
    // 同一句被连续回复时，只在上一次引用之后隔了几条才再挂一次
    const lastShown = new Map<string, number>();
    return sorted.map((message, index) => {
      const prev = sorted[index - 1];
      const next = sorted[index + 1];
      const samePrev =
        prev && prev.kind === message.kind && prev.authorId === message.authorId && message.at - prev.at < 180_000;
      const sameNext =
        next && next.kind === message.kind && next.authorId === message.authorId && next.at - message.at < 180_000;
      let quoted: Message | undefined;
      if (message.kind === 'chat' && message.replyTo) {
        const target = position.get(message.replyTo);
        const shown = lastShown.get(message.replyTo);
        const adjacent = message.replyTo === prev?.id;
        const recentlyShown = shown !== undefined && index - shown <= 6;
        if (target !== undefined && !adjacent && !recentlyShown) {
          quoted = sorted[target];
          lastShown.set(message.replyTo, index);
        }
      }
      return { message, first: !samePrev, last: !sameNext, quoted };
    });
  }, [room.messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [room.messages.length, typingName]);

  const pending = byId.get(replyTo);
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text, mentions, replyTo || undefined);
    setDraft('');
    setReplyTo('');
    setMentions([]);
    setMentionOpen(false);
  };

  const pickMention = (id: string) => {
    setMentions((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setMentionOpen(false);
  };

  return (
    <div className="room">
      <header className="room-head">
        <div className="room-title">
          <h1>{room.title}</h1>
          <p>
            {room.cast.length} 位群友 · {room.messages.filter((m) => m.kind === 'chat').length} 条
          </p>
        </div>
        <div className="room-cast">
          {room.cast.map((p) => (
            <span key={p.id} className="room-face" title={`${p.name} · ${p.tagline}`}>
              <Avatar avatarKey={p.avatarKey} color={p.color} size="sm" />
            </span>
          ))}
        </div>
      </header>

      <div className="room-list" ref={listRef}>
        {rows.map(({ message, first, last, quoted }) => {
          if (message.kind === 'system') {
            return (
              <div key={message.id} className="msg-system">
                {message.text}
              </div>
            );
          }
          const mine = message.authorKind === 'player';
          return (
            <div
              key={message.id}
              className={`msg-row ${mine ? 'is-me' : ''} ${first ? 'is-first' : ''} ${last ? 'is-last' : ''}`}
            >
              {!mine && (
                <span className="msg-avatar">
                  {first ? (
                    <Avatar avatarKey={message.avatarKey ?? 'moon'} color={message.color} size="sm" />
                  ) : null}
                </span>
              )}
              <div className="msg-body">
                {first && (
                  <div className={`msg-meta ${mine ? 'is-me' : ''}`}>
                    <span className="msg-name" style={mine ? undefined : { color: message.color }}>
                      {message.authorName}
                    </span>
                    <span className="msg-time">
                      {dayLabel(message.at)}
                      {clock(message.at)}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className={`msg-bubble ${mine ? 'is-me' : ''}`}
                  onClick={() => setReplyTo(message.id)}
                  title="点一下：回复这条"
                >
                  {quoted && (
                    <span className="msg-quote">
                      {quoted.authorName}：{quoted.text.slice(0, 28)}
                    </span>
                  )}
                  {message.text}
                </button>
              </div>
            </div>
          );
        })}

        {typingName && (
          <div className="msg-row is-first is-last">
            <span className="msg-avatar">
              <Avatar
                avatarKey={room.cast.find((p) => p.name === typingName)?.avatarKey ?? 'moon'}
                color={room.cast.find((p) => p.name === typingName)?.color}
                size="sm"
              />
            </span>
            <div className="msg-body">
              <div className="msg-meta">
                <span className="msg-name">{typingName}</span>
              </div>
              <span className="msg-typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="corner">
        <span className="corner-usage">
          今日 {usage.used}/{usage.limit}
        </span>
        <button type="button" className="corner-btn" onClick={onOpenArchive} title="旧群聊">
          旧群聊
        </button>
        <button type="button" className="corner-btn" onClick={onOpenRoom} title="群设置">
          群设置
        </button>
        <button
          type="button"
          className={`corner-btn ${apiReady ? 'ok' : 'warn'}`}
          onClick={onOpenApi}
          title="接入你自己的 API"
        >
          {apiLabel}
        </button>
        <button type="button" className="corner-btn primary" onClick={onOpenSteps} title="下一步">
          下一步
          {stepCount > 0 && <em>{stepCount}</em>}
        </button>
      </div>

      <div className="room-compose">
        {(pending || mentions.length > 0) && (
          <div className="compose-chips">
            {pending && (
              <button type="button" className="chip-reply" onClick={() => setReplyTo('')}>
                回复 {pending.authorName} ✕
              </button>
            )}
            {mentions.map((id) => {
              const person = room.cast.find((p) => p.id === id);
              if (!person) return null;
              return (
                <button
                  type="button"
                  key={id}
                  className="chip-reply"
                  onClick={() => setMentions((prev) => prev.filter((x) => x !== id))}
                >
                  @{person.name} ✕
                </button>
              );
            })}
          </div>
        )}

        {mentionOpen && (
          <div className="mention-panel">
            {room.cast.map((p) => (
              <button type="button" key={p.id} onClick={() => pickMention(p.id)}>
                <Avatar avatarKey={p.avatarKey} color={p.color} size="xs" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="compose-row">
          <button
            type="button"
            className="compose-icon"
            onClick={() => setMentionOpen((v) => !v)}
            title="点名叫人"
          >
            @
          </button>
          <textarea
            className="compose-input"
            value={draft}
            rows={1}
            aria-label={`以 ${identity.name} 的身份说一句`}
            placeholder="在群里说一句…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="btn btn-primary compose-send" onClick={send} disabled={!draft.trim() || busy}>
            发出
          </button>
        </div>
      </div>
    </div>
  );
}
