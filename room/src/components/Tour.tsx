import { useEffect, useRef, useState } from 'react';

type View = 'home' | 'post' | 'mine' | 'profile';

interface Step {
  view: View;
  tab?: 'step' | 'forum';
  selector?: string;
  title: string;
  body: string;
  openGuide?: boolean;
}

const STEPS: Step[] = [
  {
    view: 'home',
    tab: 'step',
    title: 'StartNow 不保证长期',
    body: '它只负责此刻你能做的那一件小事：做了算数，做一半也算，不做也没关系。先从这里开始——下一步该做什么。',
  },
  {
    view: 'home',
    tab: 'step',
    selector: '[data-tour="step"]',
    title: '没有下一步，也没关系',
    body: '是不是也没有灵感？我们先去论坛看看别人卡在哪。',
  },
  {
    view: 'home',
    tab: 'forum',
    selector: '.guide-card',
    title: '这里是论坛',
    body: '谁卡住了就放一张卡。先读一下置顶的说明，知道这里怎么玩。',
  },
  {
    view: 'home',
    tab: 'forum',
    openGuide: true,
    selector: '.page-text',
    title: '卡不用讲清前因后果',
    body: '只写此刻卡在哪，一两句就够。会有人陆续来——可能慢，也可能今天没人来，那不是你的问题。',
  },
  {
    view: 'home',
    tab: 'step',
    selector: '[data-tour="step"]',
    title: '会有人给一个很小的下一步',
    body: '不用是彻底的解决，只是一件现在能做的小事。做不到就再小一级；贴到便签，做完勾掉。',
  },
  {
    view: 'post',
    selector: '.post-form-title',
    title: '标题可以写，也可以不写',
    body: '想让人一眼知道是什么事，就写一句；不想概括，直接写正文也行。',
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
    tab: 'forum',
    selector: '.deck-card, .thread-card',
    title: '点开一张卡',
    body: '正文、一条条回应和下一步都在里面。点谁的回应，底部输入栏就会变成「回复：某某」；不点就是回复楼主。',
  },
  {
    view: 'home',
    tab: 'forum',
    selector: '.drawer-tab',
    title: '便签在右边',
    body: '别人给的下一步、你自己加的小事都在这儿。勾掉之后，可以发一篇炫耀帖。',
  },
];

interface Props {
  onNavigate: (view: View, tab?: 'step' | 'forum') => void;
  onOpenGuide: () => void;
  onClose: () => void;
}

export default function Tour({ onNavigate, onOpenGuide, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = STEPS[i];
  const actions = useRef({ onNavigate, onOpenGuide });
  actions.current = { onNavigate, onOpenGuide };

  useEffect(() => {
    if (step.openGuide) actions.current.onOpenGuide();
    else actions.current.onNavigate(step.view, step.tab);
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
