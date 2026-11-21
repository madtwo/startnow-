/**
 * Explicit synthetic-case diagnostic hook for local advice evals only.
 * No storage, console output, transport, or production UI integration.
 * The caller owns any manual export; never supply actual player content.
 */
export interface LocalAnchorProbe {
  enabled: true;
  caseId: string;
  syntheticContext: string;
  seed?: number;
  onSample: (sample: AnchorRejectionSample) => void;
}

export interface AnchorRejectionSample {
  readonly case_id: string;
  readonly source: 'rejected';
  readonly provenance: 'synthetic_fixture';
  readonly topic: 'study' | 'people' | 'love' | 'family' | 'self' | 'future';
  readonly card: string;
  readonly actionId: string;
  readonly actionLabel: string;
  readonly rejectedLine: string;
  readonly reason: 'no_anchor';
  readonly model: string;
  readonly seed: number | null;
}

export interface RejectedAnchorEvent {
  cardId: string;
  contextText: string;
  action: { id: string; label: string };
  rejectedLine: string;
  reason: 'no_anchor';
  topic: AnchorRejectionSample['topic'];
  model: string;
}

const SAFE_CASE_ID = /^eval-synth-[a-z0-9-]{1,48}$/u;
const SAFE_ACTION_ID = /^[a-z0-9-]{2,80}$/u;
const SAFE_MODEL = /^[a-z0-9._:/-]{1,80}$/iu;
const VALID_TOPICS = new Set(['study', 'people', 'love', 'family', 'self', 'future']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Intentionally reject suspect samples rather than attempt an unsafe,
// incomplete name/address redaction. This is only a guardrail; a human must
// still review and approve all synthetic samples before any export.
const SENSITIVE = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b(?:sk|ghp|gho|github_pat|AIza)[-_a-z0-9]{12,}\b|(?:\+?86[-\s]?)?1[3-9]\d{9}|\b\d{17}[\dxX]\b|\b\d{12,19}\b|(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)[2-9]\d{2}[-.\s]?\d{4}|\b(?:\d{4}[- ]?){3}\d{4}\b|(?:19|20)\d{2}[-/.\u5e74]\d{1,2}(?:[-/.\u6708]\d{1,2})?|(?:\u5fae\u4fe1\u53f7|\u624b\u673a\u53f7|\u8eab\u4efd\u8bc1|\u8be6\u7ec6\u5730\u5740|\u94f6\u884c\u5361|\u5bc6\u7801|\u5b66\u53f7|\u5de5\u53f7)|@[a-z0-9_]{3,}|\b(?:api[-_ ]?key|bearer|password|token)\s*[:=]|\u5927\u5b66|\u5b66\u9662|\u9644\u5c5e\u533b\u9662|\u5e02\d{1,4}\u53f7)/iu;

export function syntheticAnchorTextIsSafe(value: string, limit = 240): boolean {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value).length <= limit && !/[\r\n\x00-\x1f\x7f]/u.test(value) &&
    !SENSITIVE.test(value);
}

function allowedHost(): boolean {
  if (typeof window === 'undefined') return true; // Explicit local Node test runner.
  try { return LOCAL_HOSTS.has(window.location.hostname.toLowerCase()); }
  catch { return false; }
}

/** Never throws, and never logs or persists a rejected line. */
export function emitSyntheticAnchorRejection(
  probe: LocalAnchorProbe | undefined,
  event: RejectedAnchorEvent,
): boolean {
  if (!probe || probe.enabled !== true || !allowedHost()) return false;
  if (!SAFE_CASE_ID.test(probe.caseId) || event.cardId !== probe.caseId ||
      probe.syntheticContext !== event.contextText ||
      !syntheticAnchorTextIsSafe(event.contextText) ||
      !syntheticAnchorTextIsSafe(event.rejectedLine, 90) ||
      !syntheticAnchorTextIsSafe(event.action.label, 100) ||
      !SAFE_ACTION_ID.test(event.action.id) || !SAFE_MODEL.test(event.model) ||
      SENSITIVE.test(event.model) || !VALID_TOPICS.has(event.topic) ||
      event.reason !== 'no_anchor') return false;
  const seed = Number.isSafeInteger(probe.seed) && (probe.seed as number) >= 0 &&
    (probe.seed as number) <= 2147483647 ? probe.seed as number : null;
  const sample: AnchorRejectionSample = Object.freeze({
    case_id: probe.caseId,
    source: 'rejected',
    provenance: 'synthetic_fixture',
    topic: event.topic,
    card: event.contextText,
    actionId: event.action.id,
    actionLabel: event.action.label,
    rejectedLine: event.rejectedLine,
    reason: 'no_anchor',
    model: event.model,
    seed,
  });
  try { probe.onSample(sample); return true; }
  catch { return false; } // A diagnostic callback must never break advice.
}
