import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')); } catch { /* .env is optional */ }

const { db, now, tx, getSetting, setSetting, appSecret, rateCount, rateRecord, rateCleanup, STATUSES, UPLOAD_DIR } = await import('./lib/db.js');
const D = await import('./lib/defaults.js');
const A = await import('./lib/auth.js');
const { validateLead, normalizeUrl } = await import('./lib/validate.js');
const S = await import('./lib/spam.js');
const L = await import('./lib/leads.js');
const P = await import('./lib/pricing.js');
const { normalizeScoring } = await import('./lib/scoring.js');
const { notifyNewLead, notifyStatus } = await import('./lib/notify.js');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECRET = appSecret();

// ---------------------------------------------------------------- helpers
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; " +
    "font-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; object-src 'none'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',').pop().trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
const ipKey = (req) => S.hashIp(SECRET, clientIp(req));
const isHttps = (req) => !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) return reject(new HttpError(413, 'הבקשה גדולה מדי'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'הבקשה גדולה מדי')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type חייב להיות application/json');
  const buf = await readBody(req, limit);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'JSON לא תקין');
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sessionCookie = (req, token, maxAge) =>
  `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients / same-origin GET-like fetches
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function requireOwner(req, mutating) {
  const session = A.getSession(parseCookies(req).sid);
  if (!session) throw new HttpError(401, 'אינכם מחוברים');
  if (mutating) {
    if (!sameOrigin(req)) throw new HttpError(403, 'מקור לא תקין');
    const sent = String(req.headers['x-csrf-token'] || '');
    const a = Buffer.from(sent);
    const b = Buffer.from(session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'אסימון CSRF לא תקין');
  }
  return session;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');
const numOrNull = (v) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new HttpError(422, 'מספר לא תקין', { errors: { number: 'חייב להיות מספר ≥ 0' } });
  return n;
};

// ---------------------------------------------------------------- owner bootstrap
let setupCode = null;
async function bootstrapOwner() {
  if (A.ownerExists()) return;
  const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const pw = process.env.OWNER_PASSWORD || '';
  if (email && pw) {
    const problem = A.passwordProblem(pw, email);
    if (problem) { console.error(`[setup] OWNER_PASSWORD rejected: ${problem}`); }
    else { await A.createOwner(email, pw); console.log(`[setup] Owner account created for ${email} from environment variables.`); return; }
  }
  setupCode = crypto.randomBytes(5).toString('hex').toUpperCase();
  console.log('\n========================================================');
  console.log(' FIRST-RUN SETUP: no owner account exists yet.');
  console.log(` Open  /admin  and create it with this one-time code:  ${setupCode}`);
  console.log(' (A new code is generated on every restart until an account exists.)');
  console.log('========================================================\n');
}

// ---------------------------------------------------------------- public handlers
function publicSite() {
  const site = getSetting('site', D.DEFAULT_SITE);
  const business = getSetting('business', D.DEFAULT_BUSINESS);
  return { site, business };
}

function portfolioPublic() {
  const rows = db.prepare('SELECT * FROM portfolio WHERE visible = 1 ORDER BY sort_order, id').all();
  return rows.map((r) => {
    const m = mediaInfo(r.media_url);
    return {
      id: r.id, kind: r.kind, title: r.title, description: r.description, tags: JSON.parse(r.tags || '[]'),
      media: m, thumb_url: r.thumb_url || (m.provider === 'youtube' ? `https://i.ytimg.com/vi/${m.id}/hqdefault.jpg` : null),
      before_url: r.before_url, after_url: r.after_url,
    };
  });
}

function mediaInfo(url) {
  if (!url) return { provider: null };
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return { provider: 'youtube', id: m[1] };
  m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  if (m) return { provider: 'vimeo', id: m[1] };
  return { provider: 'file', url };
}

