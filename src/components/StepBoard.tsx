import { useRef, useState } from 'react';
import type { Card, Goal, Persona, Todo } from '../types';
import { isHelpSeekingAction } from '../lib/support';
import { canRequestSmallerComment } from '../lib/freeTextShrink';
import { goalProgress } from '../lib/goals';

interface Props {
  cards: Card[];
  todos: Todo[];
  personas: Persona[];
  userName: string;
  busy: boolean;
  onOpenCard: (card: Card) => void;
  onAccept: (card: Card) => void;
  onShrink: (card: Card) => void;
  onRequestSmaller: (card: Card) => void;
  onDone: (card: Card) => void;
  onAdvice: (card: Card) => void;
  onWrite: () => void;
  onForum: () => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (id: string) => void;
  onBrag: (todo: Todo) => void;
  onBragCard: (text: string) => void;
  onOpenMine: () => void;
  goals: Goal[];
  onDecompose: () => void;
  onOpenGoal: (goalId: string) => void;
  onShareGoal: (goalId: string) => void;
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export default function StepBoard({
  cards,
  todos,
  personas,
  userName,
  busy,
  onOpenCard,
  onAccept,
  onShrink,
  onRequestSmaller,
  onDone,
  onAdvice,
  onWrite,
  onForum,
  onAddTodo,
  onToggleTodo,
  onBrag,
  onBragCard,
  onOpenMine,
  goals,
  onDecompose,
  onOpenGoal,
  onShareGoal,
}: Props) {
  const [draft, setDraft] = useState('');
  const [smallerChoices, setSmallerChoices] = useState(false);
  const todoInputRef = useRef<HTMLInputElement>(null);
  const mine = cards
    .filter((c) => c.authorId === 'me')
    .sort((a, b) => b.createdAt - a.createdAt);
  const open = mine.filter((c) => c.status !== 'done' && c.status !== 'handled');
  const noted = mine.find((c) => c.note && c.status === 'noted');
  const advised = mine.find(
    (c) => c.advice && !c.advice.accepted && c.status !== 'done' && c.status !== 'handled',
  );
  const canShrinkAdopted = Boolean(advised && canRequestSmallerComment(advised));
  const active = open[0];
  const focus = noted ?? advised;
  const waiting = open.filter(
    (c) => c.status === 'stuck' || c.status === 'arrived' || c.status === 'talking',
  );
  const lastDone = mine.find((c) => c.status === 'done' && c.note);
  const giver = focus
    ? personas.find((p) => p.id === (focus.note?.fromPersonaId ?? focus.advice?.fromPersonaId))
    : undefined;
  const others = waiting.filter((c) => c.id !== (focus?.id ?? active?.id));
  const myTodos = todos.filter((t) => !t.doneAt);
  const doneTodos = todos.filter((t) => t.doneAt).slice(0, 3);
  const doneCount = todos.filter((t) => t.doneAt).length;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayMs = 86_400_000;
  const doneStamps = [
    ...todos.filter((t) => t.doneAt).map((t) => t.doneAt as number),
    ...mine.filter((c) => c.doneAt).map((c) => c.doneAt as number),
  ];
  const doneToday = doneStamps.filter((ts) => ts >= dayStartMs).length;
  const pendingCount = myTodos.length + open.length;
  const rateBase = doneToday + pendingCount;
  const ratePct = rateBase === 0 ? 0 : Math.round((doneToday / rateBase) * 100);
  const weekStart = new Date(dayStartMs);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDone = doneStamps.filter((ts) => ts >= weekStart.getTime()).length;
  const doneDays = new Set(
    doneStamps.map((ts) => {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }),
  );
  const cursor = new Date(dayStartMs);
  if (!doneDays.has(cursor.getTime())) cursor.setTime(cursor.getTime() - dayMs);
  let streak = 0;
  while (doneDays.has(cursor.getTime())) {
    streak += 1;
    cursor.setTime(cursor.getTime() - dayMs);
  }

  const minTask =
    focus?.note?.text ??
    focus?.advice?.text ??
    (active ? active.title ?? active.text.slice(0, 40) : myTodos[0]?.text);
  const reminder = giver
    ? `${giver.name} 还在等你的回音`
    : doneToday > 0
      ? `今天已经启动 ${doneToday} 次，保持这个节奏就好`
      : '先做 5 分钟也算开始';

  const hour = new Date().getHours();
  const partOfDay =
    hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const nickname = userName.trim() && !userName.trim().startsWith('匿名') ? userName.trim() : '';
  const greeting = nickname ? `${partOfDay}，${nickname}` : partOfDay;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onAddTodo(text);
    setDraft('');
  };

