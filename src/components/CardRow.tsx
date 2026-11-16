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
}

export default function CardRow({ card, personas, onClick }: Props) {
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const unseen = !card.seenAt;

  return (
    <button className="thread-card" onClick={onClick}>
      <div className="thread-top">
        {author ? (
          <Avatar avatarKey={author.avatarKey} color={author.color} size="xs" />
        ) : (
          <Avatar avatarKey="petal" className="me" size="xs" />
        )}
        <span className="thread-author">{card.authorName}</span>
        {!mine && <span className="thread-badge">AI</span>}
        {mine && <span className="me-badge">你</span>}
        <time className="thread-time">{timeLabel(card.createdAt)}</time>
        {unseen && <span className="unread-dot" title="还没点开过" />}
      </div>

      {card.title && <h3 className="thread-title">{card.title}</h3>}
      <p className="thread-preview">{card.text.replace(/\s+/g, ' ')}</p>

      <div className="thread-bottom">
        <span>{card.comments.length ? `${card.comments.length} 条回应` : '还没有人说话'}</span>
        {card.status === 'done' && <span className="thread-done">做到了</span>}
        {card.status === 'handled' && <span className="thread-handled">已处理</span>}
      </div>
    </button>
  );
}