async function handleLeadSubmit(req, res) {
  if (!sameOrigin(req)) throw new HttpError(403, 'מקור לא תקין');
  const key = ipKey(req);
  if (rateCount(`lead:${key}`, 3600) >= 6 || rateCount(`lead:${key}`, 86400) >= 20) {
    throw new HttpError(429, 'שלחתם כמה פניות לאחרונה. נסו שוב מאוחר יותר, או צרו איתי קשר ישירות.');
  }
  const body = await readJson(req, 32 * 1024);
  const { ok, errors, value } = validateLead(body);
  if (!ok) return json(res, 422, { error: 'validation', errors });
  rateRecord(`lead:${key}`);

  const idem = typeof body.idem_key === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(body.idem_key) ? body.idem_key : null;
  if (idem && db.prepare('SELECT 1 FROM leads WHERE idem_key = ?').get(idem)) return json(res, 200, { ok: true, duplicate: true });

  const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const sameContact = !!db.prepare('SELECT 1 FROM leads WHERE lower(contact_value) = ? AND created_at > ? LIMIT 1').get(value.contact_value.toLowerCase(), since);
  const sameChannel = !!db.prepare('SELECT 1 FROM leads WHERE channel_url = ? AND created_at > ? LIMIT 1').get(value.channel_url, since);
  const verdict = S.analyze({
    lead: value,
    honeypot: str(body.company_website, 200) !== '',
    token: S.checkToken(SECRET, body.form_token),
    duplicates: { sameContact, sameChannel },
  });

  const t = now();
  const status = verdict.suspicious && !verdict.isSpam ? 'Needs Review' : 'New';
  let id;
  try {
    id = tx(() => {
      const r = db.prepare(
        `INSERT INTO leads (created_at, updated_at, idem_key, name, contact_method, contact_value, channel_url, category, category_other,
          service, service_other, collab, videos_per_month, video_length, platforms, style_ref, budget, start_timing, details,
          raw_footage, video_topic, thumb_refs, consent, status, is_spam, flags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        t, t, idem, value.name, value.contact_method, value.contact_value, value.channel_url, value.category, value.category_other,
        value.service, value.service_other, value.collab, value.videos_per_month, value.video_length, JSON.stringify(value.platforms),
        value.style_ref, value.budget, value.start_timing, value.details, value.raw_footage, value.video_topic, value.thumb_refs,
        1, status, verdict.isSpam ? 1 : 0, JSON.stringify(verdict.flags),
      );
      L.rescoreLead(Number(r.lastInsertRowid));
      return Number(r.lastInsertRowid);
    });
  } catch (e) {
    if (/UNIQUE constraint failed: leads.idem_key/.test(String(e.message))) return json(res, 200, { ok: true, duplicate: true });
    throw e;
  }

  const lead = L.rowToLead(db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
  notifyNewLead(lead, getSetting('notifications', D.DEFAULT_NOTIFICATIONS)).catch((e) => console.error('[notify]', e.message));
  json(res, 201, { ok: true });
}

// ---------------------------------------------------------------- admin handlers
function overview() {
  const counts = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM leads WHERE is_spam = 0 GROUP BY status').all()) counts[r.status] = r.n;
  const spam = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE is_spam = 1').get().n;
  const pricing = getSetting('pricing', D.DEFAULT_PRICING);
  const site = getSetting('site', D.DEFAULT_SITE);
  const business = getSetting('business', D.DEFAULT_BUSINESS);
  const ns = notifyStatus();
  const items = db.prepare('SELECT COUNT(*) AS n FROM portfolio WHERE visible = 1').get().n;
  const checklist = [
    { key: 'pricing', label: 'הזינו את התעריפים האמיתיים שלכם (כרטיסיית מחיר והצעות מחיר)', done: !!pricing.is_real },
    { key: 'brand', label: 'הגדירו את השם/המותג שלכם (הגדרות → תוכן האתר)', done: site.brand_name !== D.DEFAULT_SITE.brand_name },
    { key: 'about', label: 'כתבו טקסט “אודות” משלכם', done: site.about_text !== D.DEFAULT_SITE.about_text },
    { key: 'contact', label: 'הוסיפו את פרטי הקשר שלכם (הגדרות → עסק וזמינות)', done: !!(business.contact_email || business.whatsapp) },
    { key: 'privacy', label: 'הוסיפו כתובת אימייל ליצירת קשר בנושא פרטיות (הגדרות → תוכן האתר)', done: !!site.privacy_email },
    { key: 'portfolio', label: 'הוסיפו עבודות תיק עבודות אמיתיות (כרטיסיית תיק עבודות)', done: items > 0 },
    { key: 'notify', label: 'הגדירו התראות באימייל או ב-webhook (ראה README)', done: ns.email || ns.webhook },
  ];
  return { counts, spam, total: Object.values(counts).reduce((a, b) => a + b, 0), checklist, notify: ns, statuses: STATUSES };
}

function listLeads(url) {
  const q = url.searchParams;
  const where = [];
  const args = [];
  const spamMode = q.get('spam') || 'hide';
  if (spamMode === 'hide') where.push('is_spam = 0');
  else if (spamMode === 'only') where.push('is_spam = 1');
  if (q.get('status') && STATUSES.includes(q.get('status'))) { where.push('status = ?'); args.push(q.get('status')); }
  if (['editing', 'thumbnail', 'both', 'other'].includes(q.get('service'))) { where.push('service = ?'); args.push(q.get('service')); }
  if (q.get('category')) { where.push('category = ?'); args.push(q.get('category')); }
  if (['High priority', 'Needs review', 'Low priority'].includes(q.get('priority'))) { where.push('score_category = ?'); args.push(q.get('priority')); }
  const term = (q.get('q') || '').trim().slice(0, 100);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR contact_value LIKE ? ESCAPE '\\' OR channel_url LIKE ? ESCAPE '\\' OR details LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like, like);
  }
  const sorts = { date: 'created_at', score: 'score', service: 'service', status: 'status' };
  const col = sorts[q.get('sort')] || 'created_at';
  const dir = q.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${col} ${dir}, id DESC LIMIT 500`;
  return db.prepare(sql).all(...args).map(L.rowToLead);
}

function patchLead(id, body) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'הפנייה לא נמצאה');
  const sets = [];
  const args = [];
  let rescoreAll = false;
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(422, 'סטטוס לא תקין');
    sets.push('status = ?'); args.push(body.status); rescoreAll = true;
  }
  if (body.notes !== undefined) { sets.push('notes = ?'); args.push(str(body.notes, 5000)); }
  if (body.is_spam !== undefined) { sets.push('is_spam = ?'); args.push(body.is_spam ? 1 : 0); }
  for (const k of ['est_revenue', 'est_hours', 'est_costs']) {
    if (body[k] !== undefined) { sets.push(`${k} = ?`); args.push(numOrNull(body[k])); if (k === 'est_hours') rescoreAll = true; }
  }
  if (!sets.length) throw new HttpError(400, 'אין מה לעדכן');
  sets.push('updated_at = ?'); args.push(now());
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  rescoreAll ? L.rescoreAll() : L.rescoreLead(id);
  const lead = L.rowToLead(db.prepare('SELECT * FROM leads WHERE id = ?').get(id));
  return { lead, analysis: L.leadAnalysis(lead) };
}

const isMediaRef = (u) => typeof u === 'string' && (/^\/media\/[a-z0-9._-]+$/i.test(u) || /^https:\/\/[^\s]+$/i.test(u)) && u.length <= 500;

function portfolioInput(body, partial = false) {
  const out = {};
  const errors = {};
  if (!partial || body.kind !== undefined) {
    if (!['video', 'short', 'thumbnail', 'before_after'].includes(body.kind)) errors.kind = 'בחרו סוג.'; else out.kind = body.kind;
  }
  if (!partial || body.title !== undefined) {
    const t = str(body.title, 100);
    if (!t) errors.title = 'כותרת נדרשת.'; else out.title = t;
  }
  if (body.description !== undefined) out.description = str(body.description, 400);
  if (body.tags !== undefined) {
    const tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',');
    out.tags = JSON.stringify(tags.map((t) => str(String(t), 30)).filter(Boolean).slice(0, 8));
  }
  for (const k of ['media_url', 'thumb_url', 'before_url', 'after_url']) {
    if (body[k] === undefined) continue;
    const v = str(body[k], 500);
    if (!v) out[k] = null;
    else if (!isMediaRef(v)) errors[k] = 'השתמשו בקישור https:// או בקובץ שהועלה.';
    else out[k] = v;
  }
  if (body.visible !== undefined) out.visible = body.visible ? 1 : 0;
  if (Object.keys(errors).length) throw new HttpError(422, 'פריט תיק עבודות לא תקין', { errors });
  return out;
}

