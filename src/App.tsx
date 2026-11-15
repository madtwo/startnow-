import { useEffect, useMemo, useRef, useState } from 'react';
import Composer from './components/Composer';
import CrisisCard from './components/CrisisCard';
import PostCard from './components/PostCard';
import SettingsDialog from './components/SettingsDialog';
import { configLabel, isReady } from './config/providers';
import { findCrisis } from './lib/safety';
import { generateThread } from './lib/thread';
import { loadConfig, loadIdentity, loadPosts, saveConfig, savePosts } from './lib/store';
import type { LlmConfig, Post, Reply } from './types';

export default function App() {
  const [config, setConfig] = useState<LlmConfig>(() => loadConfig());
  const [posts, setPosts] = useState<Post[]>(() => loadPosts());
  const [identity] = useState(() => loadIdentity());
  const [draft, setDraft] = useState('');
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [dismissedCrisis, setDismissedCrisis] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    savePosts(posts);
  }, [posts]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ready = isReady(config);
  const showCrisis = useMemo(
    () => findCrisis(draft) && dismissedCrisis !== draft,
    [draft, dismissedCrisis],
  );

  const updatePost = (postId: string, fn: (post: Post) => Post) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? fn(p) : p)));
  };

  const updateReply = (postId: string, replyId: string, fn: (reply: Reply) => Reply) => {
    updatePost(postId, (p) => ({
      ...p,
      replies: p.replies.map((r) => (r.id === replyId ? fn(r) : r)),
    }));
  };

  const runPost = async (post: Post) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setGeneratingId(post.id);
    try {
      await generateThread({
        config,
        post,
        signal: controller.signal,
        handlers: {
          onStart: (reply) =>
            updatePost(post.id, (p) => ({ ...p, replies: [...p.replies, reply] })),
          onDelta: (replyId, text) =>
            updateReply(post.id, replyId, (r) => ({ ...r, content: r.content + text })),
          onFinish: (replyId) =>
            updateReply(post.id, replyId, (r) => ({ ...r, status: 'done' })),
          onFail: (replyId, message, stopped) =>
            updateReply(post.id, replyId, (r) => ({
              ...r,
              status: stopped ? 'stopped' : 'error',
              error: message,
            })),
        },
      });
    } finally {
      setGeneratingId((cur) => (cur === post.id ? null : cur));
      abortRef.current = null;
    }
  };

  const openSettings = (notice = '') => {
    setSettingsNotice(notice);
    setSettingsOpen(true);
  };

  const send = () => {
    const content = draft.trim();
    if (!content || generatingId) return;
    if (!ready) {
      openSettings('先接入一个 API，或者切到演示模式。');
      return;
    }
    const post: Post = {
      id: crypto.randomUUID(),
      authorId: identity.id,
      authorName: identity.name,
      content,
      createdAt: Date.now(),
      replies: [],
    };
    setPosts((prev) => [post, ...prev].slice(0, 30));
    setDraft('');
    setDismissedCrisis('');
    void runPost(post);
  };

  const regenerate = (post: Post) => {
    if (generatingId) return;
    if (!ready) {
      openSettings('先接入一个 API，或者切到演示模式。');
      return;
    }
    const fresh: Post = { ...post, replies: [] };
    setPosts((prev) => prev.map((p) => (p.id === post.id ? fresh : p)));
    void runPost(fresh);
  };

  const saveSettings = (next: LlmConfig) => {
    setConfig(next);
    saveConfig(next);
    setSettingsOpen(false);
    setSettingsNotice('');
  };

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div className="brand-text">
            <h1>深夜树洞</h1>
            <p>四位 AI 居民，陪你把话说完</p>
          </div>
        </div>
        <button
          className={`chip ${ready ? 'ok' : 'warn'}`}
          onClick={() => openSettings()}
          title="接入你自己的 API"
        >
          <span className="dot" />
          {ready ? configLabel(config) : '未接入 API'}
        </button>
      </header>

      <main className="feed">
        <Composer
          value={draft}
          busy={Boolean(generatingId)}
          ready={ready}
          label={configLabel(config)}
          onChange={setDraft}
          onSubmit={send}
          onStop={() => abortRef.current?.abort()}
          onOpenSettings={() => openSettings()}
        />

        {showCrisis && <CrisisCard onClose={() => setDismissedCrisis(draft)} />}

        <section className="stream">
          {posts.length === 0 ? (
            <div className="empty">
              <span className="empty-mark" aria-hidden="true" />
              <h2>今晚还没有人开口</h2>
              <p>
                你可以匿名写下一点什么。
                <br />
                四位 AI 居民会认真看完，再回你。
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                meId={identity.id}
                generating={generatingId === post.id}
                busy={Boolean(generatingId)}
                onRegenerate={() => regenerate(post)}
              />
            ))
          )}
        </section>

        <footer className="foot">
          <p>AI 居民不是心理咨询师，内容不构成医疗建议。</p>
          <p>
            如有伤害自己的念头，请拨打 <strong>12356</strong> 心理援助热线，或联系身边可信任的人。
          </p>
        </footer>
      </main>

      {settingsOpen && (
        <SettingsDialog
          config={config}
          notice={settingsNotice}
          onSave={saveSettings}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsNotice('');
          }}
        />
      )}
    </div>
  );
}
