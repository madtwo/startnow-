import { useMemo, useRef, useState } from 'react';
import type { Goal, GoalStep, ScheduleItem } from '../types';
import { dateKeyLocal, parseLocalDate } from '../lib/schedule';

interface Props {
  items: ScheduleItem[];
  goals: Goal[];
  onToggle: (id: string, done: boolean) => void;
  onAdd: (title: string, date: string, time?: number) => void;
  onOpenGoal: (id: string) => void;
  onDecompose: () => void;
}

type Mode = 'calendar' | 'list';
type GlyphTone = 'calendar' | 'book' | 'pen' | 'check' | 'smile';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MODE_KEY = 'startnow.calendarView';

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const formatMonthDay = (key: string): string => {
  const at = parseLocalDate(key);
  if (at === undefined) return key;
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const dayHeading = (key: string, today: string): string => {
  if (key === today) return '今天';
  const at = parseLocalDate(key);
  if (at !== undefined) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (key === dateKeyLocal(tomorrow.getTime())) return '明天';
    const d = new Date(at);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日 · ${weekday}`;
  }
  return key;
};

const clockLabel = (minutes?: number): string => {
  if (minutes === undefined) return '全天';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const toneFor = (item: ScheduleItem, step?: GoalStep): GlyphTone => {
  if (step) {
    if (step.kind === 'research' || step.kind === 'review') return 'book';
    if (step.kind === 'draft') return 'pen';
    if (step.kind === 'admin') return 'check';
  }
  if (item.source === 'manual' || item.source === 'todo') return 'smile';
  return 'calendar';
};

const noteFor = (item: ScheduleItem, step?: GoalStep): string => {
  if (step) {
    if (step.kind === 'research' || step.kind === 'review') return '只看框架，不逼自己记住';
    if (step.kind === 'draft') return '先写一版，不用一次到位';
    if (step.kind === 'admin') return '当成顺手的小事处理';
    if (step.estimateMin) {
      if (step.estimateMin <= 10) return `${step.estimateMin} 分钟就够`;
      if (step.estimateMin <= 20) return '十几分钟就能推进一点';
      return '先做一小段，累了就停';
    }
  }
  if (item.source === 'manual' || item.source === 'todo') return '慢慢来，先做五分钟也算开始';
  return '先做能开始的那一步';
};

const pressureFor = (step?: GoalStep): string => {
  if (step?.estimateMin !== undefined) {
    if (step.estimateMin >= 60) return '留点余量';
    if (step.estimateMin >= 40) return '按自己节奏';
  }
  return '低压力';
};

function TaskGlyph({ tone }: { tone: GlyphTone }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (tone === 'book') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h5v16H7a2.5 2.5 0 0 0-2.5 2V5.5Z" />
        <path d="M19.5 5.5A2.5 2.5 0 0 0 17 3h-5v16h5a2.5 2.5 0 0 1 2.5 2V5.5Z" />
      </svg>
    );
  }
  if (tone === 'pen') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="m4 20 4.2-1 9.6-9.6a2.2 2.2 0 0 0-3.1-3.1L5 16l-1 4Z" />
        <path d="m13.5 7.5 3 3" />
      </svg>
    );
  }
  if (tone === 'check') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="m8 12 2.6 2.6L16.5 8.7" />
      </svg>
    );
  }
  if (tone === 'smile') {
    return (
      <svg {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M8.6 14.2c.8 1.3 1.9 2 3.4 2s2.6-.7 3.4-2" />
        <path d="M9.2 9.5h.01M14.8 9.5h.01" strokeWidth="2.4" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17" />
      <path d="M8 13h3M8 16.5h6" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12 2.5 2.5L16.2 9" />
    </svg>
  );
}

export default function ScheduleView({ items, goals, onToggle, onAdd, onOpenGoal, onDecompose }: Props) {
  const today = dateKeyLocal(Date.now());
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'calendar'));
  const [selected, setSelected] = useState(today);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [clock, setClock] = useState('');
  const [error, setError] = useState('');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const titleRef = useRef<HTMLInputElement>(null);

  const mine = useMemo(() => items.filter((item) => item.ownerId === 'me'), [items]);
  const byDate = useMemo(() => {
    const next = new Map<string, ScheduleItem[]>();
    mine.forEach((item) => {
      const rows = next.get(item.dateKey) ?? [];
      rows.push(item);
      next.set(item.dateKey, rows);
    });
    next.forEach((rows) => rows.sort((a, b) => (a.startMin ?? -1) - (b.startMin ?? -1)));
    return next;
  }, [mine]);

  const groups = useMemo(() => {
    if (mode === 'calendar') {
      const rows = byDate.get(selected) ?? [];
      return rows.length ? [{ key: selected, items: rows }] : [];
    }
    const next: { key: string; items: ScheduleItem[] }[] = [];
    mine.slice().sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.startMin ?? -1) - (b.startMin ?? -1))
      .forEach((item) => {
        const last = next[next.length - 1];
        if (last?.key === item.dateKey) last.items.push(item);
        else next.push({ key: item.dateKey, items: [item] });
      });
    return next;
  }, [byDate, mine, mode, selected]);

  const calendar = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = dateKeyLocal(d.getTime());
      return {
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === month.getMonth(),
        isToday: key === today,
        count: byDate.get(key)?.length ?? 0,
      };
    });
  }, [byDate, month, today]);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = dateKeyLocal(tomorrowDate.getTime());
  const selectedHeading = selected === today ? '今天的安排'
    : selected === tomorrow ? '明天的安排'
      : `${formatMonthDay(selected)}的安排`;

  const chooseMode = (next: Mode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  };

  const quickAdd = () => {
    setDate(selected);
    chooseMode('list');
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const moveMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    setSelected(dateKeyLocal(next.getTime()));
  };

  const add = () => {
    try {
      const parts = clock.split(':');
      const minute = clock ? Number(parts[0]) * 60 + Number(parts[1]) : undefined;
      onAdd(title, date, minute);
      setTitle('');
      setClock('');
      setError('');
      const at = parseLocalDate(date);
      if (at !== undefined) {
        setSelected(date);
        setMonth(new Date(new Date(at).getFullYear(), new Date(at).getMonth(), 1));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const taskMeta = (item: ScheduleItem) => {
    const goal = item.goalId ? goals.find((row) => row.id === item.goalId) : undefined;
    const step = item.stepId ? goal?.steps.find((row) => row.id === item.stepId) : undefined;
    return {
      goal,
      step,
      tone: toneFor(item, step),
      note: noteFor(item, step),
      pressure: pressureFor(step),
      overdue: item.status === 'todo' && (parseLocalDate(item.dateKey) ?? Infinity) < startOfDay(Date.now()),
    };
  };

  const renderListTask = (item: ScheduleItem, index: number, total: number) => {
    const meta = taskMeta(item);
    const done = item.status === 'done';
    return (
      <div key={item.id} className={`sch-task-row${done ? ' done' : ''}${meta.overdue ? ' overdue' : ''}`}>
        <div className="sch-check-col">
          <input
            type="checkbox"
            className="sch-check"
            checked={done}
            aria-label={`${done ? '取消完成' : '完成'} ${item.title}`}
            onChange={(e) => onToggle(item.id, e.target.checked)}
          />
          {index < total - 1 && <span className="sch-rail-line" aria-hidden="true" />}
        </div>
        <span className={`sch-task-icon ${meta.tone}`} aria-hidden="true"><TaskGlyph tone={meta.tone} /></span>
        <div className="sch-task-copy">
          <div className="sch-task-titleline">
            <b>{item.title}</b>
            <span className="sch-task-time">{clockLabel(item.startMin)}</span>
            {meta.overdue && <span className="sch-overdue-tag">已逾期</span>}
          </div>
          <div className="sch-task-note">
            <span>{meta.note}</span>
            {meta.goal && (
              <button type="button" className="sch-goal-link" onClick={() => onOpenGoal(meta.goal!.id)}>
                来自「{meta.goal.title}」
              </button>
            )}
          </div>
        </div>
        <span className={`sch-pressure${meta.overdue ? ' warn' : ''}`}>{meta.overdue ? '需要看看' : meta.pressure}</span>
      </div>
    );
  };

  const renderCalendarTask = (item: ScheduleItem, index: number, featureIndex: number) => {
    const meta = taskMeta(item);
    const done = item.status === 'done';
    return (
      <article key={item.id} className={`sch-cal-task${done ? ' done' : ''}${index === featureIndex ? ' feature' : ''}`}>
        <input
          type="checkbox"
          className="sch-check"
          checked={done}
          aria-label={`${done ? '取消完成' : '完成'} ${item.title}`}
          onChange={(e) => onToggle(item.id, e.target.checked)}
        />
        <div className="sch-cal-copy">
          <div className="sch-task-titleline">
            <b>{item.title}</b>
            <span className="sch-task-time">{clockLabel(item.startMin)}</span>
          </div>
          <div className="sch-task-note">
            <span>{meta.note}</span>
            {meta.goal && (
              <button type="button" className="sch-goal-link" onClick={() => onOpenGoal(meta.goal!.id)}>
                {meta.goal.title}
              </button>
            )}
          </div>
        </div>
        <span className={`sch-cal-glyph ${meta.tone}`} aria-hidden="true"><TaskGlyph tone={meta.tone} /></span>
      </article>
    );
  };

  const selectedItems = byDate.get(selected) ?? [];
  const featureIndex = selectedItems.findIndex((item) => item.status === 'todo');
  const selectedEmptyText = selectedItems.length
    ? '还有余力的话，再记一件小事'
    : `${selectedHeading.replace('的安排', '')}还没有安排～不用急，想好再开始`;

  return (
    <div className="sch-page">
      <header className="sch-head">
        <div>
          <h1 className="sch-title">日程</h1>
          <p className="sch-sub">存放你的长期目标，帮你看清当下可以开始的一小步</p>
        </div>
        <div className="sch-switch" aria-label="日程视图">
          <button type="button" className={mode === 'calendar' ? 'on' : ''} aria-pressed={mode === 'calendar'} onClick={() => chooseMode('calendar')}>日历</button>
          <button type="button" className={mode === 'list' ? 'on' : ''} aria-pressed={mode === 'list'} onClick={() => chooseMode('list')}>列表</button>
        </div>
      </header>

      {mode === 'list' && (
        <form
          className="sch-composer"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="sch-composer-copy">
            <h2>随手记录</h2>
            <input
              ref={titleRef}
              className="sch-composer-input"
              value={title}
              maxLength={180}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="写下一件想做的小事"
              aria-label="日程标题"
            />
          </div>
          <div className="sch-composer-fields">
            <label className="sch-field">
              <CalendarGlyph />
              <input aria-label="日程日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label className={`sch-field${clock ? '' : ' is-empty'}`}>
              <ClockGlyph />
              <input aria-label="日程时间（留空表示全天）" type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
              {!clock && <span className="sch-time-placeholder" aria-hidden="true">全天</span>}
            </label>
            <button type="submit" className="sch-add" disabled={!title.trim()}>
              <CheckGlyph />
              记下来
            </button>
          </div>
          {error && <p role="alert" className="sch-error">{error}</p>}
        </form>
      )}

      {mode === 'list' && groups.length > 0 && (
        <div className="sch-list">
          {groups.map((group) => (
            <section className="sch-day" key={group.key}>
              <h2 className="sch-day-title">{dayHeading(group.key, today)}</h2>
              <div className="sch-day-card">
                {group.items.map((item, index) => renderListTask(item, index, group.items.length))}
              </div>
            </section>
          ))}
        </div>
      )}

      {mode === 'list' && groups.length === 0 && (
        <div className="sch-list-empty">
          <div>
            <p>还没有日程，先记一件小事吧</p>
            <button type="button" className="sch-outline-btn" onClick={onDecompose}>拆解一个目标</button>
          </div>
          <span className="sch-encourage">不用排太满，有开始就很好</span>
        </div>
      )}

      {mode === 'calendar' && (
        <div className="sch-calendar-layout">
          <section className="sch-calendar-card" aria-label="月历">
            <div className="sch-calendar-head">
              <button type="button" className="sch-month-btn" aria-label="上个月" onClick={() => moveMonth(-1)}>‹</button>
              <b>{month.getFullYear()}年{month.getMonth() + 1}月</b>
              <button type="button" className="sch-month-btn" aria-label="下个月" onClick={() => moveMonth(1)}>›</button>
            </div>
            <div className="sch-weekdays" aria-hidden="true">
              {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="sch-days">
              {calendar.map((cell) => (
                <button
                  type="button"
                  key={cell.key}
                  className={`sch-day-cell${cell.inMonth ? '' : ' out'}${cell.isToday ? ' today' : ''}${cell.key === selected ? ' selected' : ''}`}
                  aria-label={`${cell.key}，${cell.count} 条日程`}
                  aria-pressed={cell.key === selected}
                  onClick={() => setSelected(cell.key)}
                >
                  <span className="sch-day-num">{cell.day}</span>
                  <span className="sch-day-dots" aria-hidden="true">
                    {Array.from({ length: Math.min(3, cell.count) }, (_, index) => <i key={index} className="sch-day-dot" />)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="sch-today-panel">
            <h2 className="sch-today-title">{selectedHeading}</h2>
            <div className="sch-today-cards">
              {selectedItems.map((item, index) => renderCalendarTask(item, index, featureIndex === -1 ? 0 : featureIndex))}
            </div>
            <div className="sch-cal-tail">
              <span className="sch-cal-tail-icon" aria-hidden="true"><CheckGlyph /></span>
              <p>{selectedEmptyText}</p>
              <div className="sch-empty-actions">
                <button type="button" className="sch-outline-btn" onClick={onDecompose}>拆解一个目标</button>
                <button type="button" className="sch-soft-btn" onClick={quickAdd}>随手记一件小事</button>
              </div>
              <span className="sch-bubble">我陪你慢慢安排</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}