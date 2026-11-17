import { useState } from 'react';
import type { Card, Persona, Todo } from '../types';
import { isHelpSeekingAction } from '../lib/support';
import Avatar from './Avatar';

interface Props {
  cards: Card[];
  todos: Todo[];
  personas: Persona[];
  busy: boolean;
  onOpenCard: (card: Card) => void;
  onAccept: (card: Card) => void;
  onShrink: (card: Card) => void;
  onDone: (card: Card) => void;
  onAdvice: (card: Card) => void;
  onWrite: () => void;
  onForum: () => void;
  onAddTodo: (text: string) => void;
  onToggleTodo: (id: string) => void;
  onBrag: (todo: Todo) => void;
  onBragCard: (text: string) => void;
  onOpenMine: () => void;
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export default function StepBoard({
  cards,
  todos,
  personas,
  busy,
  onOpenCard,
  onAccept,
  onShrink,
  onDone,
  onAdvice,
  onWrite,
  onForum,
  onAddTodo,
  onToggleTodo,
  onBrag,
  onBragCard,
  onOpenMine,
}: Props) {
  const [draft, setDraft] = useState('');
  const mine = cards
    .filter((c) => c.authorId === 'me')
    .sort((a, b) => b.createdAt - a.createdAt);
  const open = mine.filter((c) => c.status !== 'done' && c.status !== 'handled');
  const noted = mine.find((c) => c.note && c.status === 'noted');
  const advised = mine.find(
    (c) => c.advice && !c.advice.accepted && c.status !== 'done' && c.status !== 'handled',
  );
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

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onAddTodo(text);
    setDraft('');
  };

  return (
    <div className="step-board">
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
                {focus.advice?.actionId ? '做不到就再小一级' : '评论原话暂无自动缩小'}
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
                      onClick={() => onShrink(advised)}
                      disabled={!advised.advice?.actionId}
                      title={
                        !advised.advice?.actionId
                          ? '回复原话没有可自动缩小的动作链，请回复她商量更小一步'
                          : undefined
                      }
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
              <span className="hero-eyebrow">✦ 今天也先动一下</span>
              <h3>今天，先做一件小事</h3>
              <p className="step-empty-text">
                不用逼自己很努力，先启动这一步就够了。四个 AI 同学会先听你说，再陪你把它缩成一个现在能做的小动作。
              </p>
              <p className="step-ai-note">
                四位同伴都是虚构的 AI 同学，和你在不同学校；只在论坛上聊。你不需要对他们的情绪负责。
              </p>
              <div className="step-actions">
                <button className="btn btn-primary" onClick={onWrite}>
                  开始
                </button>
                <button className="btn btn-ghost" onClick={onForum}>
                  再想想
                </button>
              </div>
            </>
          )}
        </div>

        <div className="rate-ring" role="img" aria-label={`今日启动率 ${ratePct}%`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
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
            <small>{rateBase === 0 ? '先走一步' : `${doneToday} / ${rateBase} 件`}</small>
          </div>
        </div>

        <div className="companion-strip">
          <div className="companion-avatars">
            {personas.map((p) => (
              <Avatar key={p.id} avatarKey={p.avatarKey} name={p.name} color={p.color} size="sm" />
            ))}
          </div>
          <div className="companion-strip-text">
            <b>{personas.map((p) => p.name).join('、')}</b>
            <span>{personas.length} 位 AI 同伴都在 · 不是真人，但会认真听你说</span>
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
          <p className="info-main">{minTask ?? '写一张卡，说说你卡在哪'}</p>
          <p className="info-sub">{minTask ? '预计 1–15 分钟' : '写下来，才知道卡在哪'}</p>
        </article>
        <article className="info-card">
          <div className="info-card-head">
            <span className="info-icon is-mint" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 1.8" />
              </svg>
            </span>
            本周进度
          </div>
          <p className="info-stat">
            连续启动 <b>{streak}</b> 天
          </p>
          <p className="info-stat">
            完成 <b>{weekDone}</b> 个小步骤
          </p>
        </article>
        <article className="info-card">
          <div className="info-card-head">
            <span className="info-icon is-pink" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8Z" />
              </svg>
            </span>
            AI 同伴提醒
          </div>
          <p className="info-main">{reminder}</p>
          <p className="info-sub">四位同伴都在 · 不是真人，但会认真听你说</p>
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
