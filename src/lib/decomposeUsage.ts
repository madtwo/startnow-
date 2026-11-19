/** Local UI-only request counters, not a billing ledger. Never stores prompts, keys or text. */
export const DECOMPOSE_USAGE_KEY = 'shudong.decomposeUsage.v1';
export interface DecomposeUsage { date: string; decompose: number; vision: number }
const localDate = (now: number) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export function readDecomposeUsage(storage: Pick<Storage,'getItem'>, now = Date.now()): DecomposeUsage {
  const empty = { date: localDate(now), decompose: 0, vision: 0 };
  try {
    const raw = storage.getItem(DECOMPOSE_USAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return empty;
    const d = parsed as Partial<DecomposeUsage>;
    if (d.date !== empty.date) return empty;
    return {
      date: empty.date,
      decompose: Number.isSafeInteger(d.decompose) && d.decompose! >= 0 ? d.decompose! : 0,
      vision: Number.isSafeInteger(d.vision) && d.vision! >= 0 ? d.vision! : 0,
    };
  } catch { return empty; }
}
export function recordDecomposeAttempt(storage: Pick<Storage,'getItem'|'setItem'>,
  kind: 'decompose' | 'vision', now = Date.now()): DecomposeUsage {
  const state = readDecomposeUsage(storage, now);
  const next = { ...state, [kind]: state[kind] + 1 };
  try { storage.setItem(DECOMPOSE_USAGE_KEY, JSON.stringify(next)); } catch { /* disabled private storage */ }
  return next;
}