const SIGS = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8, jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  png: (b) => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  gif: (b) => b.slice(0, 4).toString() === 'GIF8',
  webp: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP',
  mp4: (b) => b.slice(4, 8).toString() === 'ftyp',
  webm: (b) => b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
};

function cleanSite(input, cur) {
  const errors = {};
  const out = { ...cur };
  const text = (k, max, required) => {
    if (input[k] === undefined) return;
    const v = str(input[k], max);
    if (required && !v) errors[k] = 'Required.'; else out[k] = v;
  };
  text('brand_name', 60, true); text('hero_headline', 120, true); text('hero_sub', 300, true);
  text('about_title', 100, true); text('about_text', 2500, true);
  if (input.skills !== undefined) {
    const arr = Array.isArray(input.skills) ? input.skills : String(input.skills).split(',');
    out.skills = arr.map((s) => str(String(s), 40)).filter(Boolean).slice(0, 30);
  }
  if (input.profile_image_url !== undefined) {
    const v = str(input.profile_image_url, 500);
    if (v && !isMediaRef(v)) errors.profile_image_url = 'השתמשו בקישור https:// או העלו תמונה.'; else out.profile_image_url = v;
  }
  if (input.privacy_email !== undefined) {
    const v = str(input.privacy_email, 120);
    if (v && !/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(v)) errors.privacy_email = 'כתובת אימייל לא תקינה.'; else out.privacy_email = v;
  }
  return { out, errors };
}

