import type { Card, Persona } from '../types';
import Avatar from './Avatar';

const MIN = 60_000;

const timeLabel = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < MIN) return '刚刚';
  if (diff < 60 * MIN) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < 24 * 60 * MIN) return `${Math.floor(diff / (60 * MIN))} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

interface Props {
  card: Card;
  personas: Persona[];
  onClick: () => void;
  onLike: () => void;
  onCheer?: () => void;
}

export default function CardRow({ card, personas, onClick, onLike, onCheer }: Props) {
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const unseen = !card.seenAt;
  const brag = card.kind === 'brag';
  const goal = card.kind === 'goal' || card.kind === 'progress';

  return (
    <article
      className={`thread-card ${brag ? 'is-brag' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {card.image && (
        <div className="tc-cover">
          <img src={card.image} alt="" />
        </div>
      )}

      <div className="tc-body">
        <div className="tc-title-line">
          {card.title && <h3 className="tc-title">{card.title}</h3>}
          {brag && <span className="tc-tag brag">做到了</span>}
          {goal && <span className="tc-tag">{card.kind === 'goal' ? '目标' : '进度'}</span>}
          {card.kind === 'life' && <span className="tc-tag">生活</span>}
          {card.intro && <span className="tc-tag">自我介绍</span>}
          {unseen && <span className="unread-dot" title="还没点开过" />}
        </div>
        <p className="tc-text">{card.text.replace(/\s+/g, ' ')}</p>
      </div>

      <footer className="tc-foot">
        <span className="tc-author">
          {author ? (
            <Avatar avatarKey={author.avatarKey} name={author.name} color={author.color} size="xs" />
          ) : (
            <Avatar avatarKey="petal" className="me" size="xs" />
          )}
          <span className="tc-author-name">{card.authorName}</span>
          {mine && <span className="tc-tag">你</span>}
        </span>
        <time className="tc-time">{timeLabel(card.createdAt)}</time>
        <span className="tc-actions">
          <span className="tc-comments">
            {card.comments.length > 0 ? `${card.comments.length} 条回应` : ''}
          </span>
          {goal && onCheer && (
            <button
              type="button"
              className={`tc-like ${card.cheeredByMe ? 'on' : ''}`}
              onClick={(e) => { e.stopPropagation(); onCheer(); }}
              aria-label="打气"
            >
              打气 {card.cheerCount ?? 0}
            </button>
          )}
          <button
            type="button"
            className={`tc-like ${card.likedByMe ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onLike();
            }}
            aria-label="点赞"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z" />
            </svg>
            {card.likes ?? 0}
          </button>
        </span>
      </footer>
    </article>
  );
}
