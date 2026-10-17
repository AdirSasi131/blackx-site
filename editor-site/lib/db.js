import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export const STATUSES = ['New', 'Needs Review', 'Qualified', 'Contacted', 'Negotiating', 'Accepted', 'Rejected', 'Archived'];
const statusList = STATUSES.map((s) => `'${s}'`).join(',');

const MIGRATIONS = [
  `
  CREATE TABLE owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE rate_events (
    key TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX idx_rate_events ON rate_events (key, ts);
  CREATE TABLE leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    idem_key TEXT UNIQUE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    contact_method TEXT NOT NULL,
    contact_value TEXT NOT NULL CHECK (length(contact_value) BETWEEN 3 AND 120),
    channel_url TEXT NOT NULL CHECK (length(channel_url) <= 300),
    category TEXT NOT NULL,
    category_other TEXT,
    service TEXT NOT NULL,
    service_other TEXT,
    collab TEXT NOT NULL,
    videos_per_month TEXT,
    video_length TEXT,
    platforms TEXT NOT NULL DEFAULT '[]',
    style_ref TEXT,
    budget TEXT,
    start_timing TEXT,
    details TEXT,
    raw_footage TEXT,
    video_topic TEXT,
    thumb_refs TEXT,
    consent INTEGER NOT NULL CHECK (consent = 1),
    status TEXT NOT NULL DEFAULT 'New' CHECK (status IN (${statusList})),
    is_spam INTEGER NOT NULL DEFAULT 0 CHECK (is_spam IN (0,1)),
    score INTEGER NOT NULL DEFAULT 0,
    score_category TEXT,
    score_breakdown TEXT NOT NULL DEFAULT '[]',
    flags TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    est_revenue REAL,
    est_hours REAL,
    est_costs REAL
  );
  CREATE INDEX idx_leads_created ON leads (created_at);
  CREATE INDEX idx_leads_status ON leads (status, is_spam);
  CREATE INDEX idx_leads_contact ON leads (lower(contact_value));
  CREATE TABLE portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('video','short','thumbnail','before_after')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    media_url TEXT,
    thumb_url TEXT,
    before_url TEXT,
    after_url TEXT,
    visible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Settings (JSON values, merged over defaults so new keys appear automatically) ----
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export function getSetting(key, defaults) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return structuredClone(defaults);
  try {
    return deepMerge(structuredClone(defaults), JSON.parse(row.value));
  } catch {
    return structuredClone(defaults);
  }
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

// Secret used to sign form tokens and hash IPs. Env wins; otherwise generated once and stored.
export function appSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = '_app_secret'").get();
  if (row) return JSON.parse(row.value);
  const s = crypto.randomBytes(32).toString('hex');
  setSetting('_app_secret', s);
  return s;
}

// ---- Rate limiting backed by the DB so it survives restarts ----
export function rateCount(key, windowSec) {
  const since = Date.now() - windowSec * 1000;
  return db.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND ts > ?').get(key, since).n;
}
export function rateRecord(key) {
  db.prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)').run(key, Date.now());
}
export function rateClear(key) {
  db.prepare('DELETE FROM rate_events WHERE key = ?').run(key);
}
export function rateCleanup() {
  db.prepare('DELETE FROM rate_events WHERE ts < ?').run(Date.now() - 2 * 86400 * 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}
