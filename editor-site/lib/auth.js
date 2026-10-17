import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, now, rateCount, rateRecord, rateClear } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 7 * 86400 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const key = await scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(N), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, expected);
}

export function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (email && password.toLowerCase() === String(email).toLowerCase()) return 'Password must not equal your email.';
  if (/^(.)\1+$/.test(password) || /^(password|12345678|qwertyuiop)/i.test(password)) return 'Please choose a less guessable password.';
  return null;
}

export const ownerExists = () => !!db.prepare('SELECT 1 FROM owner WHERE id = 1').get();

export async function createOwner(email, password) {
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO owner (id, email, password_hash, created_at) VALUES (1, ?, ?, ?)').run(email.toLowerCase(), hash, now());
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, csrf, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), csrf, t, t + SESSION_MS);
  return { token, csrf, maxAgeSec: SESSION_MS / 1000 };
}

export function getSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!row || row.expires_at < Date.now()) return null;
  if (row.expires_at - Date.now() < SESSION_MS - 86400 * 1000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_MS, row.token_hash);
  }
  return { csrf: row.csrf, hash: row.token_hash };
}

export const destroySession = (token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token || ''));
export const destroyAllSessions = () => db.prepare('DELETE FROM sessions').run();

// Login throttling: 8 failures / 15 min per IP, 20 / hour for the account overall.
export function loginThrottled(ipKey) {
  return rateCount(`login:${ipKey}`, 900) >= 8 || rateCount('login:all', 3600) >= 20;
}
export function loginFailed(ipKey) {
  rateRecord(`login:${ipKey}`);
  rateRecord('login:all');
}
export function loginSucceeded(ipKey) {
  rateClear(`login:${ipKey}`);
}

export async function checkLogin(email, password) {
  const owner = db.prepare('SELECT * FROM owner WHERE id = 1').get();
  // Always do the hash work so timing does not reveal whether the email matched.
  const dummy = 'scrypt$16384$00000000000000000000000000000000$' + '00'.repeat(64);
  const ok = await verifyPassword(String(password || ''), owner ? owner.password_hash : dummy);
  return !!owner && ok && String(email || '').trim().toLowerCase() === owner.email;
}
