import { useMemo, useRef, useState, type CSSProperties } from 'react';
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
  onLike: () => void;
  initialPeer?: string;
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
  onLike,
  initialPeer,
}: Props) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'comment' | 'advice'>('comment');
  const [replyTo, setReplyTo] = useState(
    initialPeer || (card.authorKind === 'persona' ? card.authorId : ''),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const closed = card.status === 'done' || card.status === 'handled';
  const isGuide = card.kind === 'guide';
  const target = personas.find((p) => p.id === replyTo);

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

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onComment(text, mode === 'advice' ? 'advice' : 'comment', replyTo);
    setDraft('');
    setMode('comment');
  };

  const pick = (peerId: string) => {
    setReplyTo(peerId);
    inputRef.current?.focus();
  };

  return (
    <article className="card-page">
      <div className="page-top">
        <button className="link" onClick={onBack}>
          ← 回去
        </button>
        <span className="page-time">
          {new Date(card.createdAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
      </div>

      <header className="page-head">
        <div className="page-author-row">
          {author ? (
            <Avatar avatarKey={author.avatarKey} color={author.color} size="sm" />
          ) : isGuide ? (
            <Avatar avatarKey="lamp" color="#c96442" size="sm" />
          ) : (
            <Avatar avatarKey={me.avatarKey} className="me" size="sm" />
          )}
          <div>
            <p className="page-author">
              {card.authorName}
              {!mine && !isGuide && <span className="thread-badge">AI</span>}
              {mine && <span className="me-badge">你</span>}
            </p>
            <p className="page-sub">{isGuide ? '论坛的说明' : author ? 'AI 同伴' : '你的卡'}</p>
          </div>
        </div>
      </header>

      {card.kind === 'brag' && <span className="brag-badge">做到了</span>}
      {card.title && <h1 className="page-title">{card.title}</h1>}
      <p className="page-text">{card.text}</p>
      {card.image && <img className="card-image" src={card.image} alt="卡里配的图" />}

      {!isGuide && card.advice && !closed && (
        <div className="advice">
          <div className="advice-head">
            <span className="advice-from">{giver ? `${giver.name} 给的下一步` : '你的下一步'}</span>
            <span className="advice-hint">做不到就再小一级</span>
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

      {!isGuide && card.note && card.status === 'noted' && (
        <div className="sticky-note">
          <span className="sticky-tag">便签 · 下一步</span>
          <p>{card.note.text}</p>
          <button className="btn btn-primary" onClick={onDone}>
            我做到了
          </button>
        </div>
      )}

      {!isGuide && (
        <div className="page-like-row">
          <button className={`like ${card.likedByMe ? 'on' : ''}`} onClick={onLike}>
            ♥ {card.likes ?? 0}
          </button>
        </div>
      )}

      {mine && !card.advice && card.arrivals.length > 0 && !closed && (
        <div className="card-actions">
          <button className="btn btn-ghost" onClick={onAdvice} disabled={busy}>
            直接要一个下一步
          </button>
        </div>
      )}

      <h2 className="page-comments-title">{card.comments.length} 条回应</h2>

      <div className="page-threads">
        {threads.length === 0 && (
          <p className="view-empty">还没有人说话。等一会儿，或者在下面先回楼主一句。</p>
        )}
        {threads.map((thread) => (
          <section
            key={thread.key}
            className={`page-thread ${replyTo === thread.key ? 'targeted' : ''}`}
            style={thread.persona ? ({ '--pc': thread.persona.color } as CSSProperties) : undefined}
          >
            {thread.persona && (
              <div className="page-thread-head">
                <Avatar avatarKey={thread.persona.avatarKey} color={thread.persona.color} size="xs" />
                <span>{thread.persona.name}</span>
                {replyTo === thread.persona.id && <em>正在回复</em>}
              </div>
            )}
            {thread.rows.map((c) => {
              const persona = personas.find((p) => p.id === c.authorId);
              const isMe = c.authorKind === 'player';
              return (
                <div
                  key={c.id}
                  className={`comment ${isMe ? 'mine' : ''} lineless clickable`}
                  onClick={() => {
                    if (thread.persona) pick(thread.persona.id);
                    else if (c.peer) pick(c.peer);
                  }}
                >
                  <div className="comment-main">
                    <span className="comment-name">
                      {isMe
                        ? '你'
                        : c.authorId === 'helper'
                          ? '论坛小助手'
                          : thread.persona
                            ? ''
                            : persona?.name}
                      {c.kind === 'advice' && <span className="advice-tag">下一步</span>}
                    </span>
                    <p className="comment-text">{c.text}</p>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {!isGuide && !closed && (
        <div className="page-composer">
          <div className="page-composer-head">
            <span className="page-composer-to">
              {target ? `给 ${target.name} 回复` : mine ? '说一句（不指定人）' : '回复楼主'}
            </span>
            {target && (
              <button className="page-composer-reset" onClick={() => setReplyTo('')}>
                {mine ? '改成自己说' : '取消指定'}
              </button>
            )}
            <button
              className={`advice-toggle ${mode === 'advice' ? 'on' : ''}`}
              onClick={() => setMode((m) => (m === 'advice' ? 'comment' : 'advice'))}
            >
              {mode === 'advice' ? '下一步中' : '给下一步'}
            </button>
          </div>
          <div className="page-composer-row">
            <input
              ref={inputRef}
              value={draft}
              placeholder={target ? `给 ${target.name} 回复…` : mine ? '说一句…' : '回复楼主…'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
            />
            <button className="foot-send" onClick={send} disabled={!draft.trim() || busy}>
              发
            </button>
          </div>
        </div>
      )}

      {isGuide && (
        <div className="page-close-row">
          <button className="btn btn-ghost" onClick={onBack}>
            知道了
          </button>
        </div>
      )}

      {mine && !closed && !isGuide && (
        <div className="page-close-row">
          <button className="btn btn-ghost" onClick={onCloseCard}>
            先这样吧
          </button>
        </div>
      )}
    </article>
  );
}
