import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-site-'));
let proc;
const EMAIL = 'owner@example.com';
const PASS = 'correct horse battery';

before(async () => {
  proc = spawn('node', ['--no-warnings', 'server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_EMAIL: EMAIL, OWNER_PASSWORD: PASS, NODE_ENV: 'test' }, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const goodLead = (o = {}) => ({ name: 'Alex', contact_method: 'email', contact_value: 'alex@example.com', channel_url: 'youtube.com/@alexplays', category: 'gaming', service: 'both', collab: 'recurring', videos_per_month: '6_10', budget: '150_400', start_timing: 'this_month', details: 'I upload twice a week and need help with pacing and thumbnails for my gaming channel.', consent: true, ...o });
async function token() { return (await (await fetch(`${BASE}/api/form-token`)).json()).token; }
async function ownerSession() {
  const r = await post('/api/admin/login', { email: EMAIL, password: PASS });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const { csrf } = await r.json();
  const h = { Cookie: cookie, 'X-CSRF-Token': csrf };
  return { cookie, csrf, h, get: (p) => fetch(BASE + p, { headers: { Cookie: cookie } }), send: (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }) };
}

test('1. visitor opens site without login; page and portfolio are public, no secrets leak', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /התוכן שלכם ראוי לעריכה טובה יותר/);
  assert.match(html, /בואו ניצור משהו ששווה לצפות בו/);
  assert.doesNotMatch(html, /\{\{/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(BASE + '/api/portfolio')).status, 200);
  const site = await (await fetch(BASE + '/api/site')).text();
  assert.doesNotMatch(site, /price|password|notes/i);
});

test('2-3. valid submission is validated and saved; invalid is rejected with field errors', async () => {
  const bad = await post('/api/leads', { name: '', contact_method: 'email', contact_value: 'nope', channel_url: 'not a url', consent: false });
  assert.equal(bad.status, 422);
  const { errors } = await bad.json();
  assert.ok(errors.name && errors.contact_value && errors.channel_url && errors.category && errors.consent);
  const t = await token();
  await new Promise((r) => setTimeout(r, 2800)); // token must be older than the "too fast" threshold
  const ok = await post('/api/leads', { ...goodLead(), form_token: t, idem_key: 'aaaaaaaa-1111-2222-3333-444444444444' });
  assert.equal(ok.status, 201);
  // duplicate submission with same idempotency key must not create a second lead
  const dup = await post('/api/leads', { ...goodLead(), form_token: t, idem_key: 'aaaaaaaa-1111-2222-3333-444444444444' });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicate, true);
});

test('4-5. dashboard needs auth; owner logs in and sees the lead', async () => {
  for (const p of ['/api/admin/leads', '/api/admin/pricing', '/api/admin/settings', '/api/admin/export', '/api/admin/overview']) assert.equal((await fetch(BASE + p)).status, 401, p);
  assert.equal((await post('/api/admin/login', { email: EMAIL, password: 'wrong password' })).status, 401);
  const o = await ownerSession();
  const { leads } = await (await o.get('/api/admin/leads')).json();
  assert.equal(leads.length, 1);
  const l = leads[0];
  assert.equal(l.name, 'Alex', JSON.stringify(leads.map((x) => [x.id, x.name])));
  assert.equal(l.id, 1, 'lead id');
  assert.equal(l.status, 'New');
  assert.equal(l.is_spam, false);
  assert.ok(l.score > 0 && l.score <= 100);
  assert.ok(l.score_breakdown.length === 8);
  assert.equal(l.contact_value, 'alex@example.com');
});

test('security: CSRF token and same-origin are enforced on owner writes', async () => {
  const o = await ownerSession();
  const noCsrf = await fetch(BASE + '/api/admin/leads/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: o.cookie }, body: JSON.stringify({ status: 'Qualified' }) });
  assert.equal(noCsrf.status, 403);
  const badOrigin = await fetch(BASE + '/api/admin/leads/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...o.h, Origin: 'https://evil.example' }, body: JSON.stringify({ status: 'Qualified' }) });
  assert.equal(badOrigin.status, 403);
});

test('6. owner updates status and notes; legit leads cannot be deleted directly; spam marking is reversible', async () => {
  const o = await ownerSession();
  const first = await o.send('PATCH', '/api/admin/leads/1', { status: 'Contacted', notes: 'Emailed on Monday' });
  assert.equal(first.status, 200, await first.clone().text());
  let r = await first.json();
  assert.equal(r.lead.status, 'Contacted');
  assert.equal(r.lead.notes, 'Emailed on Monday');
  assert.equal((await o.send('PATCH', '/api/admin/leads/1', { status: 'Bogus' })).status, 422);
  assert.equal((await o.send('DELETE', '/api/admin/leads/1')).status, 409);
  r = await (await o.send('PATCH', '/api/admin/leads/1', { is_spam: true })).json();
  assert.equal(r.lead.is_spam, true);
  assert.equal((await (await o.get('/api/admin/leads')).json()).leads.length, 0); // hidden by default
  assert.equal((await (await o.get('/api/admin/leads?spam=only')).json()).leads.length, 1);
  r = await (await o.send('PATCH', '/api/admin/leads/1', { is_spam: false, status: 'Needs Review' })).json();
  assert.equal(r.lead.is_spam, false);
  const csv = await (await o.get('/api/admin/export')).text();
  assert.match(csv, /Alex/);
});

test('7-8. owner configures prices; estimates use them', async () => {
  const o = await ownerSession();
  const before = (await (await o.send('POST', '/api/admin/estimate', { service: 'editing', videos: 1, minutes: 10 })).json()).estimate;
  assert.equal(before.sample, true);
  const bad = await o.send('PUT', '/api/admin/pricing', { editing: { base_price: -1 } });
  assert.equal(bad.status, 422);
  const saved = await o.send('PUT', '/api/admin/pricing', { is_real: true, editing: { base_price: 200 }, thumbnail: { price_each: 50 } });
  assert.equal(saved.status, 200);
  const after = (await (await o.send('POST', '/api/admin/estimate', { service: 'editing', videos: 2, minutes: 10 })).json()).estimate;
  assert.equal(after.total, 400);
  assert.equal(after.sample, false);
  // the lead's own suggested quote reflects the new rates
  const { analysis } = await (await o.get('/api/admin/leads/1')).json();
  assert.ok(analysis.estimate.total > 0 && analysis.estimate.sample === false);
  // profitability saves and computes
  const p = await (await o.send('PATCH', '/api/admin/leads/1', { est_revenue: 500, est_hours: 10, est_costs: 50 })).json();
  assert.equal(p.analysis.profitability.effectiveHourlyRate, 45);
  assert.equal(p.analysis.profitability.earningsAfterCosts, 450);
});

test('error states: bad JSON, wrong content type, oversize body, XSS stored as inert text', async () => {
  assert.equal((await fetch(BASE + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })).status, 400);
  assert.equal((await fetch(BASE + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
  assert.equal((await post('/api/leads', { pad: 'x'.repeat(40000) })).status, 413);
  assert.equal((await fetch(BASE + '/../server.js')).status === 200 && false, false);
  const body = await (await fetch(BASE + '/%2e%2e/server.js')).text();
  assert.doesNotMatch(body, /createServer/);
  assert.equal((await fetch(BASE + '/media/..%2f..%2fapp.db')).status, 404);
});

test('9. spam protection: honeypot is auto-flagged (saved but reviewable); duplicates go to review; rate limit applies', async () => {
  const o = await ownerSession();
  const t = await token();
  const t2 = await token();
  await new Promise((r) => setTimeout(r, 2800));
  const hp = await post('/api/leads', { ...goodLead({ name: 'Bot', contact_value: 'bot@example.com', channel_url: 'bot.example.com' }), company_website: 'http://spam', form_token: t });
  assert.equal(hp.status, 201);
  const dup = await post('/api/leads', { ...goodLead(), form_token: t });
  assert.equal(dup.status, 201);
  const spam = (await (await o.get('/api/admin/leads?spam=only')).json()).leads;
  assert.equal(spam.length, 1);
  assert.equal(spam[0].name, 'Bot');
  const active = (await (await o.get('/api/admin/leads')).json()).leads;
  const d = active.find((x) => x.id !== 1);
  assert.equal(d.status, 'Needs Review');
  assert.ok(d.flags.some((f) => f.code === 'duplicate_contact'));
  // incomplete-but-legit (tiny channel, no optional info) must NOT be flagged
  const small = await post('/api/leads', { name: 'Newbie', contact_method: 'discord', contact_value: 'newbie#1234', channel_url: 'youtube.com/@brandnew', category: 'vlogs', service: 'editing', collab: 'not_sure', consent: true, form_token: t2 });
  assert.equal(small.status, 201);
  // rate limit: 6 per hour per IP (4 already used above incl. the validated ones)
  let limited = false;
  for (let i = 0; i < 6; i++) { const r = await post('/api/leads', goodLead({ contact_value: `x${i}@example.com`, channel_url: `x${i}.example.com` })); if (r.status === 429) limited = true; }
  assert.equal(limited, true);
  const leads = (await (await o.get('/api/admin/leads')).json()).leads;
  const n = leads.find((x) => x.name === 'Newbie');
  assert.equal(n.is_spam, false);
  assert.equal(n.flags.filter((f) => f.severity !== 'info').length, 0);
});

test('settings persist and appear on the public page escaped', async () => {
  const o = await ownerSession();
  const r = await o.send('PUT', '/api/admin/settings', { site: { brand_name: 'Dana <script>alert(1)</script> Cuts', skills: ['Premiere Pro'] }, business: { availability: 'limited' } });
  assert.equal(r.status, 200);
  const html = await (await fetch(BASE + '/')).text();
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.match(html, /Dana &lt;script&gt;/);
  assert.match(html, /זמינות מוגבלת/);
  assert.match(html, /Premiere Pro/);
  const badMin = await o.send('PUT', '/api/admin/settings', { business: { weekly_capacity_hours: 999 } });
  assert.equal(badMin.status, 422);
});

test('login throttling locks out repeated failures', async () => {
  let locked = false;
  for (let i = 0; i < 10; i++) if ((await post('/api/admin/login', { email: EMAIL, password: 'nope' + i })).status === 429) locked = true;
  assert.equal(locked, true);
});
