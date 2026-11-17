import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

export default function CrisisCard({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="crisis">
      <div className="crisis-head">
        <strong>先停一下，你不需要一个人扛</strong>
        <button className="icon-btn" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      </div>
      <p>
        如果你现在有伤害自己的念头，请优先联系真人：<strong>12356</strong> 心理援助热线（24
        小时），或 <strong>010-82951332</strong>。紧急情况请拨 <strong>120 / 110</strong>，也可以找身边可信任的人。
      </p>
      <p className="crisis-dim">
        你仍然可以把话说出来，这里的 AI 居民会陪你，但它们不是医生，也无法替代专业帮助。
      </p>
    </aside>
  );
}
