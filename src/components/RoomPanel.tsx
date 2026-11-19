import { livelinessEstimate, livelinessLabel } from '../lib/room';
import type { RoomSettings } from '../types';

interface Props {
  settings: RoomSettings;
  used: number;
  onChange: (settings: RoomSettings) => void;
  onReroll: () => void;
  onOpenApi: () => void;
  onClose: () => void;
}

const PRESETS: { label: string; value: number }[] = [
  { label: '安静', value: 0.2 },
  { label: '一般', value: 0.5 },
  { label: '热闹', value: 0.8 },
  { label: '很吵', value: 1 },
];

export default function RoomPanel({ settings, used, onChange, onReroll, onOpenApi, onClose }: Props) {
  const estimate = livelinessEstimate(settings.liveliness);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>群设置</h2>
          <p>多热闹、时间停不停，都在这里。</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <section className="panel-section">
        <h3>热闹程度</h3>
        <p className="panel-hint">
          这一项同时决定三件事：群里多久自己聊一句、AI 之间接话的概率、你说话后几个人回。
          调高更热闹，也更容易花掉额度。
        </p>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`preset ${Math.abs(settings.liveliness - p.value) < 0.06 ? 'on' : ''}`}
              onClick={() => onChange({ ...settings, liveliness: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(settings.liveliness * 100)}
          onChange={(e) => onChange({ ...settings, liveliness: Number(e.target.value) / 100 })}
        />
        <p className="panel-readout">
          当前：<strong>{livelinessLabel(settings.liveliness)}</strong> · 大约 {estimate.perMin} 条/分钟 ·{' '}
          {estimate.note}
        </p>
        <p className="panel-hint">
          演示模式不花钱；接真模型时，每条消息都是一次调用。数字是估算，实际取决于你的服务商。
        </p>
      </section>

      <section className="panel-section">
        <h3>每天最多生成</h3>
        <div className="panel-inline">
          <input
            type="number"
            min={30}
            max={5000}
            step={10}
            value={settings.dailyMessages}
            onChange={(e) =>
              onChange({ ...settings, dailyMessages: Math.max(30, Number(e.target.value) || 400) })
            }
          />
          <span>条 · 今天已用 {used} 条</span>
        </div>
      </section>

      <section className="panel-section">
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.timeFlow}
            onChange={(e) => onChange({ ...settings, timeFlow: e.target.checked })}
          />
          <span>
            <strong>时间不停止</strong>
            <em>
              关掉时：页面不在了，群里就不动。打开后：回来时会按你离开的时长补几条（最多 4 条）。
              网页关掉其实没法真的继续跑，这里补的是「该发生的事」，不是一直在后台烧额度。
            </em>
          </span>
        </label>
      </section>

      <section className="panel-section">
        <h3>换一批群友</h3>
        <p className="panel-hint">
          这 4 位会离开，聊天记录会收进「旧群聊」，之后只能看不能回。你自己加的下一步会留下。
        </p>
        <button type="button" className="btn btn-ghost panel-wide" onClick={onReroll}>
          换一批人
        </button>
      </section>

      <section className="panel-section">
        <h3>模型</h3>
        <button type="button" className="btn btn-ghost panel-wide" onClick={onOpenApi}>
          接入 / 更换 API
        </button>
      </section>
    </div>
  );
}
