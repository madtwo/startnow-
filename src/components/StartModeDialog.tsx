import { useDialogFocus } from '../lib/useDialogFocus';

interface Props {
  onDemo: () => void;
  onApi: () => void;
}

/** Shown once after onboarding: demo first, or connect a real model. */
export default function StartModeDialog({ onDemo, onApi }: Props) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onDemo);
  return (
    <div
      className="mode-choice"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="选择启动方式"
    >
      <div className="mode-choice-card">
        <p className="mode-choice-eyebrow">开始之前</p>
        <h2>先体验，还是接入你自己的模型？</h2>
        <p className="mode-choice-lead">
          演示模式不用 Key，打开就能看完整流程；接入 API 后，同伴会用你配置的模型回应。
        </p>
        <div className="mode-choice-actions">
          <button className="ob-primary" data-autofocus onClick={onDemo}>
            使用演示模式
          </button>
          <button className="ob-secondary" onClick={onApi}>
            接入我的 API
          </button>
        </div>
        <p className="mode-choice-hint">之后可以在“API 设置”里随时切换。</p>
      </div>
    </div>
  );
}
