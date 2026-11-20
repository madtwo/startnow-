import { useState } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';
import type { AdviceContextReason, AdviceStart } from '../lib/adviceContext';

interface Props {
  reason: AdviceContextReason;
  busy: boolean;
  onClose: () => void;
  onSupplement: (text: string) => Promise<AdviceStart>;
  onStillRequest: () => void;
}

export default function AdviceContextDialog({ reason, busy, onClose, onSupplement, onStillRequest }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const disabled = busy || submitting;
  const title = reason === 'unanswered-question' ? '先回一句，再要下一步？' : '现在就要下一步？';
  const description = reason === 'unanswered-question'
    ? '同伴问了你，但你还没回。现在就要下一步，可能没法贴着你的情况。'
    : '同伴对你的麻烦了解还少。现在就要下一步，可能没法给出具体建议。';

  const submit = async () => {
    const supplement = text.trim();
    if (disabled || supplement.length < 4 || supplement.length > 120) return;
    setSubmitting(true);
    try {
      const result = await onSupplement(supplement);
      if (result === 'started' || result === 'blocked') onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="sheet advice-context-sheet" ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="advice-context-title">
        <div className="sheet-head">
          <div>
            <h2 id="advice-context-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose} disabled={disabled}>×</button>
        </div>
        <label className="field">
          <span className="field-label">先补一句（可选）</span>
          <textarea data-autofocus maxLength={120} value={text}
            placeholder="比如：最卡的是哪一步、你已经试过什么、现在最需要什么"
            onChange={(event) => setText(event.target.value)} disabled={disabled} />
          <span className="field-hint">这句话会作为评论出现在卡片里。</span>
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" disabled={disabled || text.trim().length < 4}
            onClick={() => void submit()}>补上，再要下一步</button>
          <button type="button" className="btn btn-ghost" disabled={disabled} onClick={onStillRequest}>仍然直接要</button>
          <button type="button" className="btn btn-ghost" disabled={disabled} onClick={onClose}>先等等</button>
        </div>
      </div>
    </div>
  );
}
