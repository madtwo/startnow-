import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Avatar from './components/Avatar';
import CardDetail from './components/CardDetail';
import CardRow from './components/CardRow';
import GuideCard from './components/GuideCard';
import NoteDrawer from './components/NoteDrawer';
import MemoryManager from './components/MemoryManager';
import PostForm from './components/PostForm';
import StepBoard from './components/StepBoard';
import Tour from './components/Tour';
import CrisisCard from './components/CrisisCard';
import { defaultConfig, isMock, isReady } from './config/providers';
import { HOTLINE } from './lib/crisis';
import { containsCrisis, hasCrisisInArchive } from './lib/submissionGuard';
import { createOperationGate } from './lib/operationGate';
import { advanceBragMinutes, cancelBragsForNewWorry, cancelBragsForPersona, triggerNextBrag } from './lib/brag';
import { forgetAll, forgetOne, forgetRole } from './lib/memoryControl';
import { modelFailureNotice } from './lib/modelStatus';
import {
  acceptAdvice,
  addPlayerComment,
  adoptCommentAdvice,
  askForAdvice,
  catchUp,
  closeCard,
  completeCard,
  createPlayerCard,
  notePlayerShare,
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
  deleteLegacyPosts,
  listLegacyPostKeys,
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
const GUIDE_DISMISSED_KEY = 'startnow.guideDismissed';

const AdminPanel = lazy(() => import('./components/AdminPanel'));
const SettingsDialog = lazy(() => import('./components/SettingsDialog'));
const RoomView = lazy(() => import('./components/RoomView'));

const AVATAR_COLORS: Record<string, string> = {
  moon: '#7BA3C9',
  leaf: '#8FB78E',
  petal: '#E8634A',
  waves: '#A78BC4',
  window: '#E8A87C',
  pebble: '#8C847A',
};

type View = 'home' | 'post' | 'mine' | 'profile' | 'detail' | 'room';

const FORUM_CATS = ['学习', '情绪', '生活', '延期记录', '全部'] as const;
const CAT_KEYWORDS: Record<string, string[]> = {
  学习: ['学习', '复习', '作业', '论文', '考试', '上课', '笔记', '背书', '读书', '课程'],
  情绪: ['情绪', '焦虑', '难过', '压力', '烦', '累', '害怕', '崩溃', '开心'],
  生活: ['生活', '起床', '吃饭', '睡', '房间', '洗', '运动', '出门', '桌面', '整理'],
  延期记录: ['延期', '延后', '拖延', '明天', '下周', '之后', '推迟', '改天'],
};

function forumCategory(card: Card) {
  const text = `${card.title ?? ''}${card.text}`;
  const hit = Object.entries(CAT_KEYWORDS).find(([, words]) => words.some((w) => text.includes(w)));
  return hit?.[0] ?? '生活';
}

function cardStatusLabel(card: Card) {
  if (card.status === 'done') return '做到了';
  if (card.status === 'handled') return '已收起';
  if (card.status === 'noted') return '已贴便签';
  return card.comments.length > 0 ? '有回应' : '还在等';
}

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
  // 同步变更时立即推进版本号，不依赖 React 下一次 render 的时间。
  const gate = useRef(createOperationGate());
  const tickAfterCommit = useRef<'full' | 'brag' | null>(null);
  const [config, rawSetConfig] = useState<LlmConfig>(() => loadConfig());
  const [cards, rawSetCards] = useState<Card[]>(boot.cards);
  const [personas, rawSetPersonas] = useState<Persona[]>(boot.personas);
  const [world, rawSetWorld] = useState<World>(() => loadWorld());
  const [settings, rawSetSettings] = useState<WorldSettings>(() => loadSettings());
  const [identity, rawSetIdentity] = useState<Identity>(() => loadIdentity());
  const touch = () => { gate.current.change(); };
  const setConfig: Dispatch<SetStateAction<LlmConfig>> = (next) => { touch(); rawSetConfig(next); };
  const setCards: Dispatch<SetStateAction<Card[]>> = (next) => { touch(); rawSetCards(next); };
  const setPersonas: Dispatch<SetStateAction<Persona[]>> = (next) => { touch(); rawSetPersonas(next); };
  const setWorld: Dispatch<SetStateAction<World>> = (next) => { touch(); rawSetWorld(next); };
  const setSettings: Dispatch<SetStateAction<WorldSettings>> = (next) => { touch(); rawSetSettings(next); };
  const setIdentity: Dispatch<SetStateAction<Identity>> = (next) => { touch(); rawSetIdentity(next); };
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [image, setImage] = useState('');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [onboardOpen, setOnboardOpen] = useState(
    () => localStorage.getItem('startnow.onboarded') !== '1',
  );
  const [guideDismissed, setGuideDismissed] = useState(
    () => localStorage.getItem(GUIDE_DISMISSED_KEY) === '1',
  );
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).has('room') ? 'room' : 'home',
  );
  const [homeTab, setHomeTab] = useState<'step' | 'forum'>(
    () => (localStorage.getItem('startnow.homeTab') === 'forum' ? 'forum' : 'step'),
  );
  const [forumQuery, setForumQuery] = useState('');
  const [forumCat, setForumCat] = useState<(typeof FORUM_CATS)[number]>('全部');
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailPeer, setDetailPeer] = useState('');
  const [detailId, setDetailId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [crisis, setCrisis] = useState('');
  const [todos, rawSetTodos] = useState<Todo[]>(() => loadTodos());
  const setTodos: Dispatch<SetStateAction<Todo[]>> = (next) => { touch(); rawSetTodos(next); };
  const [legacyKeys, setLegacyKeys] = useState<string[]>(() => listLegacyPostKeys());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [brag, setBrag] = useState<{ id?: string; text: string } | null>(null);
  const [bragText, setBragText] = useState('');
  const [bragTitle, setBragTitle] = useState('');
  const brandClicks = useRef<number[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, refreshClock] = useState(0);

  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => savePersonas(personas), [personas]);
  useEffect(() => saveWorld(world), [world]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveIdentity(identity), [identity]);
  useEffect(() => saveTodos(todos), [todos]);
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

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const ready = isReady(config);
  const latest = useRef({ cards, personas, world, settings, config, working });
  latest.current = { cards, personas, world, settings, config, working };

  const guardSubmission = (...parts: (string | undefined | null)[]): boolean => {
    if (!containsCrisis(parts)) return false;
    // 不把敏感原文复制到额外的 React 状态或日志中。
    setCrisis('show');
    return true;
  };

  const tick = useCallback(async (bragOnly = false) => {
    if (document.hidden) return;
    const cur = latest.current;
    if (cur.settings.paused || !isReady(cur.config)) return;
    if (cur.world.dayKey === dayKey(Date.now()) &&
        cur.world.callsToday >= cur.settings.dailyCalls && !isMock(cur.config)) return;
    const operation = gate.current.start('tick');
    if (!operation) return;
    const revision = gate.current.revision();
    const baseCards = cur.cards;
    try {
      const out = await tickCards({
        cards: baseCards,
        personas: cur.personas,
        settings: cur.settings,
        config: cur.config,
        bragOnly,
      });
      if (!gate.current.isCurrent(operation, revision) || latest.current.cards !== baseCards) {
        // 已调用的模型仍计入本机配额，但不能写入过时的卡片和记忆。
        if (out.calls) {
          const day = dayKey(Date.now());
          setWorld((w) => ({ ...w, dayKey: day,
            callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls }));
        }
        setToast('有新内容，旧回复已跳过；后台会再试');
        return;
      }
      const before = new Map(
        baseCards.filter((c) => c.authorId === 'me').map((c) => [c.id, c.comments.length]),
      );
      const fresh = out.cards.find(
        (c) => c.authorId === 'me' && (before.get(c.id) ?? 0) < c.comments.length,
      );
      if (fresh) {
        const last = fresh.comments[fresh.comments.length - 1];
        const who = cur.personas.find((p) => p.id === last?.authorId)?.name ?? '有人';
        setToast(`${who} 来了你的卡`);
      }
      // Retire the unrelated every-five-hours canned brag; accepted advice owns this path.
      const nowTs = Date.now();
      const fired = out.cards.find((c) => c.kind === 'brag' && c.sourceCardId &&
        !baseCards.some((existing) => existing.id === c.id));
      setCards(out.cards);
      if (fired) setToast(`${fired.authorName} 发来一张新卡 · AI 剧情模拟`);
      setPersonas(out.personas);
      const day = dayKey(nowTs);
      setWorld((w) => ({
        ...w,
        dayKey: day,
        callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls,
        lastTickAt: nowTs,
        lastBragAt: w.lastBragAt, // legacy field kept for archive compatibility
        logs: [...out.logs, ...w.logs].slice(0, 20),
      }));
      const failureNotice = modelFailureNotice(out.logs);
      if (failureNotice) setToast(failureNotice);
    } catch {
      // 不让 setInterval 的异步异常成为未处理 Promise；不冒充角色回帖。
      setToast('模型暂时不可用，后台稍后再试');
    } finally {
      gate.current.finish(operation);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void tick(), TICK_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, tick]);

  // React 提交 nudge/advance 的新卡片后才运行 tick，避免 latest 引用尚未更新。
  useEffect(() => {
    const pending = tickAfterCommit.current;
    if (!pending) return;
    tickAfterCommit.current = null;
    void tick(pending === 'brag');
  }, [cards, tick]);

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
    if (guardSubmission(text, draftTitle)) return;
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

  const addTodo = (text: string) => {
    if (guardSubmission(text)) return;
    setTodos((prev) => [{ id: crypto.randomUUID(), text, at: Date.now() }, ...prev]);
  };

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
    if (guardSubmission(bragText, bragTitle)) {
      setBrag(null);
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
    const operation = gate.current.start('advance');
    if (!operation) {
      setToast('后台正在处理另一个任务，稍后再推进时间');
      return;
    }
    const cur = latest.current;
    const shift = hours * 3_600_000;
    const shifted = cur.cards.map((c) => ({
      ...c,
      createdAt: c.createdAt - shift,
      helperAt: c.helperAt ? c.helperAt - shift : undefined,
      plan: c.plan.map((p) => ({ ...p, at: p.at - shift })),
      pending: c.pending.map((p) => ({ ...p, at: p.at - shift })),
      pendingBrag: c.pendingBrag ? {
        ...c.pendingBrag, acceptedAt: c.pendingBrag.acceptedAt - shift,
        dueAt: c.pendingBrag.dueAt - shift,
      } : undefined,
      note: c.note ? { ...c.note, dueAt: c.note.dueAt - shift } : undefined,
      comments: c.comments.map((x) => ({ ...x, at: x.at - shift })),
    }));
    setCards(shifted);
    const revision = gate.current.revision();
    try {
      const res = await catchUp({
        cards: shifted, personas: cur.personas, settings: cur.settings, config: cur.config, hours,
      });
      if (!gate.current.isCurrent(operation, revision)) {
        if (res.calls) {
          const day = dayKey(Date.now());
          setWorld((w) => ({ ...w, dayKey: day,
            callsToday: (w.dayKey === day ? w.callsToday : 0) + res.calls }));
        }
        setToast('有新消息，时间推进的旧结果已跳过');
        return;
      }
      // 先预约 effect，React 提交新卡片时才触发下一次 tick。
      tickAfterCommit.current = 'full';
      setCards(res.cards);
      setPersonas(res.personas);
      if (res.calls) {
        const day = dayKey(Date.now());
        setWorld((w) => ({ ...w, dayKey: day,
          callsToday: (w.dayKey === day ? w.callsToday : 0) + res.calls }));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setToast(`过了 ${hours} 小时，多了 ${Math.max(0, res.cards.length - shifted.length)} 张卡`);
    } catch {
      setToast('时间已推进，但生成新卡失败；后台计时器会继续尝试');
    } finally {
      gate.current.finish(operation);
    }
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

  const comment = (card: Card, text: string, kind: 'comment' | 'advice', peer?: string, replyTo?: string) => {
    if (guardSubmission(text)) return false;
    if (!card.noMemory) setPersonas((prev) => notePlayerShare(prev, text));
    patch(card.id, (c) => addPlayerComment(c, text, Date.now(), settings.speed, kind, peer, replyTo));
    return true;
  };

  const adoptReply = (card: Card, commentId: string) => {
    const checked = adoptCommentAdvice(card, commentId, personas);
    if (checked.error) {
      setToast(checked.error);
      return;
    }
    patch(card.id, (current) => adoptCommentAdvice(current, commentId, personas).card);
    setToast('已把这条回复作为下一步');
  };

  const advice = async (card: Card, personaId?: string) => {
    if (guardSubmission(card.text, card.title,
      ...card.comments.filter((c) => c.authorKind === 'player').map((c) => c.text))) return;
    const operation = gate.current.start('advice');
    if (!operation) {
      setToast('同伴正在处理另一条消息，稍后再点下一步');
      return;
    }
    const cur = latest.current;
    const revision = gate.current.revision();
    setWorking(true);
    try {
      const out = await askForAdvice({
        cards: cur.cards, personas: cur.personas, settings: cur.settings,
        config: cur.config, cardId: card.id, personaId,
      });
      if (!gate.current.isCurrent(operation, revision) || latest.current.cards !== cur.cards) {
        if (out.calls) {
          const day = dayKey(Date.now());
          setWorld((w) => ({ ...w, dayKey: day,
            callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls }));
        }
        setToast('刚才有新消息，下一步再点一次');
        return;
      }
      setCards(out.cards);
      setPersonas(out.personas);
      if (out.calls) {
        const day = dayKey(Date.now());
        setWorld((w) => ({ ...w, dayKey: day,
          callsToday: (w.dayKey === day ? w.callsToday : 0) + out.calls }));
      }
      if (out.logs.length) {
        setWorld((w) => ({ ...w, logs: [...out.logs, ...w.logs].slice(0, 20) }));
      }
      const failureNotice = modelFailureNotice(out.logs);
      if (failureNotice) setToast(failureNotice);
    } catch {
      setToast('暂时无法获取下一步，请稍后重试');
    } finally {
      gate.current.finish(operation);
      setWorking(false);
    }
  };

  const nudge = () => {
    if (gate.current.running()) {
      setToast('后台正在处理消息，稍后再触发');
      return;
    }
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
      return { ...c, pending: c.pending.map((p, i) =>
        (i === target.idx ? { ...p, at: now - 1 } : p)) };
    });
    tickAfterCommit.current = 'full';
    setCards(next);
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
    const now = Date.now();
    const newWorry = personaCard(persona, now);
    const cancelled = cancelBragsForNewWorry(latest.current.cards, newWorry, now);
    setCards([newWorry, ...cancelled.cards]);
    if (cancelled.cancelled.length) {
      setWorld((world) => ({ ...world, logs: [
        ...cancelled.cancelled.map((id) => `brag cancelled: newer worry · ${persona.name} · sourceCardId=${id}`),
        ...world.logs,
      ].slice(0, 20) }));
    }
  };

  /** Debug actions change ONLY pending deadlines; they never backdate the forum feed. */
  const advanceBrags = (minutes: number) => {
    if (gate.current.running()) { setToast('另一条模型任务进行中，请稍后测试'); return; }
    if (settings.paused) { setToast('先在作者后台取消暂停，再测试炫耀任务'); return; }
    tickAfterCommit.current = 'brag';
    setCards((prev) => advanceBragMinutes(prev, minutes));
    setToast(`炫耀排期已快进 ${minutes} 分钟；不会生成其他新烦恼`);
  };
  const fireNextBrag = () => {
    if (gate.current.running()) { setToast('另一条模型任务进行中，请稍后测试'); return; }
    if (!cards.some((c) => c.pendingBrag)) { setToast('当前没有等待中的炫耀卡'); return; }
    tickAfterCommit.current = 'brag';
    setCards((prev) => triggerNextBrag(prev));
  };
  const cancelBrags = (personaId: string) => {
    if (gate.current.running()) { setToast('另一条模型任务进行中，请稍后测试'); return; }
    const result = cancelBragsForPersona(cards, personaId);
    setCards(result.cards);
    setWorld((w) => ({ ...w, logs: [
      ...result.cancelled.map((id) => `brag cancelled: author test · personaId=${personaId} · sourceCardId=${id}`),
      ...w.logs,
    ].slice(0, 20) }));
    setToast(`取消了 ${result.cancelled.length} 条待发炫耀`);
  };

  const patchPersona = (next: Persona) =>
    setPersonas((prev) => prev.map((p) => (p.id === next.id ? next : p)));

  const setMemory = (personaId: string, memory: MemoryEntry[]) => {
    if (memory.some((m) => guardSubmission(m.about, m.what))) return;
    setPersonas((prev) => prev.map((p) => (p.id === personaId ? { ...p, memory } : p)));
  };

  const applyMemoryChange = (next: { cards: Card[]; personas: Persona[] }) => {
    setCards(next.cards);
    setPersonas(next.personas);
  };
  const forgetMemoryEntry = (personaId: string, entryId: string) =>
    applyMemoryChange(forgetOne(cards, personas, personaId, entryId));
  const forgetPersonaMemory = (personaId: string) => {
    if (window.confirm('删除这个角色的长期记忆？原帖仍会保留。')) {
      applyMemoryChange(forgetRole(cards, personas, personaId));
    }
  };
  const forgetAllMemory = () => {
    if (window.confirm('清空所有角色的长期记忆？旧备份导入后可能恢复。')) {
      applyMemoryChange(forgetAll(cards, personas));
    }
  };

  const doExport = () => {
    const raw = exportBundle({ cards, personas, world, settings, identity, todos });
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

  const dismissGuide = () => {
    setGuideDismissed(true);
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1');
  };

  const showRules = () => {
    setGuideDismissed(false);
    localStorage.removeItem(GUIDE_DISMISSED_KEY);
    setHomeTab('forum');
    setView('home');
  };

  const resetGuideDismissed = () => {
    setGuideDismissed(false);
    localStorage.removeItem(GUIDE_DISMISSED_KEY);
  };

  const clearNotices = () => {
    const now = Date.now();
    setCards((prev) =>
      prev.map((c) => (c.kind === 'guide' ? c : { ...c, readAt: now })),
    );
    setBellOpen(false);
  };

  const doImport = (raw: string) => {
    try {
      if (hasCrisisInArchive(JSON.parse(raw))) {
        setCrisis('show');
        setToast('该存档含危机表达，未导入任何数据');
        return;
      }
    } catch {
      // 非 JSON 仍交给现有导入校验显示错误。
    }
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
    setTodos(bundle.todos ?? []);
    setLegacyKeys(listLegacyPostKeys());
    resetGuideDismissed();
    setAdminOpen(false);
  };

  const doClear = () => {
    clearAll();
    // 清除持有的 Key 和便签；不能只删除 localStorage 而继续沿用旧内存状态。
    setConfig(defaultConfig);
    setCards(buildSeedCards());
    setPersonas(ensureMinds(seedMemories(defaultPersonas())));
    setWorld(emptyWorld());
    setSettings({ ...defaultSettings });
    setIdentity(loadIdentity());
    setTodos([]);
    setHomeTab('step');
    setOnboardOpen(true);
    setLegacyKeys([]);
    resetGuideDismissed();
    setAdminOpen(false);
    setDrawerOpen(false);
    setBrag(null);
    setView('home');
  };

  const doReseed = () => {
    setCards(buildSeedCards());
    setPersonas((prev) => ensureMinds(seedMemories(prev)));
    setWorld(emptyWorld());
    resetGuideDismissed();
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

  const forumFeed = useMemo(() => {
    const q = forumQuery.trim().toLowerCase();
    return feed.filter((c) => {
      if (forumCat !== '全部' && forumCategory(c) !== forumCat) return false;
      if (!q) return true;
      return `${c.title ?? ''} ${c.text} ${c.authorName}`.toLowerCase().includes(q);
    });
  }, [feed, forumCat, forumQuery]);

  const noteCount =
    todos.filter((t) => !t.doneAt).length +
    cards.filter((c) => c.note && c.status === 'noted').length;

  return (
    <div
      className={`shell ${view === 'home' && homeTab === 'step' ? 'is-home-step' : ''} ${
        view === 'room' ? 'is-room' : ''
      }`}
    >
      <header className="top">
        <div className="top-inner">
          <button type="button" className="brand" onClick={bumpBrand} title="StartNow">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
            <span className="brand-text">
              <span className="brand-name">Start Now</span>
              <span className="brand-sub">先动一下 · 四个 AI 同学的互助小圈子</span>
            </span>
          </button>
          <nav className="top-nav" aria-label="主导航">
            <button
              type="button"
              className={view === 'home' && homeTab === 'step' ? 'active' : ''}
              aria-current={view === 'home' && homeTab === 'step' ? 'page' : undefined}
              onClick={() => {
                setHomeTab('step');
                setView('home');
              }}
            >
              试试
            </button>
            <button
              type="button"
              className={
                (view === 'home' && homeTab === 'forum') || view === 'detail' ? 'active' : ''
              }
              aria-current={
                (view === 'home' && homeTab === 'forum') || view === 'detail' ? 'page' : undefined
              }
              onClick={() => {
                setHomeTab('forum');
                setView('home');
              }}
            >
              论坛
            </button>
            <button
              type="button"
              className={view === 'room' ? 'active' : ''}
              aria-current={view === 'room' ? 'page' : undefined}
              onClick={() => setView('room')}
            >
              群聊
            </button>
            <button
              type="button"
              className={view === 'profile' || view === 'mine' ? 'active' : ''}
              aria-current={view === 'profile' || view === 'mine' ? 'page' : undefined}
              onClick={() => setView('profile')}
            >
              我的
            </button>
          </nav>
          <div className="top-actions">
          <button
            className="icon-btn plus-btn"
            onClick={() => setView('post')}
            aria-label="发一张卡"
            title="发一张卡"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div className="menu-wrap" ref={menuRef}>
            <button
              className="icon-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="设置"
              aria-expanded={menuOpen}
              title="设置"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 8h16M4 16h16" />
                <circle cx="9.5" cy="8" r="2.2" fill="#fff" />
                <circle cx="14.5" cy="16" r="2.2" fill="#fff" />
              </svg>
            </button>
            {menuOpen && (
              <div className="menu-panel">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openSettings();
                  }}
                >
                  API 设置
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setAdminOpen(true);
                  }}
                >
                  作者后台
                </button>
              </div>
            )}
          </div>
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
                <div className="bell-head">
                  <p className="bell-title">有人回了你</p>
                  {notices.length > 0 && (
                    <button className="bell-clear" onClick={clearNotices}>
                      全部已读
                    </button>
                  )}
                </div>
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
            <Avatar avatarKey={identity.avatarKey} name={identity.name} className="me" size="sm" />
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
                试试
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
              userName={identity.name}
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
              <div className="forum-head">
                <div>
                  <h1 className="page-title">大家在说什么</h1>
                  <p className="page-sub">看看别人卡在哪，也许你也有同感</p>
                </div>
                <label className="forum-search">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4.5 4.5" />
                  </svg>
                  <input
                    value={forumQuery}
                    onChange={(e) => setForumQuery(e.target.value)}
                    placeholder="搜索卡片"
                    aria-label="搜索卡片"
                  />
                </label>
              </div>

              <div className="forum-chips" role="group" aria-label="卡片分类">
                {FORUM_CATS.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={forumCat === cat ? 'on' : ''}
                    aria-pressed={forumCat === cat}
                    onClick={() => setForumCat(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {guide && !guideDismissed && (
                <GuideCard card={guide} onOpen={() => openCard(guide)} onDismiss={dismissGuide} />
              )}

              <div className="forum-layout">
                <div className="forum-grid">
                  {forumFeed.map((card) => (
                    <CardRow
                      key={card.id}
                      card={card}
                      personas={personas}
                      onClick={() => openCard(card)}
                      onLike={() => like(card)}
                    />
                  ))}
                  {forumFeed.length === 0 && (
                    <div className="empty forum-empty">
                      <h2>没有找到这样的卡</h2>
                      <p>换个关键词，或者去「发一张」写下自己的。</p>
                    </div>
                  )}
                </div>

                <aside className="ai-watch" aria-label="AI 同伴怎么看">
                  <h2>AI 同伴怎么看</h2>
                  <div className="ai-watch-bubbles">
                    <p className="ai-bubble lav">你愿意记录下来，已经很勇敢</p>
                    <p className="ai-bubble mint">40 分钟也是有效进展</p>
                    <p className="ai-bubble peach">延后不等于失败，重新开始就好</p>
                  </div>
                  <p className="ai-watch-note">演示模式：同伴回复由本地脚本生成</p>
                </aside>
              </div>
            </>
          )}
        </div>
      )}

      {view === 'post' && (
        <div className="feed post-feed">
          <div className="page-head">
            <div>
              <h1 className="page-title">放一张卡</h1>
              <p className="page-sub">一两句说清卡在哪，可以配一张图。</p>
            </div>
          </div>
          <div className="post-layout">
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
            <aside className="post-side">
              <h2>发出去之后</h2>
              <ol className="post-steps">
                <li>
                  <b>写一句卡在哪</b>
                  <span>比“我要努力”具体一点，比如“高数第三章开不了头”。</span>
                </li>
                <li>
                  <b>同伴可能过来</b>
                  <span>会有 AI 同伴带着一句回应出现，不用守着。</span>
                </li>
                <li>
                  <b>有用的贴成便签</b>
                  <span>觉得能用，就贴到下一步里，随时能翻出来。</span>
                </li>
              </ol>
              <p className="post-side-note">不是真人社交，只在论坛上聊。你的卡只留在本机。</p>
            </aside>
          </div>
        </div>
      )}

      {view === 'detail' && detailCard && (
        <div className="feed">
          {detailCard.sourceCardId && (
            <div className="advice" role="note">
              <p className="advice-head">AI 角色模拟执行 · 从你给的建议</p>
              <p className="advice-label">{detailCard.sourceAdviceText}</p>
              <button type="button" className="advice-source-link" onClick={() => {
                const source = cards.find((c) => c.id === detailCard.sourceCardId);
                if (source) openCard(source);
                else setToast('原卡已从本地保留期移除');
              }}>查看原卡</button>
            </div>
          )}
          {detailCard.bragCardId && (
            <div className="advice" role="note">
              <p>这一步已有后续炫耀卡 · AI 剧情模拟</p>
              <button type="button" className="advice-source-link" onClick={() => {
                const followup = cards.find((c) => c.id === detailCard.bragCardId);
                if (followup) openCard(followup);
                else setToast('后续卡已从本地保留期移除');
              }}>查看后续卡</button>
            </div>
          )}
          <CardDetail
            key={detailCard.id}
            card={detailCard}
            me={identity}
            initialPeer={detailPeer}
            personas={personas}
            busy={working}
            onComment={(text, kind, peer, replyTo) => comment(detailCard, text, kind, peer, replyTo)}
            onAdvice={(personaId) => void advice(detailCard, personaId)}
            onAdoptAdvice={(commentId) => adoptReply(detailCard, commentId)}
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
              ← 回到试试
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

          <section className="profile-grid">
            <article className="section-card">
              <div className="section-head">
                <h3>我的任务</h3>
              </div>
              {todos
                .filter((t) => !t.doneAt)
                .slice(0, 4)
                .map((t) => (
                  <div className="task-row" key={t.id}>
                    <span className="task-dot" aria-hidden="true" />
                    <span>{t.text}</span>
                  </div>
                ))}
              {todos.filter((t) => !t.doneAt).length === 0 && (
                <p className="view-empty">还没有任务，去首页记一件小事。</p>
              )}
            </article>

            <article className="section-card">
              <div className="section-head">
                <h3>我的卡片</h3>
              </div>
              <div className="mini-cards">
                {myCards.slice(0, 4).map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`mini-card ${i % 2 ? 'mint' : 'lav'}`}
                    onClick={() => openCard(c)}
                  >
                    <b>{c.title ?? c.text.slice(0, 14)}</b>
                    <span>{cardStatusLabel(c)}</span>
                  </button>
                ))}
                {myCards.length === 0 && <p className="view-empty">还没有卡片。</p>}
              </div>
            </article>
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

          <MemoryManager
            personas={personas}
            onForgetOne={forgetMemoryEntry}
            onForgetRole={forgetPersonaMemory}
            onForgetAll={forgetAllMemory}
          />

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
                  <b>作者后台 · 推进时间</b>
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
              <button type="button" className="menu-item" onClick={showRules}>
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#8FB78E" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M6 4h9l3 3v13H6z" />
                    <path d="M9 9h6M9 13h6M9 17h4" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>论坛规矩</b>
                  <span>重新打开置顶说明</span>
                </span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  setView('room');
                }}
              >
                <span className="menu-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#E8A87C" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M5 6.5h14v8.5H9l-4 3z" />
                    <path d="M9 10h6M9 12.5h4" />
                  </svg>
                </span>
                <span className="menu-item-text">
                  <b>群聊</b>
                  <span>和同伴们在群里聊几句</span>
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
              {legacyKeys.length > 0 && (
                <button className="btn btn-ghost danger" onClick={() => {
                  if (!window.confirm('旧版帖子与当前版本不兼容，确定仅删除这些旧 key 吗？建议先另行备份浏览器数据。')) return;
                  deleteLegacyPosts();
                  setLegacyKeys(listLegacyPostKeys());
                  setToast('旧版帖子数据已从当前浏览器存储移除');
                }}>
                  删除不兼容旧帖子（{legacyKeys.length} 项）
                </button>
              )}
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
              卡片、便签和角色记忆保存在此浏览器；模型请求会发送相关内容给所选模型服务。导出文件包含卡片、便签和记忆，不包含 API Key；重置会清除当前模型配置。
            </p>
            <p className="profile-fineprint">
              这里的 {personas.length} 位同伴都是虚构的 AI
              角色，和你在不同学校；不是心理咨询师，内容不构成医疗建议。
            </p>
          </section>
        </div>
      )}

      {view === 'room' && (
        <Suspense fallback={<div className="room-loading">正在打开群聊…</div>}>
          <RoomView identity={identity} config={config} onOpenApi={() => setSettingsOpen(true)} />
        </Suspense>
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
            ['step', '试试'],
            ['forum', '论坛'],
            ['room', '群聊'],
            ['post', '发一张卡'],
            ['profile', '我的'],
          ] as [string, string][]
        ).map(([id, label]) => {
          return (
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
          );
        })}
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
            {...{
              // Optional debug extension: older AdminPanel versions can ignore these props.
              pendingBrags: cards.filter((c) => c.pendingBrag).map((c) => ({
                sourceCardId: c.id, personaId: c.authorId, personaName: c.authorName,
                dueAt: c.pendingBrag!.dueAt,
              })),
              onAdvanceBragMinutes: advanceBrags,
              onFireNextBrag: fireNextBrag,
              onCancelBrags: cancelBrags,
              onSimulateNewWorry: postAs,
            }}
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
