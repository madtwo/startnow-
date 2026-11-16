import { useMemo, useState } from 'react';
import type { Card, Identity, Persona } from '../types';
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

const dayLabel = (ts: number) => {
  const diff = Math.floor((Date.now() - ts) / 86_400_000);
  if (diff <= 0) {
    const d = new Date(ts);
    return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
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
  onOpenDetail: () => void;
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
  onOpenDetail,
}: Props) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'idle' | 'comment' | 'advice'>('idle');
  const [replyTo, setReplyTo] = useState('');
  const [picking, setPicking] = useState(false);
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const closed = card.status === 'done' || card.status === 'handled';

  const participants = useMemo<Persona[]>(() => {
    const ids = new Set<string>();
    card.arrivals.forEach((id) => ids.add(id));
    card.comments.forEach((c) => {
      if (c.authorKind === 'persona') ids.add(c.authorId);
      else if (c.peer) ids.add(c.peer);
    });
    if (card.authorKind === 'persona') ids.add(card.authorId);
    return [...ids].map((id) => personas.find((p) => p.id === id)).filter((p): p is Persona => Boolean(p));
  }, [card, personas]);

  const target = personas.find((p) => p.id === replyTo);
  const recent = card.comments.slice(-2);
  const canAsk = mine && !card.advice && card.arrivals.length > 0 && !closed;

  const choose = (peerId: string, next: 'comment' | 'advice') => {
    setReplyTo(peerId);
    setPicking(false);
    setMode(next);
  };

  const start = (next: 'comment' | 'advice') => {
    if (participants.length === 1) choose(participants[0].id, next);
    else if (participants.length > 1) setPicking(true);
    else if (participants.length === 0 && card.authorKind === 'persona') choose(card.authorId, next);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !replyTo) return;
    onComment(text, mode === 'advice' ? 'advice' : 'comment', replyTo);
    setDraft('');
    setMode('idle');
  };

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

      <button className="card-worry" onClick={onOpenDetail} title="点开看全部对话">
        <span className="worry-watermark" aria-hidden="true">
          {(author?.name ?? '我').slice(-1)}
        </span>
        <span className="worry-side" aria-hidden="true">
          {author?.name ?? '我'} · {dayLabel(card.createdAt)}
        </span>
        <span className="worry-mark">{author ? author.major || '这里' : '我的卡'}</span>
        <p
          className="card-text"
          style={{
            fontSize: `calc(${card.text.length <= 24 ? 30 : card.text.length <= 48 ? 25 : 21}px * var(--site-type, 1))`,
          }}
        >
          {card.text}
        </p>
        {card.image && <img className="card-image" src={card.image} alt="卡里配的图" />}
        <span className="worry-foot">
          <span>
            {dayLabel(card.createdAt)} · {author ? `${author.major} ${author.cohort}` : '你写的'}
          </span>
          <span className="worry-open">点开看全部 →</span>
        </span>
      </button>

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
          <button className="btn btn-primary" onClick={onDone}>
            我做到了
          </button>
        </div>
      )}

      {canAsk && (
        <div className="card-actions">
          <button className="btn btn-ghost" onClick={onAdvice} disabled={busy}>
            直接给我个办法
          </button>
          <button className="btn btn-ghost" onClick={onCloseCard}>
            先这样吧
          </button>
        </div>
      )}

      <div className="card-foot">
        <div className="foot-comments">
          {recent.length === 0 && <span className="foot-empty">还没有人说话</span>}
          {recent.map((c) => {
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
          {card.comments.length > 2 && (
            <button className="foot-more" onClick={onOpenDetail}>
              共 {card.comments.length} 条 · 点开看全部
            </button>
          )}
        </div>

        {picking && (
          <div className="peer-picker">
            <span>回复谁</span>
            {participants.map((p) => (
              <button key={p.id} onClick={() => choose(p.id, mode === 'advice' ? 'advice' : 'comment')}>
                {p.name}
              </button>
            ))}
            <button className="peer-cancel" onClick={() => setPicking(false)}>
              算了
            </button>
          </div>
        )}

        {!closed && !picking && (
          <div className="foot-actions">
            {mode === 'idle' ? (
              <>
                <button className="foot-btn" onClick={() => start('comment')}>
                  回一句
                </button>
                <button className="foot-btn" onClick={() => start('advice')}>
                  给出建议
                </button>
                <span className="foot-peer">
                  {target ? `回复 ${target.name}` : '选一个人再回'}
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
