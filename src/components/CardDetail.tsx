import { useMemo, useState } from 'react';
import type { Card, Comment, Identity, Persona } from '../types';
import Avatar from './Avatar';

interface Props {
  card: Card;
  me: Identity;
  personas: Persona[];
  busy: boolean;
  onComment: (text: string, kind: 'comment' | 'advice', peer?: string) => void;
  onAdvice: () => void;
  onShrink: () => void;
  onAccept: () => void;
  onDone: () => void;
  onCloseCard: () => void;
  onBack: () => void;
}

interface Thread {
  key: string;
  persona?: Persona;
  rows: Comment[];
}

export default function CardDetail({
  card,
  me,
  personas,
  busy,
  onComment,
  onAdvice,
  onShrink,
  onAccept,
  onDone,
  onCloseCard,
  onBack,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, 'comment' | 'advice'>>({});
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const closed = card.status === 'done' || card.status === 'handled';

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Comment[]>();
    card.comments.forEach((c) => {
      const key = c.authorKind === 'persona' ? c.authorId : c.peer ?? '_';
      map.set(key, [...(map.get(key) ?? []), c]);
    });
    const rows = [...map.entries()].map(([key, list]) => ({
      key,
      persona: key === '_' ? undefined : personas.find((p) => p.id === key),
      rows: list,
    }));
    card.arrivals.forEach((id) => {
      if (!rows.some((t) => t.key === id)) {
        const persona = personas.find((p) => p.id === id);
        if (persona) rows.push({ key: id, persona, rows: [] });
      }
    });
    return rows;
  }, [card, personas]);

  const send = (threadKey: string) => {
    const text = (drafts[threadKey] ?? '').trim();
    if (!text || busy) return;
    onComment(text, modes[threadKey] ?? 'comment', threadKey);
    setDrafts((prev) => ({ ...prev, [threadKey]: '' }));
    setModes((prev) => ({ ...prev, [threadKey]: 'comment' }));
  };

  return (
    <article className="card-page">
      <div className="page-top">
        <button className="link" onClick={onBack}>
          ← 回到列表
        </button>
        <span className="page-time">
          {new Date(card.createdAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
      </div>

      <header className="page-head">
        <div className="page-author-row">
          {author ? (
            <Avatar avatarKey={author.avatarKey} color={author.color} size="sm" />
          ) : (
            <Avatar avatarKey={me.avatarKey} className="me" size="sm" />
          )}
          <div>
            <p className="page-author">
              {card.authorName}
              {!mine && <span className="thread-badge">AI</span>}
              {mine && <span className="me-badge">你</span>}
            </p>
            <p className="page-sub">{author ? `${author.tagline} · ${author.cohort}` : '一张卡'}</p>
          </div>
        </div>
      </header>

      {card.title && <h1 className="page-title">{card.title}</h1>}
      <p className="page-text">{card.text}</p>
      {card.image && <img className="card-image" src={card.image} alt="卡里配的图" />}

      {card.advice && !closed && (
        <div className="advice">
          <div className="advice-head">
            <span className="advice-from">{giver ? `${giver.name}的办法` : '你的建议'}</span>
          </div>
          <p className="advice-label">{card.advice.text}</p>
          {mine && !card.advice.accepted && (
            <div className="advice-actions">
              <button className="btn btn-ghost" onClick={onShrink}>
                做不到
              </button>
              <button className="btn btn-primary" onClick={onAccept}>
                贴到便签
              </button>
            </div>
          )}
        </div>
      )}

      {card.note && card.status === 'noted' && (
        <div className="sticky-note">
          <span className="sticky-tag">便签</span>
          <p>{card.note.text}</p>
          <button className="btn btn-primary" onClick={onDone}>
            我做到了
          </button>
        </div>
      )}

      {mine && !card.advice && card.arrivals.length > 0 && !closed && (
        <div className="card-actions">
          <button className="btn btn-ghost" onClick={onAdvice} disabled={busy}>
            直接给我个办法
          </button>
        </div>
      )}

      <h2 className="page-comments-title">{card.comments.length} 条回应</h2>

      <div className="page-threads">
        {threads.length === 0 && <p className="view-empty">还没有人说话。等一会儿，或者先回一句。</p>}
        {threads.map((thread) => (
          <section key={thread.key} className="page-thread">
            {thread.persona && (
              <div className="page-thread-head">
                <Avatar avatarKey={thread.persona.avatarKey} color={thread.persona.color} size="xs" />
                <span>{thread.persona.name}</span>
                <em>{thread.persona.tagline}</em>
              </div>
            )}
            {thread.rows.map((c) => {
              const persona = personas.find((p) => p.id === c.authorId);
              const isMe = c.authorKind === 'player';
              return (
                <div key={c.id} className={`comment ${isMe ? 'mine' : ''} lineless`}>
                  <div className="comment-main">
                    <span className="comment-name">
                      {isMe ? '你' : thread.persona ? '' : persona?.name}
                      {c.kind === 'advice' && <span className="advice-tag">建议</span>}
                    </span>
                    <p className="comment-text">{c.text}</p>
                  </div>
                </div>
              );
            })}
            {!closed && thread.persona && (
              <div className="page-reply">
                <button
                  className={`advice-toggle ${modes[thread.key] === 'advice' ? 'on' : ''}`}
                  onClick={() =>
                    setModes((prev) => ({
                      ...prev,
                      [thread.key]: prev[thread.key] === 'advice' ? 'comment' : 'advice',
                    }))
                  }
                >
                  {modes[thread.key] === 'advice' ? '建议中' : '给建议'}
                </button>
                <input
                  value={drafts[thread.key] ?? ''}
                  placeholder={`回 ${thread.persona.name} 一句`}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [thread.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') send(thread.key);
                  }}
                />
                <button
                  className="foot-send"
                  onClick={() => send(thread.key)}
                  disabled={!(drafts[thread.key] ?? '').trim() || busy}
                >
                  发
                </button>
              </div>
            )}
          </section>
        ))}
      </div>

      {mine && !closed && (
        <div className="page-close-row">
          <button className="btn btn-ghost" onClick={onCloseCard}>
            先这样吧
          </button>
        </div>
      )}
    </article>
  );
}
