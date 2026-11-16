import { useState } from 'react';
import type { Card, Persona, Todo } from '../types';

interface Props {
  todos: Todo[];
  cards: Card[];
  personas: Persona[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onBrag: (todo: Todo) => void;
  onOpenCard: (card: Card) => void;
  onClose: () => void;
}

export default function NoteDrawer({
  todos,
  cards,
  personas,
  onAdd,
  onToggle,
  onBrag,
  onOpenCard,
  onClose,
}: Props) {
  const [draft, setDraft] = useState('');
  const notes = cards
    .filter((c) => c.note && c.status === 'noted')
    .sort((a, b) => b.createdAt - a.createdAt);
  const open = todos.filter((t) => !t.doneAt);
  const done = todos.filter((t) => t.doneAt);

  return (
    <div
      className="drawer-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" aria-label="我的便签">
        <header className="drawer-head">
          <div>
            <h2>便签</h2>
            <p>不保证长期。只记你此刻能做的那一件小事。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="drawer-add">
          <input
            value={draft}
            placeholder="自己加一件小事，比如「把文档打开」"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onAdd(draft.trim());
                setDraft('');
              }
            }}
          />
          <button
            className="foot-send"
            disabled={!draft.trim()}
            onClick={() => {
              if (!draft.trim()) return;
              onAdd(draft.trim());
              setDraft('');
            }}
          >
            加
          </button>
        </div>

        {notes.length > 0 && (
          <section className="drawer-section">
            <h3>别人给的办法</h3>
            {notes.map((card) => {
              const giver = personas.find((p) => p.id === card.note?.fromPersonaId);
              return (
                <button
                  key={card.id}
                  className="drawer-item link-like"
                  onClick={() => onOpenCard(card)}
                >
                  <span className="drawer-text">{card.note?.text}</span>
                  <span className="drawer-meta">{giver ? `${giver.name} 给的` : '来自一张卡'}</span>
                </button>
              );
            })}
          </section>
        )}

        <section className="drawer-section">
          <h3>我自己的 {open.length > 0 ? `· ${open.length}` : ''}</h3>
          {open.length === 0 && <p className="view-empty">还没有。加一件小到不会失败的事。</p>}
          {open.map((todo) => (
            <div key={todo.id} className="drawer-todo">
              <button className="todo-check" onClick={() => onToggle(todo.id)} aria-label="标记完成" />
              <span>{todo.text}</span>
            </div>
          ))}
        </section>

        {done.length > 0 && (
          <section className="drawer-section">
            <h3>做到了</h3>
            {done.map((todo) => (
              <div key={todo.id} className="drawer-todo is-done">
                <span className="todo-check on" aria-hidden="true" />
                <span>{todo.text}</span>
                <button className="drawer-brag" onClick={() => onBrag(todo)}>
                  发个炫耀
                </button>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}
