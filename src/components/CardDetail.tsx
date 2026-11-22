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
import { canRequestSmallerComment } from '../lib/freeTextShrink';
import { latestCommentId, orderThreadComments } from '../lib/threading';
import { isCommentInView, keyboardLift, scrollDeltaForComment } from '../lib/threadViewport';
import { parseMaterialDeadline, confirmedDeadline, deadlineInputValue } from '../lib/deadline';
import { canUseNextStep, isActionableStepText } from '../lib/cardPolicy';

interface Props {
  card: Card;
  me: Identity;
  personas: Persona[];
  busy: boolean;
  onComment: (text: string, kind: 'comment' | 'advice', peer?: string, replyTo?: string) => boolean;
  onAdvice: (personaId?: string) => void;
  onAdoptAdvice: (commentId: string) => void;
  onShrink: () => void;
  onRequestSmaller: () => void;
  onAccept: () => void;
  onDone: () => void;
  onCloseCard: () => void;
  onBack: () => void;
  onLike: () => void;
  onCheer?: () => void;
  onReidentify?: () => void;
  onCancelMaterial?: () => void;
  onConfirmDeadline?: (value:string) => void;
  initialPeer?: string;
}

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
  onRequestSmaller,
  onAccept,
  onDone,
  onCloseCard,
  onBack,
  onLike,
  onCheer,
  onReidentify,
  onCancelMaterial,
  onConfirmDeadline,
  initialPeer,
}: Props) {
  const defaultTarget = card.authorKind === 'persona' ? card.authorId : '';
  const nextStepAllowed = canUseNextStep(card);
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
  const [smallerChoices, setSmallerChoices] = useState(false);
  const materialDeadline = useMemo(()=>parseMaterialDeadline(card.material?.deadlineText),[card.material?.deadlineText]);
  const [deadlineInput,setDeadlineInput] = useState('');
  useEffect(()=>setDeadlineInput(deadlineInputValue(materialDeadline)),[card.id,card.material?.deadlineText]);
  const materialScanning=Boolean(card.image && card.materialAttemptAt && !card.material && !card.materialError);
  const materialAdviceAnchor=card.material?.anchors.find(a=>a.id===card.advice?.materialAnchorId);
  useEffect(() => setSmallerChoices(false), [card.id, card.advice?.sourceCommentId]);
  const ordered = useMemo(() => orderThreadComments(card.comments), [card.comments]);
  const latestId = latestCommentId(card.comments);
  // 有回复正在排队/生成时，先在楼层里显示“正在输入…”，生成完成后被真实回复替换。
  const typingRows = useMemo(() => {
    const t = Date.now();
    const seen = new Set<string>();
    // 到场计划（plan）和排队回复（pending）都算“正在输入”。
    const upcoming = [
      ...(card.plan ?? []).map((row) => ({ personaId: row.personaId, at: row.at })),
      ...(card.pending ?? []).map((row) => ({ personaId: row.personaId, at: row.at })),
    ];
    return upcoming
      .filter((row) => row.at <= t + 90_000)
      .filter((row) => {
        if (seen.has(row.personaId)) return false;
        seen.add(row.personaId);
        return true;
      })
      .map((row) => {
        const persona = personas.find((x) => x.id === row.personaId);
        return { id: row.personaId, name: persona?.name ?? '同伴', persona };
      });
  }, [card.plan, card.pending, personas]);
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const giver = card.advice ? personas.find((p) => p.id === card.advice?.fromPersonaId) : undefined;
  const canShrinkAdopted = canRequestSmallerComment(card);
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
    const adoptable = mine && !isGuide && !closed && nextStepAllowed && card.status !== 'noted' &&
      !card.advice?.accepted && comment.authorKind === 'persona' &&
      comment.origin !== 'boundary' && comment.origin !== 'system' && Boolean(persona) &&
      (Boolean(comment.actionId) || isActionableStepText(comment.text));
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
              <Avatar avatarKey={me.avatarKey} src={me.avatarUrl} className="me" size="xs" />
            )}
            <span className="forum-comment-name">
              {isMe ? '你' : isHelper ? '论坛小助手' : persona?.name ?? '同伴'}
            </span>
            <span className="forum-comment-time">{clock(comment.at)}</span>
            {repliedTo && <span className="forum-comment-reply">回复 {repliedTo}</span>}
            {comment.kind === 'advice' && <span className="advice-tag">下一步</span>}
            {selected && <span className="forum-comment-target">正在回复</span>}
          </div>
          <p className="forum-comment-text">{comment.text}</p>
          {comment.fallbackReason && comment.fallbackReason !== 'demo' && (
            <p className="fallback-note">网络没接上，这条是预设回复</p>
          )}
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
            <Avatar avatarKey={me.avatarKey} src={me.avatarUrl} className="me" size="sm" />
          )}
          <div>
            <p className="page-author">
              {card.authorName}
              {card.intro && <span className="thread-badge">自我介绍</span>}
              {card.kind === 'goal' && <span className="thread-badge">目标</span>}
              {card.kind === 'life' && <span className="thread-badge">生活</span>}
              {mine && <span className="me-badge">你</span>}
            </p>
            <p className="detail-role">{isGuide ? '论坛的说明' : author ? '同伴' : '你的卡'}</p>
          </div>
        </div>
      </header>

      {card.kind === 'brag' && <span className="brag-badge">做到了</span>}
      {card.title && <h1 className="detail-title">{card.title}</h1>}
      <p className="page-text">{card.text}</p>
      {card.image && <img className="card-image" src={card.image} alt="卡片配图" />}
      {mine && card.image && !isGuide && (
        <section className="advice" aria-label="材料识别与截止时间确认" style={{maxWidth:'100%',overflowWrap:'anywhere'}}>
          <div className="advice-head"><strong>识别到（请核对）</strong></div>
          {materialScanning && <div role="status">
            <p>识别中…正在提取可见文字，结果可能有误。</p>
            {onCancelMaterial && <button type="button" className="btn btn-ghost"
              onClick={onCancelMaterial}>取消识别</button>}
          </div>}
          {card.materialError && <p role="status">{card.materialError==='cancelled'
            ? '识别已取消。你仍可使用普通下一步。'
            : '没看清这张图，可以重试，或把关键文字粘贴进来。'}</p>}
          {card.material && <>
            <p>{card.material.title || '未识别标题'} · {card.material.confidence==='high'?'识别较有把握':'识别不确定，请仔细核对'}</p>
            <ul>{card.material.anchors.map(a=><li key={a.id}>
              <strong>{a.label}</strong>：<span>{a.quote}</span>{a.page ? `（第 ${a.page} 页）` : ''}
            </li>)}</ul>
            {card.materialCaptureStep && <p role="status">已根据可见片段准备一条可核对的第一步。领取前可先检查下方引用。</p>}
            {card.material.excerpt && <details><summary>展开识别节选（可能有误）</summary>
              <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{card.material.excerpt}</p></details>}
            {card.material.deadlineText && <div>
              <p>识别到：<strong>{card.material.deadlineText}</strong>。请确认，不会自动当成真实截止时间。</p>
              {!card.materialGoalId ? <>
                <label className="field"><span className="field-label">由你确认实际截止时间（本地时区）</span>
                  <input type="datetime-local" value={deadlineInput} onChange={e=>setDeadlineInput(e.target.value)}
                    style={{maxWidth:'100%',minWidth:0}} aria-label="确认截止日期和时间" /></label>
                {materialDeadline.ambiguous && <small>原文日期不完整或含歧义，请自行核对后选择。</small>}
                <button type="button" className="btn btn-ghost"
                  disabled={!card.advice || !confirmedDeadline(deadlineInput) || !onConfirmDeadline}
                  onClick={()=>onConfirmDeadline?.(deadlineInput)}>确认并加入目标/日程</button>
              </> : <small>截止时间已由你确认并保存，不会自动修改。</small>}
            </div>}
          </>}
          {onReidentify && <button type="button" className="btn btn-ghost" onClick={onReidentify} disabled={materialScanning || busy ||
              (card.advice?.origin==='material' && card.advice.accepted) || Boolean(card.materialGoalId)}>{card.materialAttemptAt?'重新识别':'识别图片'}</button>}
        </section>
      )}
      {card.vulnerability && <p className="page-composer-note" role="note">
        {card.vulnerability.kind==='missed'?'今天没做到':'这次卡住了'}。回应完全自愿，不会因没有回复而追问。
      </p>}

      {!isGuide && card.advice && !closed && (
        <div className="advice">
          <div className="advice-head">
            <span className="advice-from">
              {card.advice.sourceCommentId && giver
                ? `今天的一步 · 你采用了${giver.name}的回复`
                : giver
                  ? `今天的一步 · ${giver.name}给的`
                  : '今天的一步'}
            </span>
            <span className="advice-hint">
              {card.advice.actionId || card.advice.origin==='material' ? '做不到就再小一级' : '原话采用 · 可请求更小一步'}
            </span>
          </div>
          <p className="advice-label">{card.advice.text}</p>
          {isHelpSeekingAction(card.advice.actionId) && (
            <p className="page-composer-note" role="note">
              这是联系真人支持的准备步骤，不是诊断或治疗建议；如感到自己有即时危险，请联系身边的人和当地紧急服务。
            </p>
          )}
          {card.advice.origin==='material' && materialAdviceAnchor && (
            <small>引用：{materialAdviceAnchor.label}</small>
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
              <button className="btn btn-ghost" disabled={busy || (!card.advice.actionId && card.advice.origin!=='material' && !canShrinkAdopted)}
                onClick={() => canShrinkAdopted
                  ? setSmallerChoices(true) : onShrink()}>
                做不到
              </button>
              <button className="btn btn-primary" onClick={onAccept}>
                贴到便签
              </button>
            </div>
          )}
          {mine && !card.advice.accepted && !card.advice.actionId && (
            <div className="page-composer-note">
              <p>这是回复原文，不是自动动作链；新建议只会作为评论出现，不会替换原话。</p>
              {busy && canShrinkAdopted && (
                <p role="status">正在给出一个更小的动作，原建议会保留。</p>
              )}
              {smallerChoices && canShrinkAdopted && (
                <div className="advice-actions" role="group" aria-label="再小一步选项">
                  <button type="button" className="btn btn-ghost" disabled={busy}
                    onClick={() => { onRequestSmaller(); setSmallerChoices(false); }}>
                    {busy ? '正在想更小一步…' : `让${giver?.name ?? '这位角色'}再给一个小一步`}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSmallerChoices(false)}>
                    先留着这条
                  </button>
                </div>
              )}
              {(() => {
                const suggested = card.comments.find((row) =>
                  row.parentAdviceSource === card.advice?.sourceCommentId && row.shrinkDepth);
                return suggested && (
                  <button type="button" className="advice-source-link"
                    onClick={() => scrollToComment(suggested.id)}>
                    较小的一步已在评论中 · 查看后决定是否采用
                  </button>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {mine && !isGuide && card.note && card.status === 'noted' && nextStepAllowed &&
        (Boolean(card.note.actionId) || isActionableStepText(card.note.text)) && (
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
          {(card.kind==='goal'||card.kind==='progress')&&<button type="button"
            className={`like ${card.cheeredByMe?'on':''}`} onClick={onCheer}>
            {card.cheeredByMe?'已打气':'打气'} {card.cheerCount??0}
          </button>}
          <button className={`like ${card.likedByMe ? 'on' : ''}`} onClick={onLike}>
            ♥ {card.likes ?? 0}
          </button>
        </div>
      )}

      {mine && !card.advice && (card.arrivals.length > 0 || card.materialCaptureStep) && !closed && (
        <div className="card-actions">
          <button className="btn btn-ghost" onClick={() => onAdvice(targetId || undefined)} disabled={busy}>
            直接要一个下一步
          </button>
        </div>
      )}

      <h2 className="page-comments-title">{card.comments.length} 条回应</h2>
      {!isGuide && <p className="page-composer-note">这里的同伴是虚构角色，不是真人，也不能替代专业帮助。</p>}

      <div className="forum-comments" ref={commentsRef}>
        {card.comments.length === 0 && (
          <p className="view-empty">还没有人说话。等一会儿，或者在下面先回楼主一句。</p>
        )}
        {ordered.map(renderComment)}
        {typingRows.map((row) => (
          <div key={`typing-${row.id}`} className="typing-row" aria-live="polite">
            <Avatar
              avatarKey={row.persona?.avatarKey ?? 'lamp'}
              name={row.name}
              color={row.persona?.color ?? '#8b87a0'}
              size="xs"
            />
            <span className="typing-name">{row.name}</span>
            <span className="typing-text">正在输入…</span>
          </div>
        ))}
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
            {nextStepAllowed && (
              <button
                className={`advice-toggle ${mode === 'advice' ? 'on' : ''}`}
                onClick={() => setMode((m) => (m === 'advice' ? 'comment' : 'advice'))}
              >
                {mode === 'advice' ? '下一步中' : '给下一步'}
              </button>
            )}
          </div>
          <div className="page-composer-row">
            <input
              ref={inputRef}
              value={draft}
              placeholder={
                targetId
                  ? targetIsOp
                    ? (card.vulnerability ? '陪他说一句…' : '回复楼主…')
                    : `回复 ${target?.name ?? '对方'}…`
                  : mine
                    ? '说一句…'
                    : (card.vulnerability ? '陪他说一句…' : '回复楼主…')
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
