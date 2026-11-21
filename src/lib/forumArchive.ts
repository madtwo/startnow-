import type { Comment, PendingReply, PlannedArrival } from '../types';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const attempt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : undefined;

/** Repair routing metadata without rewriting the archived conversation text.
 * Missing/duplicate IDs must not silently collapse different comments in the
 * thread renderer. References to an ambiguous original ID are never guessed.
 */
export function repairForumComments(rows: readonly Comment[], fallbackAt: number): {
  comments: Comment[]; ambiguousIds: ReadonlySet<string>;
} {
  const counts = new Map<string, number>();
  for (const row of rows) if (validId(row.id)) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const ambiguousIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
  const used = new Set(counts.keys());
  const comments = rows.map((row): Comment => {
    let id = row.id;
    if (!validId(id) || ambiguousIds.has(id)) {
      do { id = crypto.randomUUID(); } while (used.has(id));
      used.add(id);
    }
    return {
      ...row, id,
      at: validTime(row.at) ? row.at : (validTime(fallbackAt) ? fallbackAt : 0),
      replyTo: validId(row.replyTo) && !ambiguousIds.has(row.replyTo) ? row.replyTo : undefined,
      peer: row.peer === '' ? '' : validId(row.peer) ? row.peer : undefined,
    };
  });
  const byId = new Map(comments.map(row => [row.id, row]));
  for (const row of comments) {
    if (row.replyTo === row.id || (row.replyTo && !byId.has(row.replyTo))) row.replyTo = undefined;
  }
  // Mark every edge belonging to a cycle, without recursively walking a long thread.
  const done = new Set<string>();
  for (const start of comments) {
    const positions = new Map<string, number>();
    const trail: Comment[] = [];
    let current: Comment | undefined = start;
    while (current && !done.has(current.id)) {
      const repeated = positions.get(current.id);
      if (repeated !== undefined) {
        for (const cyclic of trail.slice(repeated)) cyclic.replyTo = undefined;
        break;
      }
      positions.set(current.id, trail.length);
      trail.push(current);
      current = current.replyTo ? byId.get(current.replyTo) : undefined;
    }
    for (const row of trail) done.add(row.id);
  }
  for (const row of comments) {
    const parent = row.replyTo ? byId.get(row.replyTo) : undefined;
    // A concrete parent takes precedence over stale/forged addressing metadata.
    if (row.authorKind === 'player' && row.peer !== '' && parent?.authorKind === 'persona') row.peer = parent.authorId;
  }
  return { comments, ambiguousIds };
}

/** Preserve valid legacy jobs, but never turn a bad explicit source into an
 * unscoped job that will silently answer a different player's comment.
 */
export function repairForumPending(
  rows: unknown, comments: readonly Comment[], ambiguousIds: ReadonlySet<string>,
  allowedPersonas?: ReadonlySet<string>,
): PendingReply[] {
  if (!Array.isArray(rows)) return [];
  const byId = new Map(comments.map(row => [row.id, row]));
  const seen = new Set<string>();
  const out: PendingReply[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Partial<PendingReply>;
    if (!validId(row.personaId) || !validTime(row.at) ||
        (allowedPersonas && !allowedPersonas.has(row.personaId)) ||
        (row.phase !== 'reply' && row.phase !== 'reaction' && row.phase !== 'decide')) continue;
    if (row.sourceCommentId !== undefined) {
      if (!validId(row.sourceCommentId) || ambiguousIds.has(row.sourceCommentId)) continue;
      const source = byId.get(row.sourceCommentId);
      if (!source || source.authorKind !== 'player') continue;
      if (row.phase !== 'reaction' && (source.peer === '' || (source.peer && source.peer !== row.personaId))) continue;
    }
    const key = JSON.stringify([row.personaId, row.phase, row.sourceCommentId ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ personaId: row.personaId, at: row.at, phase: row.phase as PendingReply['phase'],
      sourceCommentId: row.sourceCommentId, attempt: attempt(row.attempt) });
  }
  return out;
}

export function repairForumPlan(rows: unknown, allowedPersonas?: ReadonlySet<string>): PlannedArrival[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: PlannedArrival[] = [];
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Partial<PlannedArrival>;
    if (!validId(row.personaId) || !validTime(row.at) || seen.has(row.personaId) ||
        (allowedPersonas && !allowedPersonas.has(row.personaId)) ||
        (row.phase !== undefined && row.phase !== 'arrival')) continue;
    seen.add(row.personaId);
    out.push({ personaId: row.personaId, at: row.at, phase: row.phase, attempt: attempt(row.attempt) });
  }
  return out;
}
