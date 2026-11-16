import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

type View = 'home' | 'post' | 'mine' | 'profile';

interface Step {
  view: View;
  tab?: 'step' | 'forum';
  selector?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    view: 'home',
    tab: 'step',
    title: '先动一下',
    body: '四个 AI 同学的互助小圈子。你写一句卡住的事，他们会先听你说，再陪你找一个现在能做的小动作；他们卡住时，你也可以去拉一把。',
  },
  {
    view: 'post',
    selector: '.post-form-input',
    title: '写一句卡住的事',
    body: '不用讲清前因后果，一两句就够。写完放出去，之后不用守着。',
  },
  {
    view: 'home',
    tab: 'step',
    selector: '.step-hero',
    title: '拿到下一步，贴到便签',
    body: '做不到就再小一级；做完可以发个炫耀。其余的慢慢来。',
  },
];

interface Props {
  onNavigate: (view: View, tab?: 'step' | 'forum') => void;
  onClose: () => void;
}

export default function Tour({ onNavigate, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = STEPS[i];
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  useEffect(() => {
    navigate.current(step.view, step.tab);
    setRect(null);
    let el: Element | null = null;
    const measure = () => {
      el = step.selector ? document.querySelector(step.selector) : null;
      if (!el) {
        setRect(null);
        return;
      }
      const b = el.getBoundingClientRect();
      setRect({ x: b.x, y: b.y, w: b.width, h: b.height });
    };
    const raf = requestAnimationFrame(measure);
    const t1 = window.setTimeout(() => {
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      measure();
    }, 120);
    const t2 = window.setTimeout(measure, 420);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', measure);
    };
  }, [i, step]);

  const pad = 6;
  const TIP_H = 200;
  const tipWidth = Math.min(320, window.innerWidth - 32);
  const below = rect ? rect.y + rect.h + 14 : 0;
  const tipTop = rect
    ? below + TIP_H <= window.innerHeight
      ? below
      : Math.max(16, rect.y - TIP_H - 14)
    : window.innerHeight / 2 - 80;
  const tipLeft = rect
    ? Math.min(
        window.innerWidth - tipWidth - 16,
        Math.max(16, rect.x + rect.w / 2 - tipWidth / 2),
      )
    : Math.max(16, (window.innerWidth - tipWidth) / 2);

  return (
    <div
      className="tour"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
    >
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.x - pad,
            top: rect.y - pad,
            width: rect.w + pad * 2,
            height: rect.h + pad * 2,
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}

      <div className="tour-tip" style={{ left: tipLeft, top: tipTop, width: tipWidth }}>
        <p className="tour-step">
          {i + 1} / {STEPS.length}
        </p>
        <h3>{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={onClose}>
            跳过
          </button>
          {i > 0 && (
            <button className="tour-prev" onClick={() => setI(i - 1)}>
              上一步
            </button>
          )}
          <button
            className="btn btn-primary"
            data-autofocus
            onClick={() => {
              if (i === STEPS.length - 1) onClose();
              else setI(i + 1);
            }}
          >
            {i === STEPS.length - 1 ? '开始' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
