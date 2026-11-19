import { useEffect } from 'react';
import { EMERGENCY, HOTLINE_NOTICE } from '../lib/crisis';

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
        如果你现在有伤害自己的念头，请优先联系真人。{HOTLINE_NOTICE}
        如有即时危险，在中国大陆可拨 <strong>{EMERGENCY}</strong>；其他地区请联系当地紧急服务，也可以找身边可信任的人。
      </p>
      <p className="crisis-dim">
        这条内容没有发出去，也不会召集同伴。这里的 AI 居民不是医生，无法替代专业帮助。
      </p>
    </aside>
  );
}
