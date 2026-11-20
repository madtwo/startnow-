import type { DecomposeJob } from '../lib/decomposeJob';
import { decomposeOrbText, isDecomposeOrbVisible } from '../lib/decomposeJob';
import './DecomposeOrb.css';

interface Props {
  job: DecomposeJob;
  sheetOpen: boolean;
  onOpen: () => void;
  hasToast?: boolean;
}

/** A navigation control only. The retained sheet owns requests, preview, and saving. */
export default function DecomposeOrb({ job, sheetOpen, onOpen, hasToast = false }: Props) {
  if (!isDecomposeOrbVisible(job, sheetOpen)) return null;
  const { label, caption } = decomposeOrbText(job);
  return (
    <div className={`decompose-orb${hasToast ? ' decompose-orb--toast' : ''}`} role="group" aria-label="目标拆解状态">
      <button type="button" className={`decompose-orb__button decompose-orb__button--${job.status}`}
        aria-label={label} title={label} onClick={onOpen}>
        {job.status === 'running' && job.stage !== 'questions' ? (
          <svg className="decompose-orb__spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
            <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : job.status === 'running' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5h14v12H8l-3 3V5zm4 4h6m-6 4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
        ) : job.status === 'ready' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7v6m0 3.5v.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
        )}
        {job.status !== 'running' && <span className="decompose-orb__dot" aria-hidden="true" />}
      </button>
      <span className="decompose-orb__caption" role="status" aria-live="polite" aria-atomic="true">{caption}</span>
    </div>
  );
}