function cleanBusiness(input, cur) {
  const errors = {};
  const out = { ...cur };
  if (input.contact_email !== undefined) {
    const v = str(input.contact_email, 120);
    if (v && !/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(v)) errors.contact_email = 'כתובת אימייל לא תקינה.'; else out.contact_email = v;
  }
  if (input.whatsapp !== undefined) {
    const v = str(input.whatsapp, 30).replace(/[\s+().-]/g, '');
    if (v && !/^\d{7,15}$/.test(v)) errors.whatsapp = 'ספרות בלבד עם קידומת מדינה, למשל 972501234567.'; else out.whatsapp = v;
  }
  if (input.show_whatsapp_public !== undefined) out.show_whatsapp_public = !!input.show_whatsapp_public;
  if (input.preferred_channel !== undefined) {
    if (!['email', 'whatsapp', 'discord', 'telegram', 'instagram', 'other'].includes(input.preferred_channel)) errors.preferred_channel = 'Invalid.'; else out.preferred_channel = input.preferred_channel;
  }
  if (input.availability !== undefined) {
    if (!['open', 'limited', 'closed'].includes(input.availability)) errors.availability = 'Invalid.'; else out.availability = input.availability;
  }
  if (input.availability_note !== undefined) out.availability_note = str(input.availability_note, 160);
  for (const [k, max] of [['min_budget', 1e6], ['weekly_capacity_hours', 168], ['target_hourly_rate', 1e4]]) {
    if (input[k] === undefined) continue;
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < 0 || v > max) errors[k] = `0 – ${max}`; else out[k] = v;
  }
  if (input.accepted_payments !== undefined) out.accepted_payments = str(input.accepted_payments, 200);
  return { out, errors };
}

// ---------------------------------------------------------------- router
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler });

route('GET', '/healthz', async (req, res) => json(res, 200, { ok: true }));
route('GET', '/api/site', async (req, res) => {
  const { site, business } = publicSite();
  json(res, 200, { brand_name: site.brand_name, availability: business.availability, availability_note: business.availability_note });
});
route('GET', '/api/portfolio', async (req, res) => json(res, 200, { items: portfolioPublic() }));
route('GET', '/api/form-token', async (req, res) => json(res, 200, { token: S.signToken(SECRET) }));
route('POST', '/api/leads', handleLeadSubmit);

// --- auth
route('GET', '/api/admin/status', async (req, res) => {
  const s = A.getSession(parseCookies(req).sid);
  json(res, 200, { setup_required: !A.ownerExists(), signed_in: !!s, csrf: s?.csrf || null });
});

route('POST', '/api/admin/setup', async (req, res) => {
  if (!sameOrigin(req)) throw new HttpError(403, 'מקור לא תקין');
  if (A.ownerExists()) throw new HttpError(409, 'ההגדרה הראשונית כבר הושלמה');
  const key = ipKey(req);
  if (A.loginThrottled(`setup:${key}`)) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.');
  const b = await readJson(req);
  const email = str(b.email, 120).toLowerCase();
  const given = Buffer.from(String(b.code || '').trim().toUpperCase());
  const real = Buffer.from(setupCode || '');
  if (!setupCode || given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    A.loginFailed(`setup:${key}`);
    throw new HttpError(403, 'קוד הגדרה ראשונית לא תקין. בדקו את יומן השרת.');
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(email)) throw new HttpError(422, 'הזינו כתובת אימייל תקינה.');
  const problem = A.passwordProblem(b.password, email);
  if (problem) throw new HttpError(422, problem);
  await A.createOwner(email, b.password);
  setupCode = null;
  const s = A.createSession();
  json(res, 201, { ok: true, csrf: s.csrf }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAgeSec) });
});

