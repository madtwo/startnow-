import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminPanel from './components/AdminPanel';
import Avatar from './components/Avatar';
import CardDetail from './components/CardDetail';
import CardRow from './components/CardRow';
import CardDeck from './components/CardDeck';
import GuideCard from './components/GuideCard';
import NoteDrawer from './components/NoteDrawer';
import PostForm from './components/PostForm';
import Tour from './components/Tour';
import CrisisCard from './components/CrisisCard';
import SettingsDialog from './components/SettingsDialog';
import { configLabel, isReady } from './config/providers';
import { findCrisis } from './lib/safety';
import {
  acceptAdvice,
  addPlayerComment,
  askForAdvice,
  closeCard,
  completeCard,
  createPlayerCard,
  markSeen,
  notePlayerShare,
  personaCard,
  shrinkAdvice,
  summonPersona,
  tickCards,
} from './lib/cards';
import { buildGuideCard, buildSeedCards, seedMemories } from './lib/seed';
import { defaultPersonas } from './lib/personas';
import {
  clearAll,
  dayKey,
  defaultSettings,
  emptyWorld,
  exportBundle,
  importBundle,
  isFirstRun,
  loadCards,
  loadConfig,
  loadIdentity,
  loadPersonas,
  loadSettings,
  loadTodos,
  loadWorld,
  needsUpgrade,
  saveCards,
  saveConfig,
  saveIdentity,
  savePersonas,
  saveSettings,
  saveTodos,
  saveWorld,
} from './lib/store';
import type {
  Card,
  Identity,
  LlmConfig,
  MemoryEntry,
  Persona,
  Todo,
  World,
  WorldSettings,
} from './types';

const TICK_MS = 4000;

type View = 'home' | 'post' | 'mine' | 'profile' | 'detail';

