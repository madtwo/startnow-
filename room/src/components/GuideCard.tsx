import type { Card } from '../types';
import Avatar from './Avatar';

export default function GuideCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  return (
    <button className="guide-card" onClick={onOpen}>
      <div className="guide-head">
        <Avatar avatarKey="lamp" color="#c96442" size="xs" />
        <span className="guide-name">论坛小助手</span>
        <span className="guide-pin">置顶</span>
      </div>
      <h2 className="guide-title">{card.title ?? '这里是什么地方'}</h2>
      <p className="guide-preview">{card.text.replace(/\s+/g, ' ')}</p>
      <span className="guide-more">读一下 →</span>
    </button>
  );
}
