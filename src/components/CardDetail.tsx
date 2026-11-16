import { useRef, useState, type CSSProperties } from 'react';
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

const originLabels: Record<NonNullable<Comment['origin']>, string> = {
  model: '模型回复', demo: '演示台词', boundary: '线上边界', curated: '预置回复',
  simulated: '模拟情节', system: '系统提示',
};

const clock = (at: number) => {
  const date = new Date(at);
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${time}`;
};

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
  const defaultTarget = card.authorKind === 'persona' ? card.authorId : '';
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'comment' | 'advice'>('comment');
  const [targetId, setTargetId] = useState(initialPeer || defaultTarget);
  const [targetComment, setTargetComment] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const closed = card.status === 'done' || card.status === 'handled';
  const isGuide = card.kind === 'guide';
  const target = personas.find((p) => p.id === targetId);
  const targetIsOp = Boolean(targetId) && targetId === card.authorId;
  const replyLabel = targetId
    ? targetIsOp
      ? '回复楼主'
      : `回复：${target?.name ?? '对方'}`
    : mine
      ? '说点什么'
      : '回复楼主';

  const peerName = (id?: string) => {
    if (!id) return '';
    if (id === 'me') return '你';
    if (id === 'helper') return '论坛小助手';
    return personas.find((p) => p.id === id)?.name ?? '对方';
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onComment(text, mode === 'advice' ? 'advice' : 'comment', targetId);
    setDraft('');
    setMode('comment');
    setTargetComment('');
  };

  const pick = (comment: Comment) => {
    if (comment.authorKind !== 'persona') return;
    setTargetId(comment.authorId);
    setTargetComment(comment.id);
    inputRef.current?.focus();
  };

  const resetTarget = () => {
    setTargetId(defaultTarget);
    setTargetComment('');
    inputRef.current?.focus();
  };

  return (
    <article className={`card-page ${!isGuide && !closed ? 'has-composer' : ''}`}>
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
              {card.origin && (
                <span className="thread-badge">{card.origin === 'model' ? '模型生成' : card.origin === 'simulated' ? '模拟情节' : '演示内容'}</span>
              )}
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
          {card.advice.origin && <small>{card.advice.origin === 'demo' ? '演示动作' : '预置动作'}</small>}
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

      <div className="forum-comments">
        {card.comments.length === 0 && (
          <p className="view-empty">还没有人说话。等一会儿，或者在下面先回楼主一句。</p>
        )}
        {card.comments.map((comment) => {
          const persona = personas.find((p) => p.id === comment.authorId);
          const isMe = comment.authorKind === 'player';
          const isHelper = comment.authorKind === 'helper';
          const selected = targetComment === comment.id;
          const repliedTo =
            comment.peer && comment.peer !== card.authorId ? peerName(comment.peer) : '';
          const pc = persona?.color ?? (isMe ? '#c96442' : 'var(--warm-silver)');
          return (
            <div
              key={comment.id}
              className={`forum-comment ${isMe ? 'mine' : ''} ${isHelper ? 'helper' : ''} ${
                selected ? 'selected' : ''
              }`}
              style={{ '--pc': pc } as CSSProperties}
              role={persona ? 'button' : undefined}
              tabIndex={persona ? 0 : undefined}
              onClick={() => pick(comment)}
              onKeyDown={(e) => {
                if (persona && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  pick(comment);
                }
              }}
            >
              <div className="forum-comment-head">
                {persona ? (
                  <Avatar avatarKey={persona.avatarKey} color={persona.color} size="xs" />
                ) : isHelper ? (
                  <Avatar avatarKey="lamp" color="#c96442" size="xs" />
                ) : (
                  <Avatar avatarKey={me.avatarKey} className="me" size="xs" />
                )}
                <span className="forum-comment-name">
                  {isMe ? '你' : isHelper ? '论坛小助手' : persona?.name ?? 'AI 同伴'}
                </span>
                <span className="forum-comment-time">{clock(comment.at)}</span>
                {repliedTo && <span className="forum-comment-reply">回复 {repliedTo}</span>}
                {comment.kind === 'advice' && <span className="advice-tag">下一步</span>}
                {comment.origin && originLabels[comment.origin] && (
                  <span className="advice-tag">{originLabels[comment.origin]}</span>
                )}
                {selected && <span className="forum-comment-target">正在回复</span>}
              </div>
              <p className="forum-comment-text">{comment.text}</p>
            </div>
          );
        })}
      </div>

      {!isGuide && !closed && (
        <div className="page-composer">
          <div className="page-composer-head">
            <span className="page-composer-to">{replyLabel}</span>
            {!targetIsOp && targetId && (
              <button className="page-composer-reset" onClick={resetTarget}>
                {mine ? '不指定人' : '回到楼主'}
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
              placeholder={
                targetId
                  ? targetIsOp
                    ? '回复楼主…'
                    : `回复 ${target?.name ?? '对方'}…`
                  : mine
                    ? '说一句…'
                    : '回复楼主…'
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
            />
            <button className="foot-send" onClick={send} disabled={!draft.trim() || busy}>
              发
            </button>
          </div>
          {!mine && (
            <p className="page-composer-note">你只是递一句，接不接、做不做，是他们自己的事。</p>
          )}
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
