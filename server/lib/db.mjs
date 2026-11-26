import { DatabaseSync } from 'node:sqlite';

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS quota_daily (
      session_id TEXT NOT NULL,
      day TEXT NOT NULL,
      used INTEGER NOT NULL,
      PRIMARY KEY (session_id, day)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      day TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );
  `);
  return db;
}

export function insertSession(db, id, createdAt, expiresAt) {
  db.prepare('INSERT INTO sessions (id, created_at, expires_at, revoked) VALUES (?, ?, ?, 0)')
    .run(id, createdAt, expiresAt);
}

export function getSession(db, id, now) {
  const row = db.prepare('SELECT id, expires_at, revoked FROM sessions WHERE id = ?').get(id);
  if (!row || row.revoked || row.expires_at <= now) return null;
  return row;
}

export function revokeSession(db, id) {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(id);
}

export function reserveAttempt(db, { attemptId, sessionId, day, provider, model, createdAt, limit, globalLimit, requireActiveSession = false }) {
  if (!Number.isSafeInteger(limit) || limit < 0 || (globalLimit !== undefined && (!Number.isSafeInteger(globalLimit) || globalLimit < 0))) throw new Error('invalid quota limit');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (requireActiveSession && !getSession(db, sessionId, createdAt)) {
      db.exec('ROLLBACK'); return { ok: false, reason: 'unauthorized' };
    }
    const row = db.prepare('SELECT used FROM quota_daily WHERE session_id = ? AND day = ?')
      .get(sessionId, day);
    const used = row ? row.used : 0;
    if (!Number.isSafeInteger(used) || used < 0) throw new Error('invalid quota row');
    if (globalLimit !== undefined) {
      const totals = db.prepare(`SELECT COALESCE(SUM(used),0) AS total,
        COALESCE(SUM(CASE WHEN typeof(used) != 'integer' OR used < 0 THEN 1 ELSE 0 END),0) AS invalid
        FROM quota_daily WHERE day = ?`).get(day);
      if (totals.invalid || !Number.isSafeInteger(totals.total) || totals.total < 0) throw new Error('invalid global quota');
      // Current-day quota and attempt rows are written in the same transaction.
      // Missing or mismatched rows must not silently restore spend capacity.
      // Check all subjects, not only the requester: two mismatched rows can
      // cancel each other out in the global SUM. Run under BEGIN IMMEDIATE.
      const mismatch = db.prepare(`WITH counted AS (
        SELECT session_id, COUNT(*) AS n FROM attempts WHERE day = ? GROUP BY session_id
      ) SELECT 1 AS bad FROM counted c
        LEFT JOIN quota_daily q ON q.session_id = c.session_id AND q.day = ?
        WHERE q.session_id IS NULL OR q.used != c.n
      UNION ALL SELECT 1 AS bad FROM quota_daily q
        LEFT JOIN counted c ON c.session_id = q.session_id
        WHERE q.day = ? AND q.used != COALESCE(c.n, 0)
      LIMIT 1`).get(day, day, day);
      if (mismatch) throw new Error('inconsistent quota ledger');
      if (totals.total >= globalLimit) { db.exec('ROLLBACK'); return { ok: false, reason: 'global_quota', used, limit }; }
    }
    if (used >= limit) {
      db.exec('ROLLBACK');
      return { ok: false, used, limit };
    }
    db.prepare(`
      INSERT INTO quota_daily (session_id, day, used) VALUES (?, ?, 1)
      ON CONFLICT(session_id, day) DO UPDATE SET used = used + 1
    `).run(sessionId, day);
    db.prepare(`
      INSERT INTO attempts (id, session_id, day, provider, model, status, created_at, settled_at)
      VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL)
    `).run(attemptId, sessionId, day, provider, model, createdAt);
    db.exec('COMMIT');
    return { ok: true, used: used + 1, limit };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function settleAttempt(db, attemptId, status, settledAt, requireActiveSession = false) {
  // A success UPDATE and the session check must share one SQLite statement.
  // This is the success linearization point, not a guarantee about subsequent
  // revocation vs. delivery over the network.
  const sql = "UPDATE attempts SET status = ?, settled_at = ? WHERE id = ? AND status = 'reserved'";
  if (requireActiveSession && status === 'ok') {
    return db.prepare(sql + ` AND EXISTS (SELECT 1 FROM sessions s
      WHERE s.id = attempts.session_id AND s.revoked = 0 AND s.expires_at > ?)`)
      .run(status, settledAt, attemptId, settledAt).changes;
  }
  return db.prepare(sql).run(status, settledAt, attemptId).changes;
}

export function markStaleAttempts(db, staleBefore, settledAt) {
  return db.prepare("UPDATE attempts SET status = 'unknown', settled_at = ? WHERE status = 'reserved' AND created_at < ?")
    .run(settledAt, staleBefore).changes;
}

export function listAttempts(db, sessionId) {
  return db.prepare('SELECT id, day, provider, model, status, created_at, settled_at FROM attempts WHERE session_id = ? ORDER BY rowid')
    .all(sessionId);
}

export function quotaUsed(db, sessionId, day) {
  const row = db.prepare('SELECT used FROM quota_daily WHERE session_id = ? AND day = ?')
    .get(sessionId, day);
  return row ? Number(row.used) : 0;
}
