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

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onAddTodo(text);
    setDraft('');
  };

  return (
    <div className="step-board">
      {focus ? (
        <section className="step-hero hero-card" data-tour="step">
          <span className="hero-eyebrow">{noted ? '✦ 今天的一步' : '✦ 有人给了你一个下一步'}</span>
          <p className="step-line">{noted?.note?.text ?? advised?.advice?.text}</p>
          {focus?.advice?.origin && (
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
        </section>
      ) : active ? (
        <section className="step-hero hero-card is-waiting" data-tour="step">
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
        </section>
      ) : lastDone ? (
        <section className="step-hero hero-card is-done" data-tour="step">
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
        </section>
      ) : (
        <section className="step-hero hero-card is-empty" data-tour="step">
          <span className="hero-eyebrow">✦ 今天也先动一下</span>
          <h3>今天，先做一件小事</h3>
          <p className="step-empty-text">
            四个 AI 同学会先听你说，再陪你把它缩成一个现在能做的小动作，不用想清楚，只做此刻这一件。
          </p>
          <p className="step-ai-note">
            四位同伴都是虚构的 AI 同学，和你在不同学校；只在论坛上聊。你不需要对他们的情绪负责。
          </p>
          <div className="step-actions">
            <button className="btn btn-primary" onClick={onWrite}>
              写一张卡
            </button>
            <button className="btn btn-ghost" onClick={onForum}>
              没有灵感？去论坛看看 →
            </button>
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
      )}

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
