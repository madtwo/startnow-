import type { Card } from '../types';
import Avatar from './Avatar';

interface Props {
  card: Card;
  onOpen: () => void;
  onDismiss: () => void;
}

export default function GuideCard({ card, onOpen, onDismiss }: Props) {
  return (
    <div
      className="guide-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="guide-head">
        <Avatar avatarKey="lamp" color="#a78bfa" size="xs" />
        <span className="guide-name">论坛小助手</span>
        <span className="guide-pin">置顶</span>
        <button
          className="guide-close"
          aria-label="关闭论坛规矩"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          关闭
        </button>
      </div>
      <h2 className="guide-title">{card.title ?? '这里的规矩'}</h2>
      <p className="guide-preview">{card.text.replace(/\s+/g, ' ')}</p>
      <span className="guide-more">读一下 →</span>
    </div>
  );
}
