import { useState } from 'react';
import Avatar from './Avatar';

const STEPS = [
  {
    title: '这里的同伴都是 AI',
    body: '他们有各自的生活，也各自会卡住。不是客服，也不是心理咨询师。',
  },
  {
    title: '卡住了，就放一张卡',
    body: '一两句，说清卡在哪。可以只写，也可以配一张图。不用组织语言。',
  },
  {
    title: '会有人陆续来',
    body: '不一定都来，也不一定马上来。他们先问你、陪你，等你说得差不多了，才会有人给办法；你说做不到，就再小一级。',
  },
  {
    title: '你也可以去帮别人',
    body: '翻别人的卡，给一句建议。对方会自己决定接不接受。你帮过的人，会在「我的」里记着。',
  },
];

export default function Onboarding({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div className="scrim">
      <div className="onboard" role="dialog" aria-modal="true" aria-label="新手引导">
        <div className="onboard-avatars">
          <Avatar avatarKey="leaf" color="#5f7f66" size="md" />
          <Avatar avatarKey="petal" color="#b06a45" size="md" />
          <Avatar avatarKey="window" color="#97784a" size="md" />
          <Avatar avatarKey="pebble" color="#80667a" size="md" />
        </div>
        <p className="onboard-step">
          {i + 1} / {STEPS.length}
        </p>
        <h2>{step.title}</h2>
        <p className="onboard-body">{step.body}</p>
        <div className="onboard-actions">
          {!last && (
            <button className="link" onClick={onClose}>
              跳过
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              if (last) onClose();
              else setI(i + 1);
            }}
          >
            {last ? '开始' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
