/** Page-local status of the retained DecomposeSheet. Never persist this object. */
export type DecomposeJobStatus = 'idle' | 'running' | 'ready' | 'failed';
export type DecomposeJobStage = 'loadingQuestions' | 'questions' | 'deciding' | 'requesting';

export interface DecomposeJob {
  status: DecomposeJobStatus;
  goal: string;
  title?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  stage?: DecomposeJobStage;
  /** A ready/failed notification was already opened; running is always redisplayable. */
  acknowledged?: boolean;
}

export type DecomposeJobEvent =
  | { status: 'idle' }
  | { status: 'running'; goal: string; stage: DecomposeJobStage; newTask?: boolean }
  | { status: 'ready'; goal: string; title: string; seen?: boolean }
  | { status: 'failed'; goal: string; error?: string; seen?: boolean };

export const emptyDecomposeJob = (): DecomposeJob => ({ status: 'idle', goal: '' });

/** Call only for the currently mounted sheet/epoch (see App guard). */
export function updateDecomposeJob(previous: DecomposeJob, event: DecomposeJobEvent, now = Date.now()): DecomposeJob {
  if (event.status === 'idle') return emptyDecomposeJob();
  if (event.status === 'running') {
    const continuing = !event.newTask && previous.status === 'running' && previous.goal === event.goal;
    return {
      status: 'running', goal: event.goal, stage: event.stage,
      startedAt: continuing ? previous.startedAt ?? now : now,
      // Never retain the title/error/acknowledgement of a replaced plan.
    };
  }
  if (event.status === 'ready') {
    return {
      status: 'ready', goal: event.goal, title: event.title, startedAt: previous.startedAt,
      finishedAt: now, acknowledged: event.seen === true,
    };
  }
  return {
    status: 'failed', goal: event.goal, error: event.error,
    startedAt: previous.startedAt, finishedAt: now, acknowledged: event.seen === true,
  };
}

export function acknowledgeDecomposeJob(job: DecomposeJob): DecomposeJob {
  return job.status === 'ready' || job.status === 'failed' ? { ...job, acknowledged: true } : job;
}

export function isDecomposeOrbVisible(job: DecomposeJob, sheetOpen: boolean): boolean {
  return !sheetOpen && (job.status === 'running' ||
    ((job.status === 'ready' || job.status === 'failed') && !job.acknowledged));
}

export function decomposeOrbText(job: DecomposeJob): { label: string; caption: string } {
  switch (job.status) {
    case 'running':
      return job.stage === 'questions'
        ? {label: '有拆解问题待回答，点击继续', caption: '待回答'}
        : {label: '目标拆解中，点击查看', caption: '拆解中'};
    case 'ready': return {label: '目标拆好了，点击查看', caption: '已拆好'};
    case 'failed': return {label: '目标拆解未完成，点击查看原因', caption: '查看原因'};
    default: return {label: '', caption: ''};
  }
}
