import type { CSSProperties } from 'react';
import type { Post } from '../types';
import { personaMap } from '../lib/personas';

interface Props {
  post: Post;
  meId: string;
  generating: boolean;
  busy: boolean;
  onRegenerate: () => void;
}

const formatTime = (ts: number) => {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? time : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
};

export default function PostCard({ post, meId, generating, busy, onRegenerate }: Props) {
  return (
    <article className="post">
      <header className="post-head">
        <span className="avatar anon" aria-hidden="true">
          匿
        </span>
        <div className="post-meta">
          <div className="post-author">
            {post.authorName}
            {post.authorId === meId && <span className="me-badge">你</span>}
          </div>
          <time className="post-time" dateTime={new Date(post.createdAt).toISOString()}>
            {formatTime(post.createdAt)}
          </time>
        </div>
      </header>

      <p className="post-body">{post.content}</p>

      {post.replies.length > 0 && (
        <div className="replies">
          {post.replies.map((reply) => {
            const persona = personaMap[reply.personaId];
            if (!persona) return null;
            return (
              <div
                key={reply.id}
                className="reply"
                style={{ '--pc': persona.color } as CSSProperties}
              >
                <span className="avatar" style={{ background: persona.color }} aria-hidden="true">
                  {persona.avatar}
                </span>
                <div className="reply-main">
                  <div className="reply-head">
                    <span className="reply-name">{persona.name}</span>
                    <span className="reply-role">{persona.role}</span>
                    {reply.status === 'streaming' && <span className="reply-time">正在回帖</span>}
                  </div>
                  <p className="reply-body">
                    {reply.content}
                    {reply.status === 'streaming' && reply.content && <span className="cursor" />}
                    {reply.status === 'streaming' && !reply.content && (
                      <span className="dots" aria-label="正在输入">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </p>
                  {reply.status === 'error' && <p className="reply-note error">{reply.error}</p>}
                  {reply.status === 'stopped' && <p className="reply-note muted">{reply.error ?? '已停止'}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="post-foot">
        {generating ? (
          <span className="post-state">
            <span className="dots" aria-label="正在生成">
              <i />
              <i />
              <i />
            </span>
            居民们正在看这栋楼
          </span>
        ) : (
          <>
            <span className="post-state">
              {post.replies.length > 0 ? `${post.replies.length} 条回应` : '还没有回应'}
            </span>
            <button className="link" onClick={onRegenerate} disabled={busy}>
              重新生成
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
