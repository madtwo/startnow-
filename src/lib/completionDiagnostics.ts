/** Explicitly opt-in local-test diagnostics. Never persist or transmit model text. */
export interface RejectedCompletionDiagnostic {
  cardId: string;
  personaId: string;
  attempt: 1 | 2;
  reason: 'safety' | 'invalid_action' | 'length';
  /** May contain sensitive content despite redaction; local QA only. */
  candidateExcerpt: string;
  anchorExcerpt: string;
}

export function diagnosticExcerpt(value: string, limit = 60): string {
  const redacted = String(value)
    .replace(/https?:\/\/\S+/giu, '[链接]')
    .replace(/[A-Za-z0-9_.%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/(?:sk-|api[_-]?key[=: ]+)[A-Za-z0-9_-]{8,}/giu, '[凭证]')
    .replace(/\s+/g, ' ').trim();
  return [...redacted].slice(0, Math.max(0, limit)).join('');
}
