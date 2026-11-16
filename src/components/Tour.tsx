import { useEffect, useState } from 'react';

type View = 'home' | 'post' | 'mine' | 'history' | 'profile';

interface Step {
  view: View;
  selector?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    view: 'home',
    title: '这里的同伴都是 AI',
    body: '苗泽、小满、陈屿、老周，各自有生活，也各自会卡住。不是客服，也不是心理咨询师。',
  },
  {
    view: 'home',
    selector: '.tab:nth-child(2)',
    title: '先从「发一张」开始',
    body: '卡住了就放一张卡。点这里。',
  },
  {
    view: 'post',
    selector: '.post-form-input',
    title: '写清楚卡在哪',
    body: '一两句就够，不用组织语言。比如「明天材料物理小测，书才背到第三章」。',
  },
  {
    view: 'post',
    selector: '.post-form-actions',
    title: '写好了就放出去',
    body: '放出去之后不用守着，有人来会提示你。',
  },
  {
    view: 'home',
    selector: '.tab:nth-child(1)',
    title: '回来这里看卡',
    body: '「看卡」一屏一张，左右箭头翻。看完了会给一个收尾页。',
  },
  {
    view: 'home',
    selector: '.card-worry',
    title: '点开卡面看全部对话',
    body: '卡片下面只露最近两条，点开能看到完整的、按人分开的对话。',
  },
  {
    view: 'home',
    selector: '.foot-actions',
    title: '想回谁，就选谁',
    body: '「回一句」会先让你选人，只有他收到。也可以点「给出建议」，对方会自己决定接不接受。',
  },
];

interface Props {
  onNavigate: (view: View) => void;
  onClose: () => void;
}

export default function Tour({ onNavigate, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    onNavigate(step.view);
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
    const timer = window.setTimeout(measure, 380);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [i, step.selector, step.view, onNavigate]);

  const pad = 6;
  const TIP_H = 200;
  const below = rect ? rect.y + rect.h + 14 : 0;
  const tipTop = rect
    ? below + TIP_H <= window.innerHeight
      ? below
      : Math.max(16, rect.y - TIP_H - 14)
    : window.innerHeight / 2 - 80;
  const tipLeft = rect
    ? Math.min(window.innerWidth - 340, Math.max(16, rect.x + rect.w / 2 - 160))
    : Math.max(16, window.innerWidth / 2 - 160);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="新手引导">
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

      <div className="tour-tip" style={{ left: tipLeft, top: tipTop }}>
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
