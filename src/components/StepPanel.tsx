import { useMemo, useState } from 'react';
import type { Room } from '../types';

interface Props {
  room: Room;
  busy: boolean;
  ready: boolean;
  onClose: () => void;
  onAdd: (text: string, group: string) => void;
  onComplete: (id: string) => void;
  onDrop: (id: string) => void;
  onShrink: (id: string) => void;
  onRequest: () => void;
}

const NO_GROUP = '';

export default function StepPanel({
  room,
  busy,
  ready,
  onClose,
  onAdd,
  onComplete,
  onDrop,
  onShrink,
  onRequest,
}: Props) {
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');

  const mine = useMemo(() => room.steps.filter((s) => s.ownerId === 'me'), [room.steps]);
  const open = mine.filter((s) => !s.doneAt);
  const done = mine.filter((s) => s.doneAt).slice(0, 5);
  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const step of open) {
      const key = step.group ?? NO_GROUP;
      if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [open]);

  const add = () => {
    const clean = text.trim();
    if (!clean) return;
    onAdd(clean, group);
    setText('');
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>下一步</h2>
          <p>只放此刻能动手的事。做一半也算数。</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <button type="button" className="btn btn-primary panel-wide" onClick={onRequest} disabled={busy || !ready}>
        {busy ? '群里正在想…' : '让群里给一个下一步'}
      </button>
      {!ready && <p className="panel-hint">先在「API」里接一个模型，或者切到演示模式。</p>}

      <div className="panel-add">
        <input
          value={text}
          placeholder="加一件小到不会失败的事，例如「把书翻开」"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <input
          className="panel-add-group"
          value={group}
          placeholder="挂在哪个目标下（可不填）"
          list="step-groups"
          onChange={(e) => setGroup(e.target.value)}
        />
        <datalist id="step-groups">
          {[...new Set(mine.map((s) => s.group).filter(Boolean))].map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <button type="button" className="btn btn-ghost" onClick={add} disabled={!text.trim()}>
          加上
        </button>
      </div>

      {open.length === 0 && (
        <p className="panel-empty">
          还没有下一步。卡住了就点上面那个按钮，或者自己加一件——小到不会失败就行。
        </p>
      )}

      {groups.map((key) => (
        <section key={key || 'none'} className="step-group">
          <h3 className="step-group-title">{key || '没有挂目标的'}</h3>
          {open
            .filter((s) => (s.group ?? NO_GROUP) === key)
            .map((step) => (
              <article key={step.id} className="step-row">
                <div className="step-row-body">
                  <p className="step-row-text">{step.text}</p>
                  <p className="step-row-meta">
                    {step.origin === 'ai' && step.fromName ? `${step.fromName} 给的` : '你自己加的'}
                    {step.origin === 'ai' && ' · 做不到就再小一级'}
                  </p>
                </div>
                <div className="step-row-actions">
                  {step.actionId && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShrink(step.id)}>
                      做不到
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onComplete(step.id)}>
                    完成
                  </button>
                  <button type="button" className="icon-btn" onClick={() => onDrop(step.id)} aria-label="删掉">
                    ×
                  </button>
                </div>
              </article>
            ))}
        </section>
      ))}

      {done.length > 0 && (
        <section className="step-group">
          <h3 className="step-group-title">做完了</h3>
          {done.map((step) => (
            <article key={step.id} className="step-row is-done">
              <div className="step-row-body">
                <p className="step-row-text">{step.text}</p>
                <p className="step-row-meta">已经算数了。不用写读后感。</p>
              </div>
            </article>
          ))}
        </section>
      )}

      {room.steps.some((s) => s.ownerId !== 'me') && (
        <p className="panel-foot">群里也有人在自己做小事。他们做完会在群里说一声。</p>
      )}
    </div>
  );
}
