import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, profitability, normalizePricing } from '../lib/pricing.js';
import { scoreLead } from '../lib/scoring.js';
import { validateLead, normalizeUrl } from '../lib/validate.js';
import { analyze } from '../lib/spam.js';
import { DEFAULT_PRICING, DEFAULT_SCORING, DEFAULT_BUSINESS } from '../lib/defaults.js';

const P = { ...structuredClone(DEFAULT_PRICING), is_real: true };

test('estimate: base editing price, complexity and extra minutes', () => {
  const e = estimate({ service: 'editing', videos: 2, minutes: 15 }, P);
  // (100 + 5*6) * 2 = 260
  assert.equal(e.total, 260);
  assert.equal(e.needsManualReview, false);
  assert.equal(e.sample, false);
  const adv = estimate({ service: 'editing', videos: 1, minutes: 10, complexity: 'advanced' }, P);
  assert.equal(adv.total, 140);
});

test('estimate: bundle discount, rush, recurring discount', () => {
  const e = estimate({ service: 'both', videos: 4, minutes: 10, thumbnails: 4, rush: true, recurring: true }, P);
  // editing 400 + thumbs 120 = 520; bundle -10% = 468; rush +30% of 468 = 140.4 => 608.4; recurring -10% => 547.56
  assert.equal(e.total, 547.56);
});

test('estimate: quote mode and long videos need manual review; sample prices labelled', () => {
  const q = estimate({ service: 'editing', videos: 1, minutes: 20 }, { ...P, editing: { ...P.editing, mode: 'quote' } });
  assert.equal(q.total, null);
  assert.equal(q.needsManualReview, true);
  const long = estimate({ service: 'editing', videos: 1, minutes: 90 }, P);
  assert.equal(long.needsManualReview, true);
  assert.equal(estimate({ service: 'editing', videos: 1, minutes: 10 }, DEFAULT_PRICING).sample, true);
});

test('profitability: transparent formula', () => {
  const p = profitability({ revenue: 300, hours: 5, costs: 50 }, { weeklyCapacityHours: 10, committedHours: 40, targetHourlyRate: 40 });
  assert.equal(p.earningsAfterCosts, 250);
  assert.equal(p.effectiveHourlyRate, 50);
  assert.equal(p.capacity.fits, false); // 45h > 43.3h
});

test('normalizePricing rejects bad input', () => {
  assert.throws(() => normalizePricing({ editing: { base_price: -5 } }, P), (e) => !!e.errors['editing.base_price']);
  assert.throws(() => normalizePricing({ currency: 'dollars' }, P), (e) => !!e.errors.currency);
  assert.equal(normalizePricing({ editing: { base_price: 55 } }, P).editing.base_price, 55);
});

const baseLead = { channel_url: 'https://www.youtube.com/@x', service: 'editing', collab: 'recurring', videos_per_month: '6_10', budget: null, start_timing: null, details: null, platforms: [], video_length: '10_20' };
const ctx = { pricing: P, scoring: DEFAULT_SCORING, business: DEFAULT_BUSINESS, committedHours: 0 };

test('scoring: 0-100, missing optional info is neutral not punished, tiny budget lowers budget factor only', () => {
  const s = scoreLead(baseLead, ctx);
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(s.factors.find((f) => f.key === 'budget').earned, 7.5); // neutral 0.5 * 15
  const low = scoreLead({ ...baseLead, budget: 'under_50' }, ctx);
  assert.ok(low.score < s.score);
  assert.ok(scoreLead({ ...baseLead, collab: 'recurring', budget: '1000_plus', details: 'x'.repeat(100) }, ctx).score > s.score);
});

test('validation: required fields, URL/email checks, conditional field stripping', () => {
  const bad = validateLead({});
  assert.equal(bad.ok, false);
  for (const k of ['name', 'contact_method', 'contact_value', 'channel_url', 'category', 'service', 'collab', 'consent']) assert.ok(bad.errors[k], k);
  const good = validateLead({ name: 'Sam', contact_method: 'email', contact_value: 'SAM@Example.com', channel_url: 'youtube.com/@sam', category: 'gaming', service: 'thumbnail', collab: 'one_time', payment_method: 'card', budget: '150_400', start_timing: 'two_weeks', consent: true, video_length: '5_10', video_topic: 'Topic' });
  assert.equal(good.ok, true);
  assert.equal(good.value.contact_value, 'sam@example.com');
  assert.equal(good.value.channel_url, 'https://youtube.com/@sam');
  assert.equal(good.value.video_length, null); // editing-only field dropped for thumbnail requests
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('http://localhost/x'), null);
  assert.equal(normalizeUrl('http://127.0.0.1/x'), null);
  assert.equal(normalizeUrl('https://user:pw@evil.com'), null);
  assert.equal(validateLead({ ...{ name: 'a', contact_method: 'email', contact_value: 'nope', channel_url: 'x.com/a', category: 'gaming', service: 'editing', collab: 'one_time', consent: true } }).errors.contact_value.length > 0, true);
});

test('spam: small channel / missing optional fields are never suspicious; honeypot is spam', () => {
  const lead = { name: 'Sam', details: null, budget: null, videos_per_month: null };
  const ok = analyze({ lead, honeypot: '', token: { valid: true, ageMs: 9000 }, duplicates: {} });
  assert.equal(ok.isSpam, false);
  assert.equal(ok.suspicious, false);
  assert.ok(ok.flags.every((f) => f.severity === 'info'));
  assert.equal(analyze({ lead, honeypot: 'x', token: { valid: true, ageMs: 9000 }, duplicates: {} }).isSpam, true);
  const dup = analyze({ lead, honeypot: '', token: { valid: true, ageMs: 9000 }, duplicates: { sameContact: true } });
  assert.equal(dup.suspicious, true);
  assert.equal(dup.isSpam, false);
});
