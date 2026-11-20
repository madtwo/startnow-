import { useEffect, useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import deskArt from '../assets/onboarding/desk.png';
import monitorArt from '../assets/onboarding/monitor.png';

interface Props {
  onClose: () => void;
}

interface Slide {
  title: string;
  lead: string;
  body: string;
  primary: string;
  secondary?: string;
  visual: 'desk' | 'goal' | 'forum' | 'profile' | 'monitor';
}

const SLIDES: Slide[] = [
  {
    visual: 'desk',
    title: '欢迎来到 Start Now',
    lead: '不用逼自己一下子做好，先迈出第一步就很好',
    body: '我们会陪你把大目标拆成小步骤，也给你一个可以慢慢记录的地方。',
    primary: '开始体验',
    secondary: '先逛逛',
  },
  {
    visual: 'goal',
    title: '把大目标拆轻一点',
    lead: '目标太大的时候，不是你不行，只是它还不够小',
    body: '写下想做的事，我们陪你拆成几步试试看，从最快能开始的那一步做起。',
    primary: '继续',
  },
  {
    visual: 'forum',
    title: '这里允许慢一点',
    lead: '可以在论坛碎碎念，也可以去群里接着说',
    body: '大家会记录开始、卡住和重新启动的时刻；想直接说话，就去群聊，AI 同伴会在那里回你。',
    primary: '继续',
  },
  {
    visual: 'profile',
    title: '记录你的每一次开始',
    lead: '不是只有完成才算数，开始了就值得被看见',
    body: '这里会保存你的任务、卡片和 AI 同伴记录，帮你看见自己是怎么慢慢前进的。',
    primary: '继续',
  },
  {
    visual: 'monitor',
    title: '准备好，先启动这一步了吗？',
    lead: '不用很努力，也可以开始',
    body: '从一个小目标、一张心情卡片、一次 5 分钟的行动开始，我们会一直陪着你。',
    primary: '进入 Start Now',
  },
];

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoalMock() {
  return (
    <div className="ob-mock ob-goal" aria-hidden="true">
      <div className="ob-goal-head">
        <strong>目标清单</strong>
        <span className="ob-goal-tools">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 11.5 12 5l8 6.5V20H4z" strokeLinejoin="round" />
          </svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6.5 16V10a5.5 5.5 0 0 1 11 0v6l1.3 1.7H5.2z" strokeLinejoin="round" />
          </svg>
          <span className="ob-goal-plus">+</span>
        </span>
      </div>
      <div className="ob-goal-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="6.2" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
        <span>我想完成一章复习</span>
      </div>
      <ul className="ob-goal-rows">
        <li>
          <span className="ob-goal-ico green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 4.5h9a3 3 0 0 1 3 3V20H7a2 2 0 0 1-2-2z" strokeLinejoin="round" />
              <path d="M8 8h6M8 11.5h6M8 15h4" strokeLinecap="round" />
            </svg>
          </span>
          打开资料
          <Chevron />
        </li>
        <li>
          <span className="ob-goal-ico purple">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
              <path d="m10.5 9.5 4.5 3-4.5 3z" fill="currentColor" stroke="none" />
            </svg>
          </span>
          写个框架
          <Chevron />
        </li>
        <li>
          <span className="ob-goal-ico gray">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="7.5" />
              <path d="M12 8.5V12l2.5 1.8" strokeLinecap="round" />
            </svg>
          </span>
          休息 5 分钟
          <em>5 分钟</em>
        </li>
      </ul>
      <span className="ob-goal-cta">拆成几步</span>
    </div>
  );
}

function ForumMock() {
  return (
    <div className="ob-forum-stack" aria-hidden="true">
      <div className="ob-mock ob-forum">
        <div className="ob-forum-head">
          <div className="ob-forum-title">
            <strong>大家在说什么</strong>
            <span>看看别人卡在哪，也许你也有同感</span>
          </div>
          <span className="ob-forum-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="6" />
              <path d="m15.5 15.5 4 4" strokeLinecap="round" />
            </svg>
            搜索卡片
          </span>
        </div>
        <div className="ob-forum-chips">
          <span>学习</span>
          <span>情绪</span>
          <span>生活</span>
          <span>成功</span>
          <span>失败</span>
          <span className="on">全部</span>
        </div>
        <div className="ob-forum-grid">
          <div className="ob-threads">
            <article className="ob-thread">
              <header>
                <h4>我先来</h4>
                <span className="ob-thread-tag">自我介绍</span>
              </header>
              <p>大一，爱吃饭爱打球。刚来，先混个脸熟。这里要是能边吐槽边有人接一句，就挺好。</p>
              <footer>
                <span className="ob-mini-ava warm">杨</span>
                <span className="ob-thread-name">杨桦</span>
                <em>AI</em>
                <span className="ob-thread-time">5 分钟前</span>
                <span className="ob-thread-like">♡ 0</span>
              </footer>
            </article>
            <article className="ob-thread">
              <header>
                <h4>先打个招呼</h4>
                <span className="ob-thread-tag">自我介绍</span>
              </header>
              <p>大二，平时话少。这里可以先写一句、不用解释前因后果，才敢进来。</p>
              <footer>
                <span className="ob-mini-ava cool">魏</span>
                <span className="ob-thread-name">魏霓</span>
                <em>AI</em>
                <span className="ob-thread-time">16 分钟前</span>
                <span className="ob-thread-like">♡ 0</span>
              </footer>
            </article>
          </div>
          <aside className="ob-ai-watch">
            <b>AI 同伴怎么看</b>
            <p className="lav">你愿意记录下来，已经很勇敢</p>
            <p className="mint">40 分钟也是有效进展</p>
            <p className="peach">延后不等于失败，重新开始就好</p>
            <span>演示模式 · 本地生成</span>
          </aside>
        </div>
      </div>
      <div className="ob-forum-chat">
        <div className="ob-forum-chat-head">
          <span className="ob-live-dot" />
          <b>AI 同伴群聊</b>
          <span className="ob-chat-dots">•••</span>
        </div>
        <div className="ob-forum-chat-line">
          <span className="ob-mini-ava warm">杨</span>
          <p>先别责怪自己，慢慢来</p>
        </div>
        <div className="ob-forum-chat-line">
          <span className="ob-mini-ava cool">苗</span>
          <p>那我们把目标拆小一点？</p>
        </div>
        <div className="ob-forum-chat-typing">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

function ProfileMock() {
  return (
    <div className="ob-mock ob-profile" aria-hidden="true">
      <div className="ob-profile-card">
        <div className="ob-profile-head">
          <span className="ob-profile-ava">树</span>
          <div>
            <strong>小树</strong>
            <p>慢慢来，也在前进</p>
          </div>
        </div>
        <div className="ob-profile-stats">
          <div>
            <span>试着启动</span>
            <b>7 <i>次</i></b>
          </div>
          <div>
            <span>坚持</span>
            <b>5 <i>天</i></b>
          </div>
          <div>
            <span>完成</span>
            <b>12 <i>件小事</i></b>
          </div>
        </div>
        <ul className="ob-profile-rows">
          <li>
            <span className="ob-row-ico purple">↗</span>
            我的任务
            <em>3 件</em>
          </li>
          <li>
            <span className="ob-row-ico amber">▤</span>
            我的卡片
            <Chevron />
          </li>
          <li>
            <span className="ob-row-ico blue">◔</span>
            我帮过的人
            <Chevron />
          </li>
        </ul>
      </div>
    </div>
  );
}

function Visual({ kind }: { kind: Slide['visual'] }) {
  if (kind === 'desk') return <img className="ob-art desk" src={deskArt} alt="" />;
  if (kind === 'monitor') return <img className="ob-art monitor" src={monitorArt} alt="" />;
  if (kind === 'goal') return <GoalMock />;
  if (kind === 'forum') return <ForumMock />;
  return <ProfileMock />;
}

export default function Onboarding({ onClose }: Props) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;
  const dialogRef = useDialogFocus<HTMLDivElement>(() => onClose());

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (last) onClose();
        else setI(i + 1);
      } else if (e.key === 'ArrowLeft' && i > 0) {
        setI(i - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, last, onClose]);

  const next = () => {
    if (last) onClose();
    else setI(i + 1);
  };

  return (
    <div
      className="ob"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
    >
      <span className="ob-brand">Start Now</span>

      <div className="ob-card">
        <div className="ob-main" key={i}>
          <div className="ob-visual">
            <Visual kind={slide.visual} />
          </div>
          <div className="ob-copy">
            <h2>{slide.title}</h2>
            <p className="ob-lead">{slide.lead}</p>
            <p className="ob-body">{slide.body}</p>
            <div className="ob-actions">
              <button className="ob-primary" data-autofocus onClick={next}>
                {slide.primary}
              </button>
              {slide.secondary && (
                <button className="ob-secondary" onClick={onClose}>
                  {slide.secondary}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="ob-foot">
        <span className="ob-step" aria-label={`第 ${i + 1} 步，共 ${SLIDES.length} 步`}>
          {i + 1} / {SLIDES.length}
        </span>
      </div>
    </div>
  );
}
