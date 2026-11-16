import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './components/Avatar';
import CardDetail from './components/CardDetail';
import CardRow from './components/CardRow';
import CardDeck from './components/CardDeck';
import GuideCard from './components/GuideCard';
import NoteDrawer from './components/NoteDrawer';
import PostForm from './components/PostForm';
import StepBoard from './components/StepBoard';
import Tour from './components/Tour';
import CrisisCard from './components/CrisisCard';
import { isMock, isReady } from './config/providers';
import { HOTLINE } from './lib/crisis';
import { findCrisis } from './lib/safety';
import {
  acceptAdvice,
  addPlayerComment,
  askForAdvice,
  catchUp,
  closeCard,
  completeCard,
  createPlayerCard,
  notePlayerShare,
  personaBrag,
  personaCard,
  shrinkAdvice,
  summonPersona,
  tickCards,
} from './lib/cards';
import { buildGuideCard, buildSeedCards, seedMemories } from './lib/seed';
import { ensureMinds } from './lib/mind';
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
  Comment,
  Identity,
  LlmConfig,
  MemoryEntry,
  Persona,
  Todo,
  World,
  WorldSettings,
} from './types';

const TICK_MS = 4000;

const AdminPanel = lazy(() => import('./components/AdminPanel'));
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));

const AVATAR_COLORS: Record<string, string> = {
  moon: '#7BA3C9',
  leaf: '#8FB78E',
  petal: '#E8634A',
  waves: '#A78BC4',
  window: '#E8A87C',
  pebble: '#8C847A',
};

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
      return {
        cards: buildSeedCards(),
        personas: ensureMinds(seedMemories(defaultPersonas())),
      };
    }
    if (needsUpgrade()) {
      const personas = loadPersonas();
      const seeded = personas.every((p) => p.memory.length === 0)
        ? seedMemories(personas)
        : personas;
      return { cards: withGuide(loadCards()), personas: ensureMinds(seeded) };
    }
    return { cards: withGuide(loadCards()), personas: ensureMinds(loadPersonas()) };
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
  const [homeTab, setHomeTab] = useState<'step' | 'forum'>(
    () => (localStorage.getItem('startnow.homeTab') === 'forum' ? 'forum' : 'step'),
  );
  const [deckIndex, setDeckIndex] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [detailPeer, setDetailPeer] = useState('');
  const [detailId, setDetailId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [crisis, setCrisis] = useState('');
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [brag, setBrag] = useState<{ id?: string; text: string } | null>(null);
  const [bragText, setBragText] = useState('');
  const [bragTitle, setBragTitle] = useState('');
  const brandClicks = useRef<number[]>([]);
  const busy = useRef(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [, refreshClock] = useState(0);

  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => savePersonas(personas), [personas]);
  useEffect(() => saveWorld(world), [world]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveIdentity(identity), [identity]);
  useEffect(() => saveTodos(todos), [todos]);
  useEffect(() => localStorage.setItem('startnow.mode', mode), [mode]);
  useEffect(() => localStorage.setItem('startnow.homeTab', homeTab), [homeTab]);

  useEffect(() => {
    const id = window.setInterval(() => refreshClock((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!bellOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBellOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);

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
      const nowTs = Date.now();
      const lastBrag = cur.world.lastBragAt ?? 0;
      const bragDue =
        lastBrag > 0 && nowTs - lastBrag > 5 * 3_600_000 && cur.personas.length > 0;
      const extra = bragDue
        ? [personaBrag(cur.personas[Math.floor(Math.random() * cur.personas.length)], nowTs)]
        : [];
      setCards(extra.length ? [...out.cards, ...extra] : out.cards);
      setPersonas(out.personas);
      const day = dayKey(nowTs);
      setWorld((w) => ({
        ...w,
        dayKey: day,
        callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls,
        lastTickAt: nowTs,
        lastBragAt: extra.length ? nowTs : w.lastBragAt ?? nowTs,
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
    if (findCrisis(text)) {
      setCrisis(text);
      return;
    }
    if (!ready) {
      setSettingsNotice('先接入一个 API，或者切到演示模式。');
      setSettingsOpen(true);
      return;
    }
    const card = createPlayerCard(text, identity.name, personas, settings, draftTitle);
    if (image) card.image = image;
    setPersonas((prev) => notePlayerShare(prev, text));
    setCards((prev) => [card, ...prev]);
    setDraft('');
    setDraftTitle('');
    setImage('');
    setView('home');
    setToast('卡放出去了，等一会儿有人来');
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
    setBrag({ id: todo.id, text: todo.text });
    setBragText(`做到了：${todo.text}`);
    setBragTitle('');
  };

  const openCardBrag = (text: string) => {
    setDrawerOpen(false);
    setBrag({ text });
    setBragText(`做到了：${text}`);
    setBragTitle('');
  };

  const submitBrag = () => {
    if (!brag || !bragText.trim()) return;
    if (findCrisis(bragText)) {
      setBrag(null);
      setCrisis(bragText);
      return;
    }
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
    if (brag.id) {
      setTodos((prev) =>
        prev.map((t) => (t.id === brag.id ? { ...t, doneAt: t.doneAt ?? Date.now() } : t)),
      );
    }
    setBrag(null);
    setDrawerOpen(false);
    setView('home');
    setToast('炫耀帖发出去了');
  };

  const advance = async (hours: number) => {
    const cur = latest.current;
    const shift = hours * 3_600_000;
    const shifted = cur.cards.map((c) => ({
      ...c,
      createdAt: c.createdAt - shift,
      helperAt: c.helperAt ? c.helperAt - shift : undefined,
      plan: c.plan.map((p) => ({ ...p, at: p.at - shift })),
      pending: c.pending.map((p) => ({ ...p, at: p.at - shift })),
      note: c.note ? { ...c.note, dueAt: c.note.dueAt - shift } : undefined,
      comments: c.comments.map((x) => ({ ...x, at: x.at - shift })),
    }));
    setCards(shifted);
    busy.current = false;
    let res: { cards: Card[]; personas: Persona[]; calls: number } = {
      cards: shifted,
      personas: cur.personas,
      calls: 0,
    };
    try {
      res = await catchUp({
        cards: shifted,
        personas: cur.personas,
        settings: cur.settings,
        config: cur.config,
        hours,
      });
    } catch {
      res = { cards: shifted, personas: cur.personas, calls: 0 };
    }
    setCards(res.cards);
    setPersonas(res.personas);
    if (res.calls) {
      setWorld((w) => ({ ...w, callsToday: w.callsToday + res.calls }));
    }
    setDeckIndex(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setToast(
      `过了 ${hours} 小时，多了 ${Math.max(0, res.cards.length - shifted.length)} 张卡`,
    );
    await tick({ cards: res.cards });
  };

  const openCard = (card: Card, peer?: string) => {
    setDetailPeer(peer ?? '');
    setDetailId(card.id);
    patch(card.id, (c) => ({
      ...c,
      seenAt: c.seenAt ?? Date.now(),
      readAt: Date.now(),
    }));
    setBellOpen(false);
    setView('detail');
  };

  const comment = (card: Card, text: string, kind: 'comment' | 'advice', peer?: string) => {
    if (findCrisis(text)) {
      setCrisis(text);
      return;
    }
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
      setPersonas(out.personas);
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
    setPersonas(ensureMinds(bundle.personas));
    setWorld(bundle.world);
    setSettings(bundle.settings);
    setIdentity(bundle.identity);
    setAdminOpen(false);
  };

  const doClear = () => {
    clearAll();
    setCards([buildGuideCard()]);
    setPersonas(ensureMinds(defaultPersonas()));
    setWorld(emptyWorld());
    setSettings({ ...defaultSettings });
    setIdentity(loadIdentity());
    setAdminOpen(false);
    setView('home');
  };

  const doReseed = () => {
    setCards(buildSeedCards());
    setPersonas((prev) => ensureMinds(seedMemories(prev)));
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
  const helped = cards
    .filter((c) => c.advice?.accepted && c.advice.fromPersonaId === 'me')
    .sort((a, b) => b.createdAt - a.createdAt);
  const detailCard = cards.find((c) => c.id === detailId);
  const doneToday =
    todos.filter((t) => t.doneAt && t.doneAt >= todayStart).length +
    myCards.filter((c) => c.doneAt && c.doneAt >= todayStart).length;
  const notices = useMemo(() => {
    const out: { card: Card; comment: Comment; persona?: Persona }[] = [];
    cards.forEach((c) => {
      if (c.kind === 'guide') return;
      const since = c.readAt ?? 0;
      const latest = [...c.comments]
        .reverse()
        .find(
          (x) => x.authorKind === 'persona' && x.authorId !== 'helper' && x.at > since,
        );
      const participated =
        c.authorId === 'me' || c.comments.some((x) => x.authorKind === 'player');
      if (!latest || !participated) return;
      out.push({
        card: c,
        comment: latest,
        persona: personas.find((p) => p.id === latest.authorId),
      });
    });
    return out.sort((a, b) => b.comment.at - a.comment.at);
  }, [cards, personas]);

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
        <div className="top-inner">
          <button type="button" className="brand" onClick={bumpBrand} title="StartNow">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3c.6 3.8-1.8 5-1.8 7.4a4.2 4.2 0 0 0 2.4 3.8A3 3 0 0 1 12 18c-1.8 0-3-1-3-3 0-1.9 1.2-3.1 3-5.6Z"
                  fill="currentColor"
                />
                <path
                  d="M6 16.5c.3 1.8 1.4 2.4 1.4 3.9 0 .8-.7 1.3-1.4 1.3s-1.4-.5-1.4-1.3c0-1.5 1.1-2.1 1.4-3.9Z"
                  fill="currentColor"
                  opacity="0.7"
                />
              </svg>
            </span>
            <span className="brand-text">
              <span className="brand-name">先动一下</span>
              <span className="brand-sub">四个 AI 同学的互助小圈子</span>
            </span>
          </button>
          <div className="top-actions">
          <div className="bell-wrap" ref={bellRef}>
            <button
              className="bell-btn"
              onClick={() => setBellOpen((v) => !v)}
              aria-label="回复通知"
              aria-expanded={bellOpen}
              aria-controls="bell-panel"
            >
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M6.8 16.4V11a5.2 5.2 0 0 1 10.4 0v5.4l1.4 1.8H5.4l1.4-1.8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M10.2 20.2a2 2 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {notices.length > 0 && (
                <span className="bell-dot">{notices.length > 9 ? '9+' : notices.length}</span>
              )}
            </button>
            {bellOpen && (
              <div className="bell-panel" id="bell-panel">
                <p className="bell-title">有人回了你</p>
                {notices.length === 0 && <p className="bell-empty">还没有新的回复。</p>}
                {notices.map((n) => (
                  <button
                    key={n.comment.id}
                    className="bell-item"
                    onClick={() => openCard(n.card, n.comment.authorId)}
                  >
                    <span className="bell-who">{n.persona?.name ?? '有人'}</span>
                    <span className="bell-text">{n.comment.text}</span>
                    <span className="bell-card">{n.card.title ?? n.card.text.slice(0, 12)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="avatar-btn" onClick={() => setView('profile')} aria-label="我的">
            <Avatar avatarKey={identity.avatarKey} className="me" size="sm" />
          </button>
        </div>
        </div>
      </header>

      <div className="page-wrap">
        <div className="layout">
          <aside className="sidebar">
            <nav className="side-nav" aria-label="主导航">
              <button
                type="button"
                className={`nav-item ${
                  view === 'home' && homeTab === 'step' ? 'active' : ''
                }`}
                aria-current={view === 'home' && homeTab === 'step' ? 'page' : undefined}
                onClick={() => {
                  setHomeTab('step');
                  setView('home');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                下一步
              </button>
              <button
                type="button"
                className={`nav-item ${
                  (view === 'home' && homeTab === 'forum') || view === 'detail' ? 'active' : ''
                }`}
                aria-current={
                  (view === 'home' && homeTab === 'forum') || view === 'detail' ? 'page' : undefined
                }
                onClick={() => {
                  setHomeTab('forum');
                  setView('home');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="15" rx="3" />
                  <path d="M8 9h8M8 13h5" />
                </svg>
                论坛
              </button>
              <button
                type="button"
                className={`nav-item ${view === 'post' ? 'active' : ''}`}
                aria-current={view === 'post' ? 'page' : undefined}
                onClick={() => setView('post')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                发一张卡
              </button>
              <button
                type="button"
                className={`nav-item ${view === 'profile' || view === 'mine' ? 'active' : ''}`}
                aria-current={view === 'profile' || view === 'mine' ? 'page' : undefined}
                onClick={() => setView('profile')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </svg>
                我的
              </button>
            </nav>

            <div className="side-section">
              <p className="side-label">设置</p>
              <nav className="side-nav" aria-label="设置">
                <button type="button" className="nav-item" onClick={() => openSettings()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M4 7h9M18 7h2M4 17h3M12 17h8" />
                    <circle cx="15.5" cy="7" r="2.2" />
                    <circle cx="9.5" cy="17" r="2.2" />
                  </svg>
                  API 设置
                </button>
                <button type="button" className="nav-item" onClick={() => setAdminOpen(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" />
                  </svg>
                  作者后台
                </button>
              </nav>
            </div>

            <div className="side-section">
              <button type="button" className="user-chip" onClick={() => setView('profile')}>
                <Avatar avatarKey={identity.avatarKey} className="me" size="sm" />
                <span className="user-chip-text">
                  <b>{identity.name}</b>
                  <small>今日已完成 {doneToday} 件</small>
                </span>
              </button>
            </div>
          </aside>

          <main className="main">
      {view === 'home' && (
        <div className="feed">
          {homeTab === 'step' && (
            <StepBoard
              cards={cards}
              todos={todos}
              personas={personas}
              busy={working}
              onOpenCard={openCard}
              onAccept={(card) => patch(card.id, (c) => acceptAdvice(c))}
              onShrink={(card) => patch(card.id, (c) => shrinkAdvice(c))}
              onDone={(card) => patch(card.id, (c) => completeCard(c, Date.now(), settings.speed))}
              onAdvice={(card) => void advice(card)}
              onWrite={() => setView('post')}
              onForum={() => setHomeTab('forum')}
              onAddTodo={addTodo}
              onToggleTodo={toggleTodo}
              onBrag={openBrag}
              onBragCard={openCardBrag}
              onOpenMine={() => setView('mine')}
            />
          )}

          {homeTab === 'forum' && (
            <>
              <div className="page-head">
                <div>
                  <h1 className="page-title">大家在说什么</h1>
                  <p className="page-sub">看看别人卡在哪，也许你也有同感</p>
                </div>
                <div className="page-head-tools">
                  <span className="masthead-date">
                    {personas.length} 位同伴 · 今天 {todays.length} 张卡
                  </span>
                  <div className="mode-switch" role="group" aria-label="显示方式">
                    <button
                      className={mode === 'card' ? 'on' : ''}
                      aria-pressed={mode === 'card'}
                      onClick={() => setMode('card')}
                    >
                      卡片
                    </button>
                    <button
                      className={mode === 'list' ? 'on' : ''}
                      aria-pressed={mode === 'list'}
                      onClick={() => setMode('list')}
                    >
                      列表
                    </button>
                  </div>
                </div>
              </div>

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
            </>
          )}
        </div>
      )}

      {view === 'post' && (
        <div className="feed">
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
        </div>
      )}

      {view === 'detail' && detailCard && (
        <div className="feed">
          <CardDetail
            card={detailCard}
            me={identity}
            initialPeer={detailPeer}
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
        </div>
      )}

      {view === 'mine' && (
        <div className="feed">
          <div className="page-head">
            <div>
              <h1 className="page-title">我的卡</h1>
              <p className="page-sub">你放出去的每一张，都在这里</p>
            </div>
            <button
              className="link"
              onClick={() => {
                setHomeTab('step');
                setView('home');
              }}
            >
              ← 回到下一步
            </button>
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
        </div>
      )}

      {view === 'profile' && (
        <div className="feed">
          <div className="page-head">
            <div>
              <h1 className="page-title">我的</h1>
              <p className="page-sub">管理你的身份和这件小事</p>
            </div>
          </div>

          <section className="profile-head">
            <Avatar avatarKey={identity.avatarKey} className="me profile-avatar" size="lg" />
            <div className="profile-info">
              <input
                className="profile-name"
                value={identity.name}
                aria-label="你的名字"
                onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
              />
              <p className="profile-hint">这个名字会出现在你的卡上</p>
              <div className="avatar-picker">
                {['moon', 'leaf', 'petal', 'waves', 'window', 'pebble'].map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`avatar-option ${identity.avatarKey === key ? 'on' : ''}`}
                    aria-label={`切换头像 ${key}`}
                    onClick={() => setIdentity({ ...identity, avatarKey: key })}
                  >
                    <Avatar avatarKey={key} color={AVATAR_COLORS[key]} size="sm" />
                  </button>
                ))}
              </div>
            </div>
            <div className="profile-stats">
              <div className="stat">
                <b>{myCards.length}</b>
                <span>发过卡</span>
              </div>
              <div className="stat">
                <b>{helped.length}</b>
                <span>帮过人</span>
              </div>
              <div className="stat">
                <b>{doneToday}</b>
                <span>今日完成</span>
              </div>
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <h3>我帮过的人</h3>
            </div>
            {helped.length === 0 && (
              <div className="empty">
                <div className="empty-title">还没有帮过谁</div>
                <div className="empty-desc">
                  你在别人卡下给过建议、对方试了，就会出现在这里。
                </div>
              </div>
            )}
            {helped.map((c) => (
              <div className="helped-row" key={c.id}>
                <b>{c.authorName}</b>
                <span>你给的下一步：{c.advice?.text}</span>
              </div>
            ))}
            {helped.length > 0 && (
              <p className="profile-fineprint">
                你只是递过一句，接不接、做不做，是他们自己的事。
              </p>
            )}
          </section>

          <section className="card section-card">
            <div className="section-head">
              <h3>数据与应用</h3>
            </div>
            <div className="menu-grid">
              <button type="button" className="menu-item" onClick={() => openSettings()}>
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#E8634A" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>API 设置</b>
                  <span>接入你自己的模型</span>
                </span>
              </button>
              <button type="button" className="menu-item" onClick={() => setAdminOpen(true)}>
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#A78BC4" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>作者后台</b>
                  <span>管理同伴与圈子</span>
                </span>
              </button>
              <button type="button" className="menu-item" onClick={() => setOnboardOpen(true)}>
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#8FB78E" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>怎么玩</b>
                  <span>了解产品玩法</span>
                </span>
              </button>
              <button type="button" className="menu-item" onClick={doExport}>
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#7BA3C9" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 15V3m0 12l-4-4m4 4l4-4" />
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>导出</b>
                  <span>导出你的数据</span>
                </span>
              </button>
              <button
                type="button"
                className="menu-item danger-item"
                onClick={() => {
                  if (confirm('清空本机所有数据？建议先导出。')) doClear();
                }}
              >
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>重置软件内容</b>
                  <span>清空所有本地数据</span>
                </span>
              </button>
            </div>
            <p className="profile-fineprint">
              卡片、便签、同伴记忆和 API Key 只存在这台浏览器；导出文件会包含它们。
            </p>
            <p className="profile-fineprint">
              这里的 {personas.length} 位同伴都是虚构的 AI
              角色，和你在不同学校；不是心理咨询师，内容不构成医疗建议。
            </p>
          </section>
        </div>
      )}
          </main>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {crisis && (
        <div className="crisis-layer">
          <CrisisCard onClose={() => setCrisis('')} />
        </div>
      )}

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
          onBragNote={openCardBrag}
          onOpenCard={(card) => {
            setDrawerOpen(false);
            openCard(card);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {brag && (
        <div
          className="scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setBrag(null);
          }}
        >
          <div className="sheet brag-sheet" role="dialog" aria-modal="true" aria-label="发个炫耀">
            <div className="sheet-head">
              <div>
                <h2>发个炫耀</h2>
                <p>做到了「{brag.text}」。要不要让论坛的人看见？</p>
              </div>
              <button className="icon-btn" onClick={() => setBrag(null)} aria-label="关闭">
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
              <button className="btn btn-ghost" onClick={() => setBrag(null)}>
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
            ['step', '下一步'],
            ['forum', '论坛'],
            ['post', '发一张卡'],
            ['profile', '我的'],
          ] as [string, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`tab ${
              (id === 'step' && view === 'home' && homeTab === 'step') ||
              (id === 'forum' &&
                ((view === 'home' && homeTab === 'forum') || view === 'detail')) ||
              (id === 'profile' && (view === 'profile' || view === 'mine')) ||
              (id !== 'step' && id !== 'forum' && id !== 'profile' && view === id)
                ? 'on'
                : ''
            }`}
            onClick={() => {
              if (id === 'step') {
                setHomeTab('step');
                setView('home');
              } else if (id === 'forum') {
                setHomeTab('forum');
                setView('home');
              } else {
                setView(id as View);
              }
            }}
          >
            {label}
          </button>
        ))}
        <button className="tab" onClick={() => setDrawerOpen(true)}>
          便签{noteCount > 0 ? ` · ${noteCount}` : ''}
        </button>
      </nav>

      {onboardOpen && (
        <Tour
          onNavigate={(next, tab) => {
            if (tab) setHomeTab(tab);
            setView(next);
          }}
          onClose={() => {
            localStorage.setItem('startnow.onboarded', '1');
            setOnboardOpen(false);
          }}
        />
      )}

      <footer className="foot">
        <div className="foot-inner">
          <p className="foot-brand">先动一下 · StartNow</p>
          <p>不保证长期陪伴，只帮你看清当下能做的最小一步。</p>
          <p>
            这里的同伴都是虚构的 AI 同学，和你在不同学校；只在论坛上聊。如有伤害自己的念头，请拨打{' '}
            <strong>{HOTLINE}</strong> 心理援助热线。
          </p>
          {isMock(config) && (
            <p className="foot-demo">当前是演示模式：同伴回复由本地脚本生成，不是真实模型。</p>
          )}
        </div>
      </footer>

      {detailCard && view !== 'detail' && null}

      {settingsOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {adminOpen && (
        <Suspense fallback={null}>
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
            onAdvance={(hours) => void advance(hours)}
            onSummon={summon}
            onPostAs={postAs}
            onExport={doExport}
            onImport={doImport}
            onReseed={doReseed}
            onClear={doClear}
            onClose={() => setAdminOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
