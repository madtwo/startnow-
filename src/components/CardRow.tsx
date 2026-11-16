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
}

export default function CardRow({ card, personas, onClick, onLike }: Props) {
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const unseen = !card.seenAt;
  const brag = card.kind === 'brag';

  return (
    <div
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
      <div className="thread-top">
        {author ? (
          <Avatar avatarKey={author.avatarKey} name={author.name} color={author.color} size="xs" />
        ) : (
          <Avatar avatarKey="petal" className="me" size="xs" />
        )}
        <span className="thread-author">{card.authorName}</span>
        {!mine && <span className="thread-badge">AI</span>}
        {card.intro && <span className="thread-badge">自我介绍</span>}
        {mine && <span className="me-badge">你</span>}
        {brag && <span className="brag-badge">做到了</span>}
        <time className="thread-time">{timeLabel(card.createdAt)}</time>
        {unseen && <span className="unread-dot" title="还没点开过" />}
      </div>

      {card.title && <h3 className="thread-title">{card.title}</h3>}
      <p className="thread-preview">{card.text.replace(/\s+/g, ' ')}</p>

      <div className="thread-bottom">
        <span>{card.comments.length ? `${card.comments.length} 条回应` : '还没有人说话'}</span>
        {card.status === 'handled' && <span className="thread-handled">已处理</span>}
        <button
          className={`like ${card.likedByMe ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onLike();
          }}
          aria-label="点赞"
        >
          ♥ {card.likes ?? 0}
        </button>
      </div>
    </div>
  );
}
