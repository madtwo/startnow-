import type { MissingField } from './decompose';

export const DECOMPOSE_DRAFT_KEY = 'shudong.decomposeDraft.v1';
const DRAFT_MS = 7 * 86_400_000;
const allowedFields: readonly MissingField[] = ['deadline','deliverable','constraint','done','progress'];
export interface DecomposeDraft {
  goal: string;
  manualSteps: string;
  answers: Partial<Record<MissingField, string>>;
  confirmedDeadline: string;
  mode: 'ai' | 'grill' | 'manual';
}
export const emptyDecomposeDraft = (): DecomposeDraft => ({
  goal: '', manualSteps: '', answers: {}, confirmedDeadline: '', mode: 'ai',
});
export function readDecomposeDraft(storage: Pick<Storage, 'getItem'>, now = Date.now()): DecomposeDraft {
  try {
    const raw = storage.getItem(DECOMPOSE_DRAFT_KEY);
    if (!raw) return emptyDecomposeDraft();
    const row: unknown = JSON.parse(raw);
    if (!row || typeof row !== 'object') return emptyDecomposeDraft();
    const data = row as Record<string, unknown>;
    if (typeof data.at !== 'number' || !Number.isFinite(data.at) || data.at > now + 60_000 || now - data.at > DRAFT_MS) {
      return emptyDecomposeDraft();
    }
    const answers: DecomposeDraft['answers'] = {};
    for (const key of allowedFields) {
      const value = (data.answers as Record<string, unknown> | undefined)?.[key];
      if (typeof value === 'string' && value.trim()) answers[key] = value.trim().slice(0, 180);
    }
    return {
      goal: typeof data.goal === 'string' ? data.goal.slice(0, 2000) : '',
      // Compatible with the previous draft shape `{goal, steps, at}`.
      manualSteps: typeof data.manualSteps === 'string' ? data.manualSteps.slice(0, 4000)
        : typeof data.steps === 'string' ? data.steps.slice(0, 4000) : '',
      answers,
      confirmedDeadline: typeof data.confirmedDeadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.confirmedDeadline)
        ? data.confirmedDeadline : '',
      mode: ['ai', 'grill', 'manual'].includes(String(data.mode)) ? data.mode as DecomposeDraft['mode'] : 'ai',
    };
  } catch { return emptyDecomposeDraft(); }
}
export function saveDecomposeDraft(storage: Pick<Storage, 'setItem'>,
  draft: DecomposeDraft, now = Date.now()): void {
  storage.setItem(DECOMPOSE_DRAFT_KEY, JSON.stringify({ ...draft, at: now }));
}