route('POST', '/api/admin/login', async (req, res) => {
  if (!sameOrigin(req)) throw new HttpError(403, 'מקור לא תקין');
  const key = ipKey(req);
  if (A.loginThrottled(key)) throw new HttpError(429, 'יותר מדי ניסיונות כושלים. אנא המתינו 15 דקות.');
  const b = await readJson(req);
  if (!(await A.checkLogin(b.email, b.password))) {
    A.loginFailed(key);
    throw new HttpError(401, 'אימייל או סיסמה שגויים.');
  }
  A.loginSucceeded(key);
  const s = A.createSession();
  json(res, 200, { ok: true, csrf: s.csrf }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAgeSec) });
});

route('POST', '/api/admin/logout', async (req, res) => {
  requireOwner(req, true);
  A.destroySession(parseCookies(req).sid);
  json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
});

route('POST', '/api/admin/password', async (req, res) => {
  requireOwner(req, true);
  const b = await readJson(req);
  const owner = db.prepare('SELECT * FROM owner WHERE id = 1').get();
  if (!(await A.verifyPassword(String(b.current || ''), owner.password_hash))) throw new HttpError(403, 'הסיסמה הנוכחית שגויה.');
  const problem = A.passwordProblem(b.next, owner.email);
  if (problem) throw new HttpError(422, problem);
  db.prepare('UPDATE owner SET password_hash = ? WHERE id = 1').run(await A.hashPassword(b.next));
  A.destroyAllSessions();
  const s = A.createSession();
  json(res, 200, { ok: true, csrf: s.csrf }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAgeSec) });
});

// --- dashboard data
route('GET', '/api/admin/overview', async (req, res) => { requireOwner(req); json(res, 200, overview()); });

route('GET', '/api/admin/leads', async (req, res, url) => { requireOwner(req); json(res, 200, { leads: listLeads(url) }); });

route('GET', '/api/admin/leads/(\\d+)', async (req, res, url, m) => {
  requireOwner(req);
  const lead = L.rowToLead(db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(m[1])));
  if (!lead) throw new HttpError(404, 'Lead not found');
  json(res, 200, { lead, analysis: L.leadAnalysis(lead) });
});

route('PATCH', '/api/admin/leads/(\\d+)', async (req, res, url, m) => {
  requireOwner(req, true);
  json(res, 200, patchLead(Number(m[1]), await readJson(req)));
});

route('DELETE', '/api/admin/leads/(\\d+)', async (req, res, url, m) => {
  requireOwner(req, true);
  const row = db.prepare('SELECT is_spam, status FROM leads WHERE id = ?').get(Number(m[1]));
  if (!row) throw new HttpError(404, 'הפנייה לא נמצאה');
  // Safety: legitimate inquiries cannot be deleted by accident. Mark as spam or archive first.
  if (!row.is_spam && row.status !== 'Archived') throw new HttpError(409, 'סמנו את הפנייה הזו כספאם או ארכו אותה לפני מחיקה לצמיתות.');
  db.prepare('DELETE FROM leads WHERE id = ?').run(Number(m[1]));
  json(res, 200, { ok: true });
});

route('GET', '/api/admin/pricing', async (req, res) => { requireOwner(req); json(res, 200, { pricing: getSetting('pricing', D.DEFAULT_PRICING) }); });
route('PUT', '/api/admin/pricing', async (req, res) => {
  requireOwner(req, true);
  const body = await readJson(req, 128 * 1024);
  try {
    const next = P.normalizePricing(body, getSetting('pricing', D.DEFAULT_PRICING));
    setSetting('pricing', next);
    L.rescoreAll();
    json(res, 200, { pricing: next });
  } catch (e) {
    if (e.errors) throw new HttpError(422, 'אנא תקנו את השדות המסומנים.', { errors: e.errors });
    throw e;
  }
});
route('POST', '/api/admin/estimate', async (req, res) => {
  requireOwner(req, true);
  const b = await readJson(req);
  const input = {
    service: ['editing', 'thumbnail', 'both', 'other'].includes(b.service) ? b.service : 'editing',
    videos: b.videos, minutes: b.minutes, shorts: b.shorts, thumbnails: b.thumbnails, complexity: b.complexity,
    recurring: !!b.recurring, rush: !!b.rush, special: !!b.special, addons: Array.isArray(b.addons) ? b.addons.slice(0, 30).map(String) : [],
  };
  json(res, 200, { estimate: P.estimate(input, getSetting('pricing', D.DEFAULT_PRICING)) });
});

