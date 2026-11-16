import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminPanel from './components/AdminPanel';
import Avatar from './components/Avatar';
import PostForm from './components/PostForm';
import Onboarding from './components/Onboarding';
import CardView from './components/CardView';
import CardDetail from './components/CardDetail';
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
import { buildSeedCards, seedMemories } from './lib/seed';
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
  loadWorld,
  needsUpgrade,
  saveCards,
  saveConfig,
  saveIdentity,
  savePersonas,
  saveSettings,
  saveWorld,
} from './lib/store';
import type {
  Card,
  Identity,
  LlmConfig,
  MemoryEntry,
  Persona,
  World,
  WorldSettings,
} from './types';

const TICK_MS = 4000;

type View = 'home' | 'post' | 'mine' | 'history' | 'profile';

export default function App() {
  const [boot] = useState(() => {
    if (isFirstRun() || needsUpgrade()) {
      return { cards: buildSeedCards(), personas: seedMemories(defaultPersonas()) };
    }
    return { cards: loadCards(), personas: loadPersonas() };
  });
  const [config, setConfig] = useState<LlmConfig>(() => loadConfig());
  const [cards, setCards] = useState<Card[]>(boot.cards);
  const [personas, setPersonas] = useState<Persona[]>(boot.personas);
  const [world, setWorld] = useState<World>(() => loadWorld());
  const [settings, setSettings] = useState<WorldSettings>(() => loadSettings());
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState('');
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [onboardOpen, setOnboardOpen] = useState(
    () => localStorage.getItem('startnow.onboarded') !== '1',
  );
  const [view, setView] = useState<View>('home');
  const [deckIndex, setDeckIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [crisis, setCrisis] = useState('');
  const [detailId, setDetailId] = useState('');
  const brandClicks = useRef<number[]>([]);
  const busy = useRef(false);

  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => savePersonas(personas), [personas]);
  useEffect(() => saveWorld(world), [world]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveIdentity(identity), [identity]);

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
      const before = new Map(cur.cards.filter((c) => c.authorId === 'me').map((c) => [c.id, c.comments.length]));
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
    const card = createPlayerCard(text, identity.name, personas, settings);
    if (image) card.image = image;
    setPersonas((prev) => notePlayerShare(prev, text));
    setCards((prev) => [card, ...prev]);
    setDraft('');
    setImage('');
    setView('home');
    setToast('正在寻找心友，可以去看看别人的卡');
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
    setCards(bundle.cards);
    setPersonas(bundle.personas);
    setWorld(bundle.world);
    setSettings(bundle.settings);
    setIdentity(bundle.identity);
    setAdminOpen(false);
  };

  const doClear = () => {
    clearAll();
    setCards([]);
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

  const now = Date.now();
  const todayAi = useMemo(
    () =>
      cards
        .filter((c) => c.authorKind === 'persona' && now - c.createdAt < 24 * 60 * 60_000)
        .sort((a, b) => b.createdAt - a.createdAt),
    [cards, now],
  );
  const olderAi = useMemo(
    () =>
      cards
        .filter((c) => c.authorKind === 'persona' && now - c.createdAt >= 24 * 60 * 60_000)
        .sort((a, b) => b.createdAt - a.createdAt),
    [cards, now],
  );
  const myCards = useMemo(
    () => cards.filter((c) => c.authorId === 'me').sort((a, b) => b.createdAt - a.createdAt),
    [cards],
  );
  const activeMine = myCards.find((c) => c.status !== 'done' && c.status !== 'handled');
  const deck = todayAi;
  const current = deck[Math.min(deckIndex, Math.max(0, deck.length - 1))];
  const helped = cards
    .filter((c) => c.advice?.accepted && c.advice.fromPersonaId === 'me')
    .sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    if (deckIndex > deck.length - 1) setDeckIndex(Math.max(0, deck.length - 1));
  }, [deck.length, deckIndex]);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => {
      if (!current.seenAt) patch(current.id, (c) => markSeen(c));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [current?.id]);

  useEffect(() => {
    if (view !== 'home') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setDeckIndex((i) => Math.min(i + 1, deck.length - 1));
      if (e.key === 'ArrowLeft') setDeckIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, deck.length]);

  const cardHandlers = (card: Card) => ({
    onComment: (text: string, kind: 'comment' | 'advice', peer?: string) =>
      comment(card, text, kind, peer),
    onAdvice: () => void advice(card),
    onShrink: () => patch(card.id, (c) => shrinkAdvice(c)),
    onAccept: () => patch(card.id, (c) => acceptAdvice(c)),
    onDone: () => patch(card.id, (c) => completeCard(c, Date.now(), settings.speed)),
    onCloseCard: () => patch(card.id, (c) => closeCard(c)),
    onOpenDetail: () => setDetailId(card.id),
  });

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
              {personas.length} 位同伴 · 今天 {todayAi.length} 张卡
            </span>
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

          {current ? (
            <section className="deck">
              <div className="deck-bar">
                <button
                  className="deck-nav"
                  onClick={() => setDeckIndex((i) => Math.max(0, i - 1))}
                  disabled={deckIndex === 0}
                >
                  ←
                </button>
                <span className="deck-progress">
                  {Math.min(deckIndex + 1, deck.length)} / {deck.length}
                </span>
                <button
                  className="deck-nav"
                  onClick={() => setDeckIndex((i) => Math.min(deck.length - 1, i + 1))}
                  disabled={deckIndex >= deck.length - 1}
                >
                  →
                </button>
              </div>
              <CardView
                card={current}
                me={identity}
                personas={personas}
                busy={working}
                {...cardHandlers(current)}
              />
              {deck.length > 1 && (
                <div className="deck-dots">
                  {deck.map((c, i) => (
                    <button
                      key={c.id}
                      className={`deck-dot ${i === deckIndex ? 'on' : ''} ${c.seenAt ? 'seen' : ''}`}
                      onClick={() => setDeckIndex(i)}
                      aria-label={`第 ${i + 1} 张`}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="deck-end">
              <p>今天看完了。</p>
              <p className="deck-end-sub">要不要说说你自己的？</p>
              <div className="deck-end-actions">
                <button className="btn btn-ghost" onClick={() => setView('history')}>
                  看历史烦恼
                </button>
                <button className="btn btn-primary" onClick={() => setView('mine')}>
                  说说我的
                </button>
              </div>
            </section>
          )}
        </main>
      )}

      {view === 'post' && (
        <main className="feed">
          <PostForm
            value={draft}
            image={image}
            busy={working}
            ready={ready}
            personas={personas}
            onChange={setDraft}
            onImage={setImage}
            onSubmit={send}
            onOpenSettings={() => openSettings()}
          />
          <p className="view-empty">
            放出去之后不用守着。有人来会在这里出现，也会提示你。
          </p>
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
            <CardView
              key={card.id}
              card={card}
              me={identity}
              personas={personas}
              busy={working}
              {...cardHandlers(card)}
            />
          ))}
        </main>
      )}

      {view === 'history' && (
        <main className="feed">
          <div className="view-head">
            <button className="link" onClick={() => setView('home')}>
              ← 回去看卡
            </button>
            <h2>历史烦恼</h2>
          </div>
          {olderAi.length === 0 && <p className="view-empty">还没有更早的卡。</p>}
          {olderAi.map((card) => (
            <CardView
              key={card.id}
              card={card}
              me={identity}
              personas={personas}
              busy={working}
              {...cardHandlers(card)}
            />
          ))}
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
              <button className="btn btn-ghost" onClick={() => setView('history')}>
                历史烦恼
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
        <Onboarding
          onClose={() => {
            localStorage.setItem('startnow.onboarded', '1');
            setOnboardOpen(false);
          }}
        />
      )}

      <footer className="foot">
        <div className="foot-inner">
          <p className="foot-brand">StartNow论坛</p>
          <p>
            这里的同伴都是 AI。如有伤害自己的念头，请拨打 <strong>12356</strong> 心理援助热线。
          </p>
        </div>
      </footer>

      {detailId && cards.find((c) => c.id === detailId) && (() => {
        const card = cards.find((c) => c.id === detailId)!;
        return (
          <CardDetail
            card={card}
            me={identity}
            personas={personas}
            busy={working}
            onComment={(text, kind, peer) => comment(card, text, kind, peer)}
            onShrink={() => patch(card.id, (c) => shrinkAdvice(c))}
            onAccept={() => patch(card.id, (c) => acceptAdvice(c))}
            onDone={() => patch(card.id, (c) => completeCard(c, Date.now(), settings.speed))}
            onCloseCard={() => patch(card.id, (c) => closeCard(c))}
            onClose={() => setDetailId('')}
          />
        );
      })()}

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
