import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { getSession, insertSession, revokeSession } from './db.mjs';

const b64 = value => Buffer.from(value).toString('base64url');
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

export function createSessionService({ db, secret, ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('session secret must be at least 16 chars');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('invalid sessionTtlMs');
  const key = Buffer.from(secret);

  function issue() {
    const createdAt = now();
    const expiresAt = createdAt + ttlMs;
    if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt)) throw new Error('invalid session clock');
    const id = randomBytes(18).toString('base64url');
    insertSession(db, id, createdAt, expiresAt);
    const payload = b64(JSON.stringify({ sid: id, exp: expiresAt }));
    return { sessionId: id, token: `${payload}.${sign(key, payload)}`, expiresAt };
  }

  function verify(token) {
    if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const dot = token.indexOf('.');
    if (dot < 1 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const received = token.slice(dot + 1);
    const expected = sign(key, payload);
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (!data || typeof data.sid !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(data.sid) || !Number.isSafeInteger(data.exp)) return null;
    if (data.exp <= now()) return null;
    const session = getSession(db, data.sid, now());
    if (!session || session.expires_at !== data.exp) return null;
    return { sessionId: data.sid, expiresAt: data.exp };
  }

  function revoke(sessionId) {
    revokeSession(db, sessionId);
  }

  return { issue, verify, revoke };
}

export function sessionTag(sessionId) {
  return createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 12);
}