route('GET', '/api/admin/settings', async (req, res) => {
  requireOwner(req);
  json(res, 200, {
    site: getSetting('site', D.DEFAULT_SITE),
    business: getSetting('business', D.DEFAULT_BUSINESS),
    notifications: getSetting('notifications', D.DEFAULT_NOTIFICATIONS),
    scoring: getSetting('scoring', D.DEFAULT_SCORING),
    notify_status: notifyStatus(),
  });
});
route('PUT', '/api/admin/settings', async (req, res) => {
  requireOwner(req, true);
  const b = await readJson(req, 128 * 1024);
  const errors = {};
  if (b.site) {
    const { out, errors: e } = cleanSite(b.site, getSetting('site', D.DEFAULT_SITE));
    Object.entries(e).forEach(([k, v]) => (errors[`site.${k}`] = v));
    if (!Object.keys(e).length) setSetting('site', out);
  }
  if (b.business) {
    const { out, errors: e } = cleanBusiness(b.business, getSetting('business', D.DEFAULT_BUSINESS));
    Object.entries(e).forEach(([k, v]) => (errors[`business.${k}`] = v));
    if (!Object.keys(e).length) setSetting('business', out);
  }
  if (b.notifications) {
    const cur = getSetting('notifications', D.DEFAULT_NOTIFICATIONS);
    for (const k of Object.keys(cur)) if (b.notifications[k] !== undefined) cur[k] = !!b.notifications[k];
    setSetting('notifications', cur);
  }
  if (b.scoring) {
    try { setSetting('scoring', normalizeScoring(b.scoring, getSetting('scoring', D.DEFAULT_SCORING))); }
    catch (e) { if (e.errors) Object.entries(e.errors).forEach(([k, v]) => (errors[`scoring.${k}`] = v)); else throw e; }
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'אנא תקנו את השדות המסומנים.', { errors });
  L.rescoreAll();
  json(res, 200, {
    site: getSetting('site', D.DEFAULT_SITE), business: getSetting('business', D.DEFAULT_BUSINESS),
    notifications: getSetting('notifications', D.DEFAULT_NOTIFICATIONS), scoring: getSetting('scoring', D.DEFAULT_SCORING),
  });
});

