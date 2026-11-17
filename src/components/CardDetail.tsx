import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Card, Comment, Identity, Persona } from '../types';
import Avatar from './Avatar';
import { isHelpSeekingAction } from '../lib/support';
import { latestCommentId, orderThreadComments } from '../lib/threading';
import { isCommentInView, keyboardLift, scrollDeltaForComment } from '../lib/threadViewport';

interface Props {
  card: Card;
  me: Identity;
  personas: Persona[];
  busy: boolean;
  onComment: (text: string, kind: 'comment' | 'advice', peer?: string, replyTo?: string) => boolean;
  onAdvice: (personaId?: string) => void;
  onAdoptAdvice: (commentId: string) => void;
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
  onAdoptAdvice,
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
  const articleRef = useRef<HTMLElement | null>(null);
  const commentsRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const pendingOwnScroll = useRef<Set<string> | null>(null);
  const initialJumpDone = useRef(false);
  const normalViewportHeight = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const ordered = useMemo(() => orderThreadComments(card.comments), [card.comments]);
  const latestId = latestCommentId(card.comments);
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
    // Remember existing IDs, so a synchronous model reply cannot masquerade as our send.
    pendingOwnScroll.current = new Set(card.comments.map((row) => row.id));
    const accepted = onComment(
      text,
      mode === 'advice' ? 'advice' : 'comment',
      targetId,
      targetComment || undefined,
    );
    if (!accepted) {
      pendingOwnScroll.current = null;
      return; // Crisis gate: keep the unsent draft rather than pretending it was posted.
    }
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

  const findCommentNode = (id?: string): HTMLElement | undefined => {
    if (!id || !commentsRef.current) return undefined;
    return [...commentsRef.current.querySelectorAll<HTMLElement>('[data-comment-id]')]
      .find((element) => element.dataset.commentId === id);
  };

  const visibleBounds = (): { top: number; bottom: number } => {
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const headerBottom = document.querySelector<HTMLElement>('.top')?.getBoundingClientRect().bottom ?? 0;
    const composerTop = composerRef.current?.getBoundingClientRect().top ?? viewportBottom;
    return {
      top: Math.max(viewportTop, headerBottom) + 12,
      bottom: Math.min(viewportBottom, composerTop) - 16,
    };
  };