  return (
    <div className="step-board">
      <section className="card section-card meeting-goal-entry">
        <div className="section-head"><h3>拆解一个目标</h3></div>
        <p>目标大一点也没关系。自己写步骤，或先让 AI 问清楚再拆。</p>
        <button className="btn btn-primary" onClick={onDecompose}>拆解一个目标</button>
        {goals.some((g) => g.ownerId === 'me' && g.status === 'active') && (
          <div className="meeting-goal-list">
            <p className="meeting-label">进行中的目标</p>
            {goals.filter((g) => g.ownerId === 'me' && g.status === 'active').slice(0, 5).map((g) => (
              <div key={g.id} className="meeting-goal-list-row">
                <button type="button" className="meeting-goal-link" onClick={() => onOpenGoal(g.id)}>
                  <b>{g.title}</b>
                  <span>{goalProgress(g).done}/{g.steps.length} 步 · 查看详情</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={Boolean(g.sharedAt && Date.now() - g.sharedAt < 86_400_000)}
                  onClick={() => onShareGoal(g.id)}
                >
                  {g.sharedAt && Date.now() - g.sharedAt < 86_400_000 ? '已分享' : '分享到论坛'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section
        className={`step-hero hero-card ${
          focus ? '' : active ? 'is-waiting' : lastDone ? 'is-done' : 'is-empty'
        }`}
        data-tour="step"
      >
        <div className="hero-copy">
          {focus ? (
            <>
              <span className="hero-eyebrow">
                {noted ? '✦ 今天的一小步' : '✦ 有人给了你一个下一步'}
              </span>
              <p className="step-line">{noted?.note?.text ?? advised?.advice?.text}</p>
              {focus.advice?.origin && (
                <small>
                  {focus.advice.origin === 'adopted'
                    ? '你从角色回复采用 · 保留原话'
                    : focus.advice.origin === 'demo'
                      ? '演示动作'
                      : '预置动作'}
                </small>
              )}
              {isHelpSeekingAction(focus?.advice?.actionId) && (
                <p className="step-ai-note" role="note">
                  这是联系真人支持的准备步骤，不是诊断或治疗建议。如有即时危险，请联系身边的人或当地紧急服务。
                </p>
              )}
              <p className="step-from">
                {giver
                  ? focus.advice?.sourceCommentId
                    ? `从${giver.name}的回复采用 · `
                    : `${giver.name} 给的 · `
                  : ''}
                {focus.advice?.actionId ? '做不到就再小一级' : '原话采用 · 可请角色再给小一步'}
              </p>
              <div className="step-actions">
                {noted ? (
                  <button className="btn btn-primary" onClick={() => onDone(noted)}>
                    我做到了
                  </button>
                ) : advised ? (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() => (canShrinkAdopted ? setSmallerChoices(true) : onShrink(advised))}
                      disabled={busy || (!advised.advice?.actionId && !canShrinkAdopted)}
                    >
                      做不到
                    </button>
                    <button className="btn btn-primary" onClick={() => onAccept(advised)}>
                      贴到便签
                    </button>
                  </>
                ) : null}
                <button className="btn btn-ghost" onClick={() => onOpenCard(focus)}>
                  {noted ? '打开这张卡' : '先看看上下文'}
                </button>
              </div>
              {busy && canShrinkAdopted && (
                <p role="status" className="step-ai-note">
                  正在给一个更小的步骤；原话仍然保留。
                </p>
              )}
              {advised && canShrinkAdopted && smallerChoices && (
                <div className="step-smaller-options" role="group" aria-label="自由建议再小一步">
                  <p className="step-ai-note">
                    原话不会自动被替换。角色会在评论里给出新建议，需要你再次采用。
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      onRequestSmaller(advised);
                      setSmallerChoices(false);
                    }}
                  >
                    {busy ? '正在想更小一步…' : `让${giver?.name ?? '她'}再给一个小一步`}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setSmallerChoices(false)}>
                    先留着这条
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => onOpenCard(advised)}>
                    去评论里确认
                  </button>
                </div>
              )}
            </>
          ) : active ? (
            <>
              <span className="hero-eyebrow">✦ 你的卡还在等</span>
              <p className="step-line">{active.title ?? active.text.slice(0, 40)}</p>
              <p className="step-from">
                {active.arrivals.length
                  ? `${active.arrivals.length} 人来过，还在聊`
                  : '放出去不用守着，有人来会提示你'}
              </p>
              <div className="step-actions">
                <button className="btn btn-primary" onClick={() => onOpenCard(active)}>
                  打开我的卡
                </button>
                {active.arrivals.length > 0 && !active.advice && (
                  <button className="btn btn-ghost" onClick={() => onAdvice(active)} disabled={busy}>
                    直接要一个下一步
                  </button>
                )}
              </div>
            </>
          ) : lastDone ? (
            <>
              <span className="hero-eyebrow">✓ 做到了</span>
              <p className="step-line">{lastDone.note?.text}</p>
              <p className="step-from">不用写读后感。想让人看见，就发个炫耀。</p>
              <div className="step-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => onBragCard(lastDone.note?.text ?? '')}
                >
                  发个炫耀
                </button>
                <button className="btn btn-ghost" onClick={() => onOpenCard(lastDone)}>
                  打开这张卡
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="hero-eyebrow hero-greeting">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4" />
                </svg>
                {greeting}
              </span>
              <h3>今天，先做一件事</h3>
              <p className="step-empty-text">不用逼自己很努力，先启动这一步就够了</p>
              <div className="step-actions">
                <button className="btn btn-primary" onClick={onWrite}>
                  开始
                </button>
                <button className="btn btn-ghost btn-soft" onClick={onForum}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="8.4" />
                    <path d="M8.6 14.2a4 4 0 0 0 6.8 0" />
                    <path d="M9.3 9.6h.01M14.7 9.6h.01" />
                  </svg>
                  再想想
                </button>
              </div>
              <button
                className="btn-later"
                onClick={() => {
                  todoInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  todoInputRef.current?.focus();
                }}
              >
                换个时间再开始
              </button>
            </>
          )}
        </div>

        <div className="rate-ring" role="img" aria-label={`今日启动率 ${ratePct}%`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#b8a6fb" />
                <stop offset="100%" stopColor="#7c5cf0" />
              </linearGradient>
            </defs>
            <circle className="ring-track" cx="60" cy="60" r={RING_R} />
            {ratePct > 0 && (
              <circle
                className="ring-lav"
                cx="60"
                cy="60"
                r={RING_R}
                strokeDasharray={`${(ratePct / 100) * RING_C} ${RING_C}`}
              />
            )}
            {ratePct > 0 && ratePct < 100 && (
              <circle
                className="ring-mint"
                cx="60"
                cy="60"
                r={RING_R}
                strokeDasharray={`${((100 - ratePct) / 100) * RING_C} ${RING_C}`}
                strokeDashoffset={-((ratePct / 100) * RING_C)}
              />
            )}
          </svg>
          <div className="rate-ring-center">
            <span>今日启动率</span>
            <b>{ratePct}%</b>
          </div>
        </div>
      </section>

      <section className="home-cards">
        <article className="info-card">
          <div className="info-card-head">
            <span className="info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="4" y="4" width="16" height="16" rx="5" />
                <path d="M8.5 12.2l2.4 2.4 4.6-5" />
              </svg>
            </span>
            今日最小任务
          </div>
          <p className="info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4h7l4 4v12H7z" />
              <path d="M14 4v4h4" />
            </svg>
            {minTask ?? '写一张卡，说说你卡在哪'}
          </p>
          <p className="info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 1.8" />
            </svg>
            {minTask ? '预计 1–15 分钟' : '写下来，才知道卡在哪'}
          </p>
        </article>
        <article className="info-card">
          <div className="info-card-head">
            <span className="info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 1.8" />
              </svg>
            </span>
            本周进度
          </div>
          <p className="info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9a8 8 0 0 1 13.7-4.3L20 7" />
              <path d="M20 4v3h-3" />
              <path d="M20 15a8 8 0 0 1-13.7 4.3L4 17" />
              <path d="M4 20v-3h3" />
            </svg>
            连续启动 <b>{streak}</b> 天
          </p>
          <p className="info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l4 4L19 6" />
            </svg>
            完成 <b>{weekDone}</b> 个小步骤
          </p>
        </article>
        <article className="info-card">
          <div className="info-card-head">
            <span className="info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8Z" />
              </svg>
            </span>
            AI 同伴提醒
          </div>
          <p className="info-main">{reminder}</p>
          <p className="info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 5h16v11H9l-5 4z" />
            </svg>
            不是真人，但会认真听你说
          </p>
        </article>
      </section>

      {mine.length > 0 && (
        <button className="step-link" onClick={onOpenMine}>
          我的卡 · {mine.length} 张{waiting.length > 0 ? `，${waiting.length} 张还在等` : ''} →
        </button>
      )}

      <section className="step-shelf card todo-card">
        <div className="step-shelf-head">
          <div>
            <h3>我自己的小事</h3>
            <p>今天能做的，不用一次做完</p>
          </div>
          {todos.length > 0 && (
            <span className="tag tag-coral">
              {doneCount} / {todos.length} 已完成
            </span>
          )}
        </div>
        <div className="step-add">
          <input
            ref={todoInputRef}
            value={draft}
            placeholder="加一件小到不会失败的事，比如「把文档打开」"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button className="foot-send" onClick={add} disabled={!draft.trim()}>
            加
          </button>
        </div>
        {myTodos.length === 0 && doneTodos.length === 0 && (
          <p className="view-empty">还没有。小到不会失败，比如「洗把脸」「把书翻开」。</p>
        )}
        {myTodos.map((todo) => (
          <div key={todo.id} className="step-todo">
            <button
              className="todo-check"
              onClick={() => onToggleTodo(todo.id)}
              aria-label="标记完成"
            />
            <span>{todo.text}</span>
          </div>
        ))}
        {doneTodos.length > 0 && (
          <div className="step-done">
            <p className="step-done-title">做到了</p>
            {doneTodos.map((todo) => (
              <div key={todo.id} className="step-todo is-done">
                <span className="todo-check on" aria-hidden="true" />
                <span>{todo.text}</span>
                <button className="link" onClick={() => onBrag(todo)}>
                  发个炫耀
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {(focus || active || lastDone) && (
        <button className="step-browse" onClick={onForum}>
          没有灵感？去论坛看看别人卡在哪 →
        </button>
      )}

      {others.length > 0 && (
        <div className="step-others">
          <p className="step-others-title">其它还在等的卡</p>
          {others.map((c) => (
            <button key={c.id} className="step-others-row" onClick={() => onOpenCard(c)}>
              <span className="step-others-dot" />
              <span>{c.title ?? c.text.slice(0, 26)}</span>
              <em>{c.arrivals.length ? `${c.arrivals.length} 人来过` : '等一会儿'}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