// --- portfolio
route('GET', '/api/admin/portfolio', async (req, res) => {
  requireOwner(req);
  json(res, 200, { items: db.prepare('SELECT * FROM portfolio ORDER BY sort_order, id').all().map((r) => ({ ...r, visible: !!r.visible, tags: JSON.parse(r.tags || '[]') })) });
});
route('POST', '/api/admin/portfolio', async (req, res) => {
  requireOwner(req, true);
  const v = portfolioInput(await readJson(req));
  const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM portfolio').get().m;
  const r = db.prepare(
    'INSERT INTO portfolio (kind, title, description, tags, media_url, thumb_url, before_url, after_url, visible, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(v.kind, v.title, v.description || '', v.tags || '[]', v.media_url ?? null, v.thumb_url ?? null, v.before_url ?? null, v.after_url ?? null, v.visible ?? 1, max + 1, now());
  json(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PATCH', '/api/admin/portfolio/(\\d+)', async (req, res, url, m) => {
  requireOwner(req, true);
  const id = Number(m[1]);
  const body = await readJson(req);
  if (!db.prepare('SELECT 1 FROM portfolio WHERE id = ?').get(id)) throw new HttpError(404, 'הפריט לא נמצא');
  if (body.move === 'up' || body.move === 'down') {
    const rows = db.prepare('SELECT id, sort_order FROM portfolio ORDER BY sort_order, id').all();
    const i = rows.findIndex((r) => r.id === id);
    const j = body.move === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < rows.length) {
      [rows[i], rows[j]] = [rows[j], rows[i]];
      tx(() => rows.forEach((r, idx) => db.prepare('UPDATE portfolio SET sort_order = ? WHERE id = ?').run(idx + 1, r.id)));
    }
    return json(res, 200, { ok: true });
  }
  const v = portfolioInput(body, true);
  const keys = Object.keys(v);
  if (keys.length) db.prepare(`UPDATE portfolio SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => v[k]), id);
  json(res, 200, { ok: true });
});
route('DELETE', '/api/admin/portfolio/(\\d+)', async (req, res, url, m) => {
  requireOwner(req, true);
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(Number(m[1]));
  json(res, 200, { ok: true });
});

route('POST', '/api/admin/upload', async (req, res, url) => {
  requireOwner(req, true);
  const ext = path.extname(url.searchParams.get('name') || '').slice(1).toLowerCase();
  if (!SIGS[ext]) throw new HttpError(415, 'סוגים מותרים: jpg, png, webp, gif, mp4, webm.');
  const buf = await readBody(req, 80 * 1024 * 1024);
  if (buf.length < 12 || !SIGS[ext](buf)) throw new HttpError(415, 'תוכן הקובץ אינו תואם את סיומתו.');
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  json(res, 201, { url: `/media/${name}` });
});

route('GET', '/api/admin/export', async (req, res, url) => {
  requireOwner(req);
  const csv = url.searchParams.get('format') !== 'json';
  const stamp = new Date().toISOString().slice(0, 10);
  send(res, 200, csv ? L.exportCsv() : L.exportJson(), {
    'Content-Type': csv ? 'text/csv; charset=utf-8' : 'application/json',
    'Content-Disposition': `attachment; filename="leads-${stamp}.${csv ? 'csv' : 'json'}"`,
    'Cache-Control': 'no-store',
  });
});

// ---------------------------------------------------------------- static files
let indexTemplate = null;
function renderIndex() {
  if (!indexTemplate || process.env.NODE_ENV !== 'production') indexTemplate = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const { site, business } = publicSite();
  const avail = {
    open: ['open', 'פתוח לפרויקטים חדשים'],
    limited: ['limited', 'זמינות מוגבלת'],
    closed: ['closed', 'מלא כרגע · פניות לרשימת המתנה יתקבלו בברכה'],
  }[business.availability] || ['open', 'פתוח לפרויקטים חדשים'];
  const paragraphs = site.about_text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  const skills = site.skills.length ? `<ul class="chips" aria-label="תוכנות ומיומנויות">${site.skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  const portrait = site.profile_image_url
    ? `<img src="${esc(site.profile_image_url)}" alt="דיוקן של ${esc(site.brand_name)}" loading="lazy" width="480" height="600">`
    : `<div class="portrait__mono" aria-hidden="true">${esc([...site.brand_name.trim()][0] || 'E')}</div>`;
  const privacy = site.privacy_email
    ? `שלחו אימייל אל <a href="mailto:${esc(site.privacy_email)}">${esc(site.privacy_email)}</a>`
    : 'שלחו הודעה חדשה דרך הטופס וציינו את הבקשה שלכם';
  const PAY_LABELS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', paypal: 'PayPal', applepay: 'Apple Pay', googlepay: 'Google Pay', bit: 'Bit', bank: 'העברה בנקאית' };
  const PAY_SVG = {
    visa: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Visa"><text x="60" y="30" font-family="Arial Black, Arial, sans-serif" font-size="22" font-weight="900" font-style="italic" fill="#1A1F71" text-anchor="middle">VISA</text></svg>',
    mastercard: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mastercard"><circle cx="47" cy="22" r="14" fill="#EB001B"/><circle cx="73" cy="22" r="14" fill="#F79E1B" opacity="0.92"/></svg>',
    amex: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="American Express"><rect x="8" y="6" width="104" height="32" rx="6" fill="#2E77BC"/><text x="60" y="28" font-family="Arial, sans-serif" font-size="14" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="1.5">AMEX</text></svg>',
    paypal: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PayPal"><text x="60" y="30" font-family="Verdana, Arial, sans-serif" font-size="18" font-weight="800" font-style="italic" text-anchor="middle"><tspan fill="#003087">Pay</tspan><tspan fill="#009CDE">Pal</tspan></text></svg>',
    applepay: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Apple Pay"><rect x="8" y="6" width="104" height="32" rx="6" fill="#000"/><text x="60" y="28" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#fff" text-anchor="middle">Apple Pay</text></svg>',
    googlepay: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Google Pay"><text x="60" y="29" font-family="Arial, sans-serif" font-size="16" font-weight="600" text-anchor="middle"><tspan fill="#4285F4">G</tspan><tspan fill="#5F6368">oogle Pay</tspan></text></svg>',
    bit: '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bit"><rect x="8" y="6" width="104" height="32" rx="6" fill="#111"/><text x="60" y="29" font-family="Arial Black, Arial, sans-serif" font-size="18" font-weight="900" fill="#00C6C2" text-anchor="middle">bit</text></svg>',
  };
  const accepted = String(business.accepted_payments || '').split(',').map((s) => s.trim()).filter(Boolean);
  const payments_html = accepted.length
    ? `<ul class="pays" aria-label="שיטות תשלום מקובלות">${accepted.map((k) => k === 'bank'
        ? `<li class="pay pay--bank">${esc(PAY_LABELS[k] || k)}</li>`
        : `<li class="pay pay--${esc(k)}" aria-label="${esc(PAY_LABELS[k] || k)}">${PAY_SVG[k] || esc(PAY_LABELS[k] || k)}</li>`).join('')}</ul>`
    : '';
  const map = {
    brand: esc(site.brand_name),
    brand_initial: esc([...site.brand_name.trim()][0] || 'E'),
    hero_headline: esc(site.hero_headline),
    hero_sub: esc(site.hero_sub),
    about_title: esc(site.about_title),
    about_html: paragraphs,
    skills_html: skills,
    portrait_html: portrait,
    availability_html: `<span class="avail avail--${avail[0]}"><i aria-hidden="true"></i>${esc(avail[1])}${business.availability_note ? ` <span class="avail__note">· ${esc(business.availability_note)}</span>` : ''}</span>`,
    privacy_contact_html: privacy,
    direct_contact_html: business.show_whatsapp_public && business.whatsapp
      ? ` מעדיפים צ'אט? <a href="https://wa.me/${esc(business.whatsapp)}" rel="noopener noreferrer">שלחו לי הודעה בוואטסאפ</a>.`
      : '',
    payments_html,
    year: String(new Date().getFullYear()),
  };
  return indexTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? '');
}

function serveFile(req, res, file, { cache = 'public, max-age=3600' } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : cache, 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (ext === '.mp4' || ext === '.webm')) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : stat.size - 1;
    if (!range[1] && range[2]) { start = Math.max(0, stat.size - Number(range[2])); end = stat.size - 1; }
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) { send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` }); return true; }
    res.writeHead(206, { ...SEC_HEADERS, ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...SEC_HEADERS, ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}

function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    const html = renderIndex();
    return send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  if (pathname === '/admin' || pathname === '/admin/') return serveFile(req, res, path.join(PUBLIC, 'admin', 'index.html'));
  if (pathname.startsWith('/media/')) {
    const name = pathname.slice(7);
    if (!/^[a-z0-9._-]+$/i.test(name)) return false;
    return serveFile(req, res, path.join(UPLOAD_DIR, name), { cache: 'public, max-age=86400' });
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  return serveFile(req, res, file);
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        if (routes.some((x) => x.re.test(url.pathname))) throw new HttpError(405, 'שיטה לא מורשית');
        throw new HttpError(404, 'לא נמצא');
      }
      return await r.handler(req, res, url, r.re.exec(url.pathname));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'שיטה לא מורשית');
    if (serveStatic(req, res, url.pathname)) return;
    const notFound = path.join(PUBLIC, '404.html');
    if (fs.existsSync(notFound)) return send(res, 404, fs.readFileSync(notFound), { 'Content-Type': MIME['.html'] });
    send(res, 404, 'לא נמצא', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...e.extra });
    console.error('[error]', req.method, url.pathname, e);
    json(res, 500, { error: 'משהו השתבש בשרת. שום דבר לא נשמר. נסו שוב.' });
  }
});

await bootstrapOwner();
rateCleanup();
setInterval(rateCleanup, 3600 * 1000).unref();
server.listen(PORT, () => console.log(`Site running on http://localhost:${PORT}  (dashboard: /admin)`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
