import { useEffect, useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import deskArt from '../assets/onboarding/desk.png';
import monitorArt from '../assets/onboarding/monitor.png';

type View = 'home' | 'post' | 'mine' | 'profile' | 'room';

interface Props {
  onNavigate: (view: View, tab?: 'step' | 'forum') => void;
  onClose: () => void;
}

interface Slide {
  title: string;
  lead: string;
  body: string;
  primary: string;
  secondary: string;
  visual: 'desk' | 'goal' | 'forum' | 'profile' | 'monitor' | 'chat';
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
    secondary: '我知道了',
  },
  {
    visual: 'forum',
    title: '这里允许慢一点',
    lead: '你可以分享进度，也可以只是碎碎念',
    body: '大家会记录开始、卡住和重新启动的时刻，AI 同伴也会在这里陪你聊聊。',
    primary: '继续',
    secondary: '我知道了',
  },
  {
    visual: 'profile',
    title: '记录你的每一次开始',
    lead: '不是只有完成才算数，开始了就值得被看见',
    body: '这里会保存你的小目标、心情卡片和 AI 同伴记录，帮你看见自己是怎么慢慢前进的。',
    primary: '继续',
    secondary: '我知道了',
  },
  {
    visual: 'monitor',
    title: '准备好，先启动这一步了吗？',
    lead: '不用很努力，也可以开始',
    body: '从一个小目标、一张心情卡片、一次 5 分钟的行动开始，我们会一直陪着你。',
    primary: '进入 Start Now',
    secondary: '以后再说',
  },
];

const EXTRA: Slide = {
  visual: 'chat',
  title: 'AI 同伴会一直陪着你',
  lead: '不是冷冰冰的提醒，而是像朋友一样听你说',
  body: '在这里，你可以聊任务卡住的原因，也可以说说今天的情绪。AI 同伴会帮你拆目标、接住你的感受，再给你一个轻轻的下一步建议。',
  primary: '去群聊看看',
  secondary: '我知道了',
};

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
    <div className="ob-mock ob-forum" aria-hidden="true">
      <div className="ob-forum-head">
        <strong>同伴广场</strong>
        <span className="ob-forum-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="6" />
            <path d="m15.5 15.5 4 4" strokeLinecap="round" />
          </svg>
          搜索卡片
        </span>
        <span className="ob-forum-me">小</span>
      </div>
      <div className="ob-forum-chips">
        <span>碎碎念</span>
        <span>进度打卡</span>
        <span>求助支招</span>
      </div>
      <div className="ob-forum-grid">
        <article className="ob-post">
          <header>
            <span className="ob-mini-ava warm">树</span>
            <span>今天只做了 30 分钟</span>
          </header>
          <h4>我接受今天慢一点</h4>
          <p>允许自己今天只做一点点。不和自己较劲，明天再接着来。</p>
          <div className="ob-post-photos">
            <span />
            <span />
          </div>
        </article>
        <div className="ob-forum-side">
          <div className="ob-ai-note">
            <span className="ob-ai-tag">AI</span>
            <p>慢慢来，也在前进</p>
          </div>
          <span className="ob-photo tall" />
          <span className="ob-photo" />
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
            我开启过的事
            <em>5 次</em>
          </li>
          <li>
            <span className="ob-row-ico amber">▤</span>
            我的心情卡片
            <Chevron />
          </li>
          <li>
            <span className="ob-row-ico blue">◔</span>
            我收藏的回应
            <Chevron />
          </li>
        </ul>
      </div>
    </div>
  );
}

function ChatMock() {
  return (
    <div className="ob-mock ob-chat" aria-hidden="true">
      <div className="ob-chat-head">
        <span className="ob-chat-back">‹</span>
        <strong>AI 同伴群聊</strong>
        <span className="ob-chat-dots">•••</span>
      </div>
      <div className="ob-chat-chips">
        <span>拆解小目标</span>
        <span>聊聊情绪</span>
        <span>给你建议</span>
      </div>
      <div className="ob-chat-lines">
        <div className="ob-line right">
          <span className="ob-mini-ava warm">我</span>
          <p className="me">我今天有点卡住了</p>
        </div>
        <div className="ob-line">
          <p className="soft">先别责怪自己，慢慢来</p>
          <span className="ob-mini-ava cool">顾</span>
        </div>
        <div className="ob-line">
          <p className="warm">那我们把目标拆小一点？</p>
          <span className="ob-mini-ava sand">苗</span>
        </div>
        <div className="ob-line right">
          <p className="peach">好，那就从 5 分钟开始</p>
          <span className="ob-mini-ava warm">我</span>
        </div>
      </div>
    </div>
  );
}

function Visual({ kind }: { kind: Slide['visual'] }) {
  if (kind === 'desk') return <img className="ob-art desk" src={deskArt} alt="" />;
  if (kind === 'monitor') return <img className="ob-art monitor" src={monitorArt} alt="" />;
  if (kind === 'goal') return <GoalMock />;
  if (kind === 'forum') return <ForumMock />;
  if (kind === 'profile') return <ProfileMock />;
  return <ChatMock />;
}

export default function Onboarding({ onNavigate, onClose }: Props) {
  const [i, setI] = useState(0);
  const [extra, setExtra] = useState(false);
  const slide = extra ? EXTRA : SLIDES[i];
  const last = i === SLIDES.length - 1;
  const dialogRef = useDialogFocus<HTMLDivElement>(() =>
    extra ? setExtra(false) : onClose(),
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (extra) return;
      if (e.key === 'ArrowRight') {
        if (last) onClose();
        else setI(i + 1);
      } else if (e.key === 'ArrowLeft' && i > 0) {
        setI(i - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [extra, i, last, onClose]);

  const next = () => {
    if (last) onClose();
    else setI(i + 1);
  };

  const primary = () => {
    if (!extra) {
      next();
      return;
    }
    onNavigate('room');
    onClose();
  };

  const secondary = () => {
    if (extra) setExtra(false);
    else onClose();
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
        <div className={`ob-main${extra ? ' extra' : ''}`} key={extra ? 'extra' : i}>
          <div className="ob-visual">
            <Visual kind={slide.visual} />
          </div>
          <div className="ob-copy">
            <h2>{slide.title}</h2>
            <p className="ob-lead">{slide.lead}</p>
            <p className="ob-body">{slide.body}</p>
            <div className={`ob-actions${!extra && i >= 2 ? ' stacked' : ''}`}>
              <button className="ob-primary" data-autofocus onClick={primary}>
                {slide.primary}
              </button>
              <button className="ob-secondary" onClick={secondary}>
                {slide.secondary}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="ob-foot">
        {extra ? (
          <span className="ob-extra-tag">额外功能</span>
        ) : (
          <button type="button" className="ob-extra-link" onClick={() => setExtra(true)}>
            额外功能
          </button>
        )}
        {!extra && (
          <span className="ob-step" aria-label={`第 ${i + 1} 步，共 ${SLIDES.length} 步`}>
            <span className="ob-step-num">{i + 1}</span>
            <span>
              {i + 1} / {SLIDES.length}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
