import { useMemo, useState } from 'react';
import type { Card, Comment, Identity, Persona } from '../types';
import Avatar from './Avatar';

const MIN = 60_000;

const timeLabel = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < MIN) return '刚刚';
  if (diff < 60 * MIN) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < 24 * 60 * MIN) return `${Math.floor(diff / (60 * MIN))} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const STATUS: Record<Card['status'], string> = {
  stuck: '卡住了',
  arrived: '有人来了',
  talking: '在聊',
  advised: '有办法了',
  noted: '贴着便签',
  done: '做到了',
  handled: '已处理',
};

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
}

interface Thread {
  key: string;
  persona?: Persona;
  rows: Comment[];
}

export default function CardView({
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
}: Props) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'idle' | 'comment' | 'advice'>('idle');
  const [replyTo, setReplyTo] = useState('');
  const [expanded, setExpanded] = useState(false);
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const arrived = card.arrivals
    .map((id) => personas.find((p) => p.id === id))
    .filter((p): p is Persona => Boolean(p));
  const closed = card.status === 'done' || card.status === 'handled';

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Comment[]>();
    card.comments.forEach((c) => {
      const key = c.authorKind === 'persona' ? c.authorId : c.peer ?? '_';
      map.set(key, [...(map.get(key) ?? []), c]);
    });
    return [...map.entries()].map(([key, rows]) => ({
      key,
      persona: key === '_' ? undefined : personas.find((p) => p.id === key),
      rows,
    }));
  }, [card.comments, personas]);

  const lastComment = card.comments[card.comments.length - 1];
  const defaultPeer =
    lastComment?.authorKind === 'persona'
      ? lastComment.authorId
      : card.authorKind === 'persona'
        ? card.authorId
        : arrived[0]?.id ?? '';
  const target = personas.find((p) => p.id === replyTo);

  const openCompose = (next: 'comment' | 'advice') => {
    if (!replyTo) setReplyTo(defaultPeer);
    setMode(next);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const peer = replyTo || defaultPeer;
    if (mode === 'advice' && !peer) return;
    onComment(text, mode === 'advice' ? 'advice' : 'comment', peer || undefined);
    setDraft('');
    setMode('idle');
  };

  const canAsk = mine && !card.advice && card.arrivals.length > 0 && !closed;
  const recent = card.comments.slice(-2);

  return (
    <article className={`card ${card.status === 'done' ? 'is-done' : ''}`}>
      <header className="card-head">
        {author ? (
          <Avatar avatarKey={author.avatarKey} color={author.color} size="sm" />
        ) : (
          <Avatar avatarKey={me.avatarKey} className="me" size="sm" />
        )}
        <div className="card-meta">
          <div className="card-author">
            {card.authorName}
            <span className="card-seal" aria-hidden="true">
              {(author?.name ?? '你').slice(-1)}
            </span>
            {mine && <span className="me-badge">你</span>}
          </div>
          <time className="card-time" dateTime={new Date(card.createdAt).toISOString()}>
            {timeLabel(card.createdAt)}
          </time>
        </div>
        {!mine && <span className={`card-status s-${card.status}`}>{STATUS[card.status]}</span>}
      </header>

      <div className="card-worry">
        <p className="card-text">{card.text}</p>
        {card.image && <img className="card-image" src={card.image} alt="卡里配的图" />}
        {arrived.length > 0 && (
          <div className="card-arrivals">
            <span>来过</span>
            <span className="arrival-avatars">
              {arrived.map((p) => (
                <span key={p.id} title={p.name}>
                  <Avatar avatarKey={p.avatarKey} color={p.color} size="xs" />
                </span>
              ))}
            </span>
          </div>
        )}

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
            {!mine && card.advice.accepted && <span className="advice-note">TA 说会试试</span>}
          </div>
        )}

        {card.note && card.status === 'noted' && (
          <div className="sticky-note">
            <span className="sticky-tag">便签</span>
            <p>{card.note.text}</p>
            <span className="sticky-hint">24 小时内没做，它就自己消失</span>
            <button className="btn btn-primary" onClick={onDone}>
              我做到了
            </button>
          </div>
        )}

        {(canAsk || (mine && !closed)) && (
          <div className="card-actions">
            {canAsk && (
              <button className="btn btn-ghost" onClick={onAdvice} disabled={busy}>
                直接给我个办法
              </button>
            )}
            {mine && !closed && (
              <button className="btn btn-ghost" onClick={onCloseCard}>
                先这样吧
              </button>
            )}
          </div>
        )}
      </div>

      <div className="card-foot">
        <div className="foot-comments">
          {recent.length === 0 && <span className="foot-empty">还没有人说话</span>}
          {!expanded &&
            recent.map((c) => {
              const persona = personas.find((p) => p.id === c.authorId);
              const isMe = c.authorKind === 'player';
              return (
                <div key={c.id} className="foot-comment">
                  <span className="foot-who">{isMe ? '你' : persona?.name}</span>
                  <span className="foot-text">{c.text}</span>
                  <span className="foot-time">{timeLabel(c.at)}</span>
                </div>
              );
            })}
          {expanded &&
            threads.map((thread) => (
              <div key={thread.key} className="foot-thread">
                <div className="foot-thread-head">
                  {thread.persona && (
                    <>
                      <Avatar
                        avatarKey={thread.persona.avatarKey}
                        color={thread.persona.color}
                        size="xs"
                      />
                      <span>{thread.persona.name}</span>
                    </>
                  )}
                  {thread.persona && !closed && (
                    <button
                      className="thread-reply"
                      onClick={() => {
                        setReplyTo(thread.persona!.id);
                        setMode('comment');
                      }}
                    >
                      回复
                    </button>
                  )}
                </div>
                {thread.rows.map((c) => (
                  <div key={c.id} className="foot-comment">
                    <span className="foot-who">
                      {c.authorKind === 'player' ? '你' : thread.persona?.name}
                    </span>
                    <span className="foot-text">
                      {c.kind === 'advice' ? `建议：${c.text}` : c.text}
                    </span>
                    <span className="foot-time">{timeLabel(c.at)}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>

        {card.comments.length > 2 && (
          <button className="foot-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : `全部 ${card.comments.length} 条`}
          </button>
        )}

        {!closed && (
          <div className="foot-actions">
            {mode === 'idle' ? (
              <>
                <button className="foot-btn" onClick={() => openCompose('comment')}>
                  回一句
                </button>
                <button className="foot-btn" onClick={() => openCompose('advice')}>
                  给出建议
                </button>
                <span className="foot-peer">
                  {target ? `回复 ${target.name}` : '默认回最后说话的人'}
                </span>
              </>
            ) : (
              <>
                <span className="foot-peer">
                  {mode === 'advice' ? '给建议' : '回复'} {target?.name ?? '…'}
                </span>
                <input
                  autoFocus
                  value={draft}
                  placeholder={mode === 'advice' ? '想让他试试什么？' : '说一句'}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') send();
                    if (e.key === 'Escape') setMode('idle');
                  }}
                />
                <button className="foot-send" onClick={send} disabled={!draft.trim() || busy}>
                  发送
                </button>
                <button className="foot-cancel" onClick={() => setMode('idle')}>
                  ×
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
