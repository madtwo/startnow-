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
  cards: Card[];
  personas: Persona[];
  index: number;
  onIndex: (index: number) => void;
  onOpen: (card: Card) => void;
  onLike: (card: Card) => void;
}

export default function CardDeck({ cards, personas, index, onIndex, onOpen, onLike }: Props) {
  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];
  if (!card) {
    return (
      <section className="deck-end">
        <p>还没有人卡住。</p>
        <p className="deck-end-sub">去「发一张」写一句。</p>
      </section>
    );
  }
  const author = personas.find((p) => p.id === card.authorId);
  const mine = card.authorId === 'me';
  const brag = card.kind === 'brag';
  const recent = card.comments.slice(-2);

  return (
    <section className="deck">
      <div className="deck-bar">
        <button
          className="deck-nav"
          onClick={() => onIndex(Math.max(0, index - 1))}
          disabled={index <= 0}
          aria-label="上一张"
        >
          ←
        </button>
        <span className="deck-progress">
          {Math.min(index + 1, cards.length)} / {cards.length}
        </span>
        <button
          className="deck-nav"
          onClick={() => onIndex(Math.min(cards.length - 1, index + 1))}
          disabled={index >= cards.length - 1}
          aria-label="下一张"
        >
          →
        </button>
      </div>

      <article className={`deck-card ${brag ? 'is-brag' : ''}`} onClick={() => onOpen(card)}>
        <header className="deck-head">
          {author ? (
            <Avatar avatarKey={author.avatarKey} name={author.name} color={author.color} size="sm" />
          ) : (
            <Avatar avatarKey="petal" className="me" size="sm" />
          )}
          <div className="deck-meta">
            <span className="deck-author">
              {card.authorName}
              {mine && <span className="me-badge">你</span>}
              {card.intro && <span className="thread-badge">自我介绍</span>}
              {brag && <span className="brag-badge">做到了</span>}
            </span>
            <span className="deck-time">{timeLabel(card.createdAt)}</span>
          </div>
          {!card.seenAt && <span className="unread-dot" />}
        </header>

        {card.title && <h2 className="deck-title">{card.title}</h2>}
        <p className="deck-text">{card.text}</p>

        {card.advice && <p className="deck-advice">下一步：{card.advice.text}</p>}

        <footer className="deck-foot">
          <span className="deck-comments">
            {recent.length === 0 && '还没有人说话'}
            {recent.map((c, i) => (
              <span key={c.id} className="deck-comment">
                <b>
                  {c.authorId === 'helper'
                    ? '论坛小助手'
                    : personas.find((p) => p.id === c.authorId)?.name ?? '你'}
                </b>
                {c.text}
                {i < recent.length - 1 ? '　' : ''}
              </span>
            ))}
          </span>
          <button
            className={`like ${card.likedByMe ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onLike(card);
            }}
            aria-label="点赞"
          >
            ♥ {card.likes ?? 0}
          </button>
        </footer>

        <button
          type="button"
          className="deck-open"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(card);
          }}
        >
          点开看全部对话 →
        </button>
      </article>

      {cards.length > 1 && (
        <div className="deck-dots">
          {cards.map((c, i) => (
            <button
              key={c.id}
              className={`deck-dot ${i === index ? 'on' : ''} ${c.seenAt ? 'seen' : ''}`}
              onClick={() => onIndex(i)}
              aria-label={`第 ${i + 1} 张`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