export default function App() {
  const [boot] = useState(() => {
    const withGuide = (cards: Card[]) => {
      const guide = buildGuideCard();
      if (!cards.some((c) => c.kind === 'guide')) return [guide, ...cards];
      return cards.map((c) =>
        c.kind === 'guide'
          ? {
              ...c,
              title: guide.title,
              text: guide.text,
              comments: c.comments.length ? c.comments : guide.comments,
            }
          : c,
      );
    };
    if (isFirstRun()) {
      return { cards: buildSeedCards(), personas: seedMemories(defaultPersonas()) };
    }
    if (needsUpgrade()) {
      const personas = loadPersonas();
      const seeded = personas.every((p) => p.memory.length === 0)
        ? seedMemories(personas)
        : personas;
      return { cards: withGuide(loadCards()), personas: seeded };
    }
    return { cards: withGuide(loadCards()), personas: loadPersonas() };
  });
  const [config, setConfig] = useState<LlmConfig>(() => loadConfig());
  const [cards, setCards] = useState<Card[]>(boot.cards);
  const [personas, setPersonas] = useState<Persona[]>(boot.personas);
  const [world, setWorld] = useState<World>(() => loadWorld());
  const [settings, setSettings] = useState<WorldSettings>(() => loadSettings());
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [image, setImage] = useState('');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [onboardOpen, setOnboardOpen] = useState(
    () => localStorage.getItem('startnow.onboarded') !== '1',
  );
  const [view, setView] = useState<View>('home');
  const [mode, setMode] = useState<'card' | 'list'>(
    () => (localStorage.getItem('startnow.mode') === 'list' ? 'list' : 'card'),
  );
  const [deckIndex, setDeckIndex] = useState(0);
  const [detailId, setDetailId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [crisis, setCrisis] = useState('');
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bragTodo, setBragTodo] = useState<Todo | null>(null);
  const [bragText, setBragText] = useState('');
  const [bragTitle, setBragTitle] = useState('');
  const brandClicks = useRef<number[]>([]);
  const busy = useRef(false);

  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => savePersonas(personas), [personas]);
  useEffect(() => saveWorld(world), [world]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveIdentity(identity), [identity]);
  useEffect(() => saveTodos(todos), [todos]);
  useEffect(() => localStorage.setItem('startnow.mode', mode), [mode]);

  const ready = isReady(config);
  const latest = useRef({ cards, personas, world, settings, config, working });
  latest.current = { cards, personas, world, settings, config, working };

  const tick = useCallback(async (override?: { cards?: Card[] }) => {
    if (busy.current) return;
    const cur = latest.current;
    if (cur.settings.paused || !isReady(cur.config)) return;
    if (cur.world.callsToday >= cur.settings.dailyCalls) return;
    busy.current = true;
    try {
      const out = await tickCards({
        cards: override?.cards ?? cur.cards,
        personas: cur.personas,
        settings: cur.settings,
        config: cur.config,
      });
      const before = new Map(
        cur.cards.filter((c) => c.authorId === 'me').map((c) => [c.id, c.comments.length]),
      );
      const fresh = out.cards.find(
        (c) => c.authorId === 'me' && (before.get(c.id) ?? 0) < c.comments.length,
      );
      if (fresh) {
        const last = fresh.comments[fresh.comments.length - 1];
        const who = cur.personas.find((p) => p.id === last?.authorId)?.name ?? '有人';
        setToast(`${who} 来了你的卡`);
      }
      setCards(out.cards);
      setPersonas(out.personas);
      const day = dayKey(Date.now());
      setWorld((w) => ({
        ...w,
        dayKey: day,
        callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls,
        lastTickAt: Date.now(),
        logs: [...out.logs, ...w.logs].slice(0, 20),
      }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void tick(), TICK_MS);
    void tick();
    return () => window.clearInterval(id);
  }, [ready, tick]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const patch = (id: string, fn: (card: Card) => Card) =>
    setCards((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const send = () => {
    const text = draft.trim();
    if (!text || working) return;
    if (!ready) {
      setSettingsNotice('先接入一个 API，或者切到演示模式。');
      setSettingsOpen(true);
      return;
    }
    if (findCrisis(text)) setCrisis(text);
    const card = createPlayerCard(text, identity.name, personas, settings, draftTitle);
    if (image) card.image = image;
    setPersonas((prev) => notePlayerShare(prev, text));
    setCards((prev) => [card, ...prev]);
    setDraft('');
    setDraftTitle('');
    setImage('');
    setView('home');
    setToast('正在寻找心友，可以去看看别人的卡');
  };

  const like = (card: Card) =>
    patch(card.id, (c) => ({
      ...c,
      likedByMe: !c.likedByMe,
      likes: Math.max(0, (c.likes ?? 0) + (c.likedByMe ? -1 : 1)),
    }));

  const addTodo = (text: string) =>
    setTodos((prev) => [{ id: crypto.randomUUID(), text, at: Date.now() }, ...prev]);

  const toggleTodo = (id: string) =>
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, doneAt: t.doneAt ? undefined : Date.now() } : t)),
    );

  const openBrag = (todo: Todo) => {
    setDrawerOpen(false);
    setBragTodo(todo);
    setBragText(`做到了：${todo.text}`);
    setBragTitle('');
  };

  const submitBrag = () => {
    if (!bragTodo || !bragText.trim()) return;
    const card = createPlayerCard(
      bragText.trim(),
      identity.name,
      personas,
      settings,
      bragTitle,
      Date.now(),
      'brag',
    );
    setCards((prev) => [card, ...prev]);
    setTodos((prev) =>
      prev.map((t) => (t.id === bragTodo.id ? { ...t, doneAt: t.doneAt ?? Date.now() } : t)),
    );
    setBragTodo(null);
    setDrawerOpen(false);
    setView('home');
    setToast('炫耀帖发出去了');
  };

  const openCard = (card: Card) => {
    setDetailId(card.id);
    if (!card.seenAt) patch(card.id, (c) => markSeen(c));
    setView('detail');
  };

  const comment = (card: Card, text: string, kind: 'comment' | 'advice', peer?: string) => {
    if (findCrisis(text)) setCrisis(text);
    setPersonas((prev) => notePlayerShare(prev, text));
    patch(card.id, (c) => addPlayerComment(c, text, Date.now(), settings.speed, kind, peer));
  };

  const advice = async (card: Card) => {
    setWorking(true);
    try {
      const cur = latest.current;
      const out = await askForAdvice({
        cards: cur.cards,
        personas: cur.personas,
        settings: cur.settings,
        config: cur.config,
        cardId: card.id,
      });
      setCards(out.cards);
      if (out.calls) {
        const day = dayKey(Date.now());
        setWorld((w) => ({
          ...w,
          dayKey: day,
          callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls,
        }));
      }
      if (out.logs.length) {
        setWorld((w) => ({ ...w, logs: [...out.logs, ...w.logs].slice(0, 20) }));
      }
    } finally {
      setWorking(false);
    }
  };

  const nudge = async () => {
    const cur = latest.current;
    const now = Date.now();
    let best: { cardId: string; kind: 'plan' | 'pending'; idx: number; at: number } | null = null;
    cur.cards.forEach((c) => {
      c.plan.forEach((p, idx) => {
        if (!best || p.at < best.at) best = { cardId: c.id, kind: 'plan', idx, at: p.at };
      });
      c.pending.forEach((p, idx) => {
        if (!best || p.at < best.at) best = { cardId: c.id, kind: 'pending', idx, at: p.at };
      });
    });
    if (!best) return;
    const target = best as { cardId: string; kind: 'plan' | 'pending'; idx: number };
    const next = cur.cards.map((c) => {
      if (c.id !== target.cardId) return c;
      if (target.kind === 'plan') {
        return { ...c, plan: c.plan.map((p, i) => (i === target.idx ? { ...p, at: now - 1 } : p)) };
      }
      return {
        ...c,
        pending: c.pending.map((p, i) => (i === target.idx ? { ...p, at: now - 1 } : p)),
      };
    });
    setCards(next);
    busy.current = false;
    await tick({ cards: next });
  };

  const openSettings = (notice = '') => {
    setSettingsNotice(notice);
    setSettingsOpen(true);
  };

  const bumpBrand = () => {
    const now = Date.now();
    brandClicks.current = brandClicks.current.filter((t) => now - t < 6000);
    brandClicks.current.push(now);
    if (brandClicks.current.length >= 5) {
      brandClicks.current = [];
      setAdminOpen(true);
    }
  };

  const summon = (personaId: string) => {
    const target = [...cards]
      .filter((c) => c.authorId === 'me' && c.status !== 'done' && c.status !== 'handled')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!target) return;
    patch(target.id, (c) => summonPersona(c, personaId));
  };

  const postAs = (personaId: string) => {
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return;
    setCards((prev) => [personaCard(persona), ...prev]);
  };

  const patchPersona = (next: Persona) =>
    setPersonas((prev) => prev.map((p) => (p.id === next.id ? next : p)));

  const setMemory = (personaId: string, memory: MemoryEntry[]) =>
    setPersonas((prev) => prev.map((p) => (p.id === personaId ? { ...p, memory } : p)));

  const doExport = () => {
    const raw = exportBundle({ cards, personas, world, settings, identity });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate(),
    ).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `startnow-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (raw: string) => {
    const bundle = importBundle(raw);
    if (!bundle) {
      alert('这份 JSON 读不了，检查一下是不是本页导出的。');
      return;
    }
    setCards(
      bundle.cards.some((c) => c.kind === 'guide') ? bundle.cards : [buildGuideCard(), ...bundle.cards],
    );
    setPersonas(bundle.personas);
    setWorld(bundle.world);
    setSettings(bundle.settings);
    setIdentity(bundle.identity);
    setAdminOpen(false);
  };

  const doClear = () => {
    clearAll();
    setCards([buildGuideCard()]);
    setPersonas(defaultPersonas());
    setWorld(emptyWorld());
    setSettings({ ...defaultSettings });
    setIdentity(loadIdentity());
    setAdminOpen(false);
    setView('home');
  };

  const doReseed = () => {
    setCards(buildSeedCards());
    setPersonas((prev) => seedMemories(prev));
    setWorld(emptyWorld());
  };

  const guide = cards.find((c) => c.kind === 'guide');
  const feed = useMemo(
    () =>
      cards
        .filter((c) => c.kind !== 'guide')
        .sort((a, b) => b.createdAt - a.createdAt),
    [cards],
  );
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todays = feed.filter((c) => c.createdAt >= todayStart);
  const earlier = feed.filter((c) => c.createdAt < todayStart);
  const myCards = useMemo(
    () => cards.filter((c) => c.authorId === 'me').sort((a, b) => b.createdAt - a.createdAt),
    [cards],
  );
  const activeMine = myCards.find((c) => c.status !== 'done' && c.status !== 'handled');
  const helped = cards
    .filter((c) => c.advice?.accepted && c.advice.fromPersonaId === 'me')
    .sort((a, b) => b.createdAt - a.createdAt);
  const detailCard = cards.find((c) => c.id === detailId);

  useEffect(() => {
    if (view !== 'home' || mode !== 'card') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setDeckIndex((i) => Math.min(i + 1, feed.length - 1));
      if (e.key === 'ArrowLeft') setDeckIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, mode, feed.length]);

  useEffect(() => {
    if (deckIndex > feed.length - 1) setDeckIndex(Math.max(0, feed.length - 1));
  }, [feed.length, deckIndex]);


  const noteCount =
    todos.filter((t) => !t.doneAt).length +
    cards.filter((c) => c.note && c.status === 'noted').length;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand" onClick={bumpBrand} title="StartNow">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 19V6M12 6l-4.4 4.4M12 6l4.4 4.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M5.5 19.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <div className="brand-text">
            <h1>StartNow论坛</h1>
            <p>谁卡住了，就放一张卡</p>
          </div>
        </div>
        <div className="top-actions">
          <button
            className={`chip ${ready ? 'ok' : 'warn'}`}
            onClick={() => openSettings()}
            title="接入你自己的 API"
          >
            <span className="dot" />
            {ready ? configLabel(config) : '未接入 API'}
          </button>
          <button className="avatar-btn" onClick={() => setView('profile')} aria-label="我的">
            <Avatar avatarKey={identity.avatarKey} className="me" size="sm" />
          </button>
        </div>
      </header>

      {view === 'home' && (
        <main className="feed">
          <div className="masthead">
            <p className="masthead-title">卡住了没关系，先动一下</p>
            <span className="masthead-date">
              {personas.length} 位同伴 · 今天 {todays.length} 张卡
            </span>
            <span className="masthead-sub">这里不保证长期，只负责此刻能做的那一件小事。</span>
            <div className="masthead-tools">
              <div className="mode-switch">
                <button className={mode === 'card' ? 'on' : ''} onClick={() => setMode('card')}>
                  卡片
                </button>
                <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
                  列表
                </button>
              </div>
              <button
                className="speed-chip"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    speed: s.speed >= 20 ? 6 : s.speed >= 6 ? 20 : 1,
                  }))
                }
                title="调整节奏：1× / 6× / 20×"
              >
                速度 ×{settings.speed}
              </button>
            </div>
          </div>

          {activeMine && (
            <button className="mine-strip" onClick={() => setView('mine')}>
              <Avatar avatarKey={identity.avatarKey} className="me" size="xs" />
              <span className="mine-strip-text">我的卡 · {activeMine.text.slice(0, 18)}…</span>
              <span className="mine-strip-meta">
                {activeMine.arrivals.length ? `${activeMine.arrivals.length} 人来过` : '等一会儿'}
              </span>
            </button>
          )}

          {crisis && <CrisisCard onClose={() => setCrisis('')} />}

          {guide && <GuideCard card={guide} onOpen={() => openCard(guide)} />}

          {feed.length === 0 && (
            <div className="empty">
              <h2>还没有人卡住</h2>
              <p>去「发一张」写一句，四位同伴会陆续过来。</p>
            </div>
          )}

          {mode === 'card' && feed.length > 0 && (
            <CardDeck
              cards={feed}
              personas={personas}
              index={deckIndex}
              onIndex={setDeckIndex}
              onOpen={openCard}
              onLike={like}
            />
          )}

          {mode === 'list' && todays.length > 0 && (
            <section className="board">
              <h2 className="board-title">今天</h2>
              {todays.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  personas={personas}
                  onClick={() => openCard(card)}
                  onLike={() => like(card)}
                />
              ))}
            </section>
          )}

          {mode === 'list' && earlier.length > 0 && (
            <section className="board">
              <h2 className="board-title">更早</h2>
              {earlier.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  personas={personas}
                  onClick={() => openCard(card)}
                  onLike={() => like(card)}
                />
              ))}
            </section>
          )}
        </main>
      )}

      {view === 'post' && (
        <main className="feed">
          <PostForm
            value={draft}
            title={draftTitle}
            image={image}
            busy={working}
            ready={ready}
            personas={personas}
            onChange={setDraft}
            onTitle={setDraftTitle}
            onImage={setImage}
            onSubmit={send}
            onOpenSettings={() => openSettings()}
          />
          <p className="view-empty">标题可以不写。放出去之后不用守着，有人来会提示你。</p>
        </main>
      )}

      {view === 'detail' && detailCard && (
        <main className="feed">
          <CardDetail
            card={detailCard}
            me={identity}
            personas={personas}
            busy={working}
            onComment={(text, kind, peer) => comment(detailCard, text, kind, peer)}
            onAdvice={() => void advice(detailCard)}
            onShrink={() => patch(detailCard.id, (c) => shrinkAdvice(c))}
            onAccept={() => patch(detailCard.id, (c) => acceptAdvice(c))}
            onDone={() => patch(detailCard.id, (c) => completeCard(c, Date.now(), settings.speed))}
            onCloseCard={() => patch(detailCard.id, (c) => closeCard(c))}
            onBack={() => setView('home')}
            onLike={() => like(detailCard)}
          />
        </main>
      )}

      {view === 'mine' && (
        <main className="feed">
          <div className="view-head">
            <button className="link" onClick={() => setView('home')}>
              ← 回去看卡
            </button>
            <h2>我的卡</h2>
          </div>
          {myCards.length === 0 && <p className="view-empty">你还没放过卡。</p>}
          {myCards.map((card) => (
            <CardRow
                  key={card.id}
                  card={card}
                  personas={personas}
                  onClick={() => openCard(card)}
                  onLike={() => like(card)}
                />
          ))}
          {myCards.length > 0 && <p className="view-empty">点开任意一张，可以继续聊或贴便签。</p>}
        </main>
      )}

      {view === 'profile' && (
        <main className="feed">
          <div className="view-head">
            <button className="link" onClick={() => setView('home')}>
              ← 回去看卡
            </button>
            <h2>我的</h2>
          </div>

          <section className="profile-block">
            <div className="profile-row">
              <Avatar avatarKey={identity.avatarKey} className="me" size="lg" />
              <div>
                <input
                  className="profile-name"
                  value={identity.name}
                  onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                />
                <p className="profile-hint">这个名字会出现在你的卡上</p>
              </div>
            </div>
            <div className="adm-marks">
              {['moon', 'leaf', 'petal', 'wave', 'window', 'pebble'].map((key) => (
                <button
                  key={key}
                  className={`adm-mark ${identity.avatarKey === key ? 'on' : ''}`}
                  onClick={() => setIdentity({ ...identity, avatarKey: key })}
                >
                  <Avatar avatarKey={key} size="sm" />
                </button>
              ))}
            </div>
          </section>

          <section className="profile-block">
            <h3>我帮过的人</h3>
            {helped.length === 0 && (
              <p className="view-empty">
                还没有。你在别人卡下给过建议、对方试了，就会出现在这里。
              </p>
            )}
            {helped.map((c) => (
              <div className="helped-row" key={c.id}>
                <b>{c.authorName}</b>
                <span>你建议：{c.advice?.text}</span>
              </div>
            ))}
          </section>

          <section className="profile-block">
            <h3>数据与应用</h3>
            <div className="adm-actions">
              <button className="btn btn-ghost" onClick={() => openSettings()}>
                API 设置
              </button>
              <button className="btn btn-ghost" onClick={() => setAdminOpen(true)}>
                作者后台
              </button>
              <button className="btn btn-ghost" onClick={() => setOnboardOpen(true)}>
                怎么玩
              </button>
              <button className="btn btn-ghost" onClick={doExport}>
                导出
              </button>
              <button
                className="btn btn-ghost danger"
                onClick={() => {
                  if (confirm('清空本机所有数据？建议先导出。')) doClear();
                }}
              >
                重置软件内容
              </button>
            </div>
            <p className="view-empty">
              这里的 {personas.length} 位同伴都是 AI。他们不是心理咨询师，内容不构成医疗建议。
            </p>
          </section>
        </main>
      )}

      {toast && <div className="toast">{toast}</div>}

      <button className="drawer-tab" onClick={() => setDrawerOpen(true)}>
        便签{noteCount > 0 ? ` · ${noteCount}` : ''}
      </button>

      {drawerOpen && (
        <NoteDrawer
          todos={todos}
          cards={cards}
          personas={personas}
          onAdd={addTodo}
          onToggle={toggleTodo}
          onBrag={openBrag}
          onOpenCard={(card) => {
            setDrawerOpen(false);
            openCard(card);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {bragTodo && (
        <div
          className="scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBragTodo(null);
          }}
        >
          <div className="sheet brag-sheet" role="dialog" aria-modal="true" aria-label="发个炫耀">
            <div className="sheet-head">
              <div>
                <h2>发个炫耀</h2>
                <p>做到了「{bragTodo.text}」。要不要让店里的人看见？</p>
              </div>
              <button className="icon-btn" onClick={() => setBragTodo(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <label className="field">
              <span className="field-label">标题（可以不写）</span>
              <input value={bragTitle} onChange={(e) => setBragTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">想说的话</span>
              <textarea rows={3} value={bragText} onChange={(e) => setBragText(e.target.value)} />
            </label>
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={() => setBragTodo(null)}>
                算了
              </button>
              <button className="btn btn-primary" onClick={submitBrag} disabled={!bragText.trim()}>
                发出去
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="tabbar">
        {(
          [
            ['home', '看卡'],
            ['post', '发一张'],
            ['mine', '我的卡'],
            ['profile', '我的'],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`tab ${view === id ? 'on' : ''}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {onboardOpen && (
        <Tour
          onNavigate={(next) => setView(next)}
          onClose={() => {
            localStorage.setItem('startnow.onboarded', '1');
            setOnboardOpen(false);
          }}
        />
      )}

      <footer className="foot">
        <div className="foot-inner">
          <p className="foot-brand">StartNow论坛</p>
          <p>StartNow 不保证长期陪伴，只帮你看清当下能做的最小一步。</p>
          <p>
            这里的同伴都是 AI。如有伤害自己的念头，请拨打 <strong>12356</strong> 心理援助热线。
          </p>
        </div>
      </footer>

      {detailCard && view !== 'detail' && null}

      {settingsOpen && (
        <SettingsDialog
          config={config}
          notice={settingsNotice}
          onSave={(next) => {
            setConfig(next);
            saveConfig(next);
            setSettingsOpen(false);
            setSettingsNotice('');
          }}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsNotice('');
          }}
        />
      )}

      {adminOpen && (
        <AdminPanel
          personas={personas}
          settings={settings}
          identity={identity}
          world={world}
          onChangePersona={patchPersona}
          onChangeSettings={setSettings}
          onChangeIdentity={setIdentity}
          onMemory={setMemory}
          onPersonas={setPersonas}
          onTick={() => void nudge()}
          onSummon={summon}
          onPostAs={postAs}
          onExport={doExport}
          onImport={doImport}
          onReseed={doReseed}
          onClear={doClear}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  );
}