  const scrollToComment = (id?: string, smooth = true) => {
    const element = findCommentNode(id);
    if (!element) return;
    const { top, bottom } = visibleBounds();
    const rect = element.getBoundingClientRect();
    const delta = scrollDeltaForComment(rect, top, bottom);
    if (Math.abs(delta) > 2) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollBy({ top: delta, behavior: smooth && !reduceMotion ? 'smooth' : 'instant' });
    }
  };

  const updateLatestVisibility = () => {
    const element = findCommentNode(latestId);
    if (!element) {
      setShowLatest(false);
      return;
    }
    const { top, bottom } = visibleBounds();
    setShowLatest(!isCommentInView(element.getBoundingClientRect(), top, bottom));
  };

  // Long threads open near the latest reply; short ones keep the card intro.
  // New AI messages only update the jump button; they never steal scroll while reading.
  useLayoutEffect(() => {
    if (!initialJumpDone.current) {
      initialJumpDone.current = true;
      if (card.comments.length >= 4) scrollToComment(latestId, false);
    }
    const sentIds = pendingOwnScroll.current;
    if (sentIds) {
      const own = [...card.comments].reverse().find(
        (row) => row.authorKind === 'player' && !sentIds.has(row.id),
      );
      if (own) {
        pendingOwnScroll.current = null;
        scrollToComment(own.id, true);
      }
    }
    updateLatestVisibility();
  }, [card.id, card.comments]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const composer = composerRef.current;
      root.style.setProperty(
        '--composer-height',
        `${Math.ceil(composer?.getBoundingClientRect().height ?? 130)}px`,
      );
      const focused = document.activeElement === inputRef.current;
      if (!focused) normalViewportHeight.current = window.innerHeight;
      const baseline = normalViewportHeight.current || window.innerHeight;
      const visualBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const lifted = keyboardLift(window.innerHeight, visualBottom, focused);
      const keyboardOpen = focused && (lifted > 0 ||
        (viewport?.scale ?? 1) === 1 && baseline - (viewport?.height ?? window.innerHeight) >= 140);
      root.style.setProperty('--keyboard-lift', `${lifted}px`);
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
      document.body.classList.toggle('card-forum-keyboard-open', keyboardOpen);
      updateLatestVisibility();
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null;
    if (composerRef.current) observer?.observe(composerRef.current);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('focusin', scheduleUpdate);
    window.addEventListener('focusout', scheduleUpdate);
    viewport?.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('scroll', scheduleUpdate);
    update();
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('card-forum-keyboard-open');
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('focusin', scheduleUpdate);
      window.removeEventListener('focusout', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, [card.id, latestId]);

  const renderComment = ({ comment, parent, visualDepth }: (typeof ordered)[number]) => {
    const persona = personas.find((p) => p.id === comment.authorId);
    const isMe = comment.authorKind === 'player';
    const isHelper = comment.authorKind === 'helper';
    const selected = targetComment === comment.id;
    const repliedTo = parent
      ? parent.authorKind === 'player' ? '你' : peerName(parent.authorId)
      : comment.peer && comment.peer !== card.authorId ? peerName(comment.peer) : '';
    const pc = persona?.color ?? (isMe ? '#c96442' : 'var(--warm-silver)');
    const adoptable = mine && !isGuide && !closed && card.status !== 'noted' &&
      !card.advice?.accepted && comment.authorKind === 'persona' &&
      comment.origin !== 'boundary' && comment.origin !== 'system' && Boolean(persona);
    return (
      <div className={`forum-thread forum-depth-${visualDepth}`} key={comment.id} data-depth={visualDepth}>
        <div
          className={`forum-comment ${isMe ? 'mine' : ''} ${isHelper ? 'helper' : ''} ${
            selected ? 'selected' : ''
          }`}
          style={{ '--pc': pc } as CSSProperties}
          data-comment-id={comment.id}
          role={persona ? 'button' : undefined}
          tabIndex={persona ? 0 : undefined}
          aria-label={persona ? `回复 ${persona.name}` : undefined}
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
              <Avatar avatarKey={persona.avatarKey} name={persona.name} color={persona.color} size="xs" />
            ) : isHelper ? (
              <Avatar avatarKey="lamp" color="#c96442" size="xs" />
            ) : (
              <Avatar avatarKey={me.avatarKey} className="me" size="xs" />
            )}
            <span className="forum-comment-name">
              {isMe ? '你' : isHelper ? '论坛小助手' : persona?.name ?? 'AI 同伴'}
            </span>
            {comment.authorKind === 'persona' && <span className="thread-badge" title="虚构 AI 同伴，非真人、非心理咨询师">AI</span>}
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
        {adoptable && (
          <div className="forum-comment-actions">
            <button
              type="button"
              className="forum-adopt"
              disabled={busy || card.advice?.sourceCommentId === comment.id}
              onClick={() => onAdoptAdvice(comment.id)}
            >
              {card.advice?.sourceCommentId === comment.id ? '已采用为下一步' : '用这条作为下一步'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <article ref={articleRef} className={`card-page ${!isGuide && !closed ? 'has-composer' : ''}`}>
      <div className="page-top">
        <button className="link breadcrumb" onClick={onBack}>
          ← 返回
        </button>
        <span className="page-time">
          {new Date(card.createdAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
      </div>

      <header className="detail-head">
        <div className="page-author-row">
          {author ? (
            <Avatar avatarKey={author.avatarKey} name={author.name} color={author.color} size="sm" />
          ) : isGuide ? (
            <Avatar avatarKey="lamp" color="#c96442" size="sm" />
          ) : (
            <Avatar avatarKey={me.avatarKey} className="me" size="sm" />
          )}
          <div>
            <p className="page-author">
              {card.authorName}
              {!mine && !isGuide && <span className="thread-badge">AI</span>}
              {card.intro && <span className="thread-badge">自我介绍</span>}
              {card.origin && (
                <span className="thread-badge">{card.origin === 'model' ? '模型生成' : card.origin === 'simulated' ? '模拟情节' : '演示内容'}</span>
              )}
              {mine && <span className="me-badge">你</span>}
            </p>
            <p className="detail-role">{isGuide ? '论坛的说明' : author ? 'AI 同伴' : '你的卡'}</p>
          </div>
        </div>
      </header>

      {card.kind === 'brag' && <span className="brag-badge">做到了</span>}
      {card.title && <h1 className="detail-title">{card.title}</h1>}
      <p className="page-text">{card.text}</p>
      {card.image && <img className="card-image" src={card.image} alt="卡片配图" />}

      {!isGuide && card.advice && !closed && (
        <div className="advice">
          <div className="advice-head">
            <span className="advice-from">
              {card.advice.sourceCommentId && giver
                ? `你从${giver.name}的回复采用`
                : giver
                  ? `${giver.name} 给的下一步`
                  : '你的下一步'}
            </span>
            <span className="advice-hint">
              {card.advice.actionId ? '做不到就再小一级' : '原话采用 · 暂无自动缩小'}
            </span>
          </div>
          <p className="advice-label">{card.advice.text}</p>
          {isHelpSeekingAction(card.advice.actionId) && (
            <p className="page-composer-note" role="note">
              这是联系真人支持的准备步骤，不是诊断或治疗建议；如感到自己有即时危险，请联系身边的人和当地紧急服务。
            </p>
          )}
          {card.advice.origin && (
            <small>
              {card.advice.origin === 'adopted'
                ? '由你采用 · 保留评论原话'
                : card.advice.origin === 'demo'
                  ? '演示动作'
                  : '预置动作'}
            </small>
          )}
          {card.advice.sourceCommentId && (
            <button
              type="button"
              className="advice-source-link"
              onClick={() => scrollToComment(card.advice?.sourceCommentId)}
            >
              查看原回复
            </button>
          )}
          {mine && !card.advice.accepted && (
            <div className="advice-actions">
              <button className="btn btn-ghost" onClick={onShrink} disabled={!card.advice.actionId}>
                做不到
              </button>
              <button className="btn btn-primary" onClick={onAccept}>
                贴到便签
              </button>
            </div>
          )}
          {mine && !card.advice.accepted && !card.advice.actionId && (
            <p className="page-composer-note">
              这条是回复原文，没有可自动缩小的动作链。若太难，可以继续回复她，请她说一个更小的步骤。
            </p>
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
          <button className="btn btn-ghost" onClick={() => onAdvice(targetId || undefined)} disabled={busy}>
            直接要一个下一步
          </button>
        </div>
      )}

      <h2 className="page-comments-title">{card.comments.length} 条回应</h2>
      {!isGuide && <p className="page-composer-note">这里的 AI 同伴是虚构角色，不是真人，也不能替代专业帮助。</p>}

      <div className="forum-comments" ref={commentsRef}>
        {card.comments.length === 0 && (
          <p className="view-empty">还没有人说话。等一会儿，或者在下面先回楼主一句。</p>
        )}
        {ordered.map(renderComment)}
      </div>

      {latestId && showLatest && (
        <button type="button" className="forum-jump-latest" onClick={() => scrollToComment(latestId)}>
          ↓ 回到最新
        </button>
      )}

      {!isGuide && !closed && (
        <div className="page-composer" ref={composerRef}>
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
