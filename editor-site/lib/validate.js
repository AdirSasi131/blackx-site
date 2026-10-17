// Server-side validation for the public intake form. Never trust the browser.

export const OPTIONS = {
  contact_method: ['email', 'whatsapp', 'discord', 'telegram', 'instagram', 'other'],
  category: ['gaming', 'commentary', 'education', 'vlogs', 'entertainment', 'tech', 'other'],
  service: ['editing', 'thumbnail', 'both', 'other'],
  collab: ['one_time', 'recurring', 'not_sure'],
  payment_method: ['card', 'paypal', 'bit', 'bank', 'not_sure'],
  videos_per_month: ['1_2', '3_5', '6_10', '10_plus'],
  video_length: ['shorts', 'under_5', '5_10', '10_20', '20_40', '40_plus'],
  platforms: ['youtube', 'shorts', 'tiktok', 'instagram', 'twitch', 'podcast', 'other'],
  budget: ['under_50', '50_150', '150_400', '400_1000', '1000_plus', 'not_sure'],
  start_timing: ['asap', 'two_weeks', 'this_month', 'flexible'],
  raw_footage: ['ready', 'partial', 'not_yet'],
};

const clean = (v, max) =>
  typeof v === 'string'
    ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max)
    : '';

export function normalizeUrl(raw) {
  let s = clean(raw, 300);
  if (!s) return null;
  if (/^@[A-Za-z0-9._-]{2,50}$/.test(s)) s = `https://www.youtube.com/${s}`; // bare YouTube @handle
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !host.includes('xn--')) return null;
  return u.toString();
}

function validContact(method, value) {
  const v = value.trim();
  switch (method) {
    case 'email':
      return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(v) && v.length <= 120 ? v.toLowerCase() : null;
    case 'whatsapp': {
      const digits = v.replace(/[\s().-]/g, '');
      return /^\+?\d{7,15}$/.test(digits) ? digits : null;
    }
    default:
      return v.length >= 3 && v.length <= 100 && !/[<>]/.test(v) ? v : null;
  }
}

export function validateLead(body) {
  const errors = {};
  const out = {};
  const b = body && typeof body === 'object' ? body : {};
  const oneOf = (key, required) => {
    const v = clean(b[key], 40);
    if (!v) { if (required) errors[key] = 'נא לבחור אפשרות.'; return null; }
    if (!OPTIONS[key].includes(v)) { errors[key] = 'אפשרות לא תקינה.'; return null; }
    return v;
  };

  out.name = clean(b.name, 100);
  if (out.name.length < 1) errors.name = 'ספרו לי איך לקרוא לכם.';

  out.contact_method = oneOf('contact_method', true);
  const cv = clean(b.contact_value, 120);
  if (!cv) errors.contact_value = 'נא להזין פרטי קשר.';
  else if (out.contact_method) {
    const ok = validContact(out.contact_method, cv);
    if (!ok) errors.contact_value = { email: 'נא להזין כתובת אימייל תקינה.', whatsapp: 'נא להזין מספר טלפון תקין, כולל קידומת מדינה.' }[out.contact_method] || 'נא להזין את שם המשתמש שלכם.';
    else out.contact_value = ok;
  }

  const url = normalizeUrl(b.channel_url);
  if (!clean(b.channel_url, 300)) errors.channel_url = 'נא להוסיף קישור לערוץ או לפרופיל שלכם.';
  else if (!url) errors.channel_url = 'זה לא נראה כמו קישור תקין (לדוגמה: youtube.com/@yourchannel).';
  else out.channel_url = url;

  out.category = oneOf('category', true);
  out.category_other = out.category === 'other' ? clean(b.category_other, 80) || null : null;
  out.service = oneOf('service', true);
  out.service_other = null;
  if (out.service === 'other') {
    out.service_other = clean(b.service_other, 200);
    if (out.service_other.length < 5) errors.service_other = 'נא לתאר במילים ספורות מה אתם צריכים.';
  }
  out.collab = oneOf('collab', true);
  out.payment_method = oneOf('payment_method', true);

  out.videos_per_month = oneOf('videos_per_month', false);
  out.video_length = oneOf('video_length', false);
  out.budget = oneOf('budget', true);
  out.start_timing = oneOf('start_timing', true);
  out.raw_footage = oneOf('raw_footage', false);

  const plats = Array.isArray(b.platforms) ? b.platforms.slice(0, 10).map((p) => clean(p, 20)) : [];
  if (plats.some((p) => !OPTIONS.platforms.includes(p))) errors.platforms = 'אפשרות לא תקינה.';
  out.platforms = [...new Set(plats)];

  out.style_ref = clean(b.style_ref, 300) || null;
  out.video_topic = clean(b.video_topic, 200) || null;
  out.thumb_refs = clean(b.thumb_refs, 500) || null;
  out.details = clean(b.details, 2000) || null;

  if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') errors.consent = 'נא לאשר כדי שאוכל ליצור איתכם קשר בנוגע לפנייה.';
  out.consent = 1;

  // Only keep conditional fields that match the chosen service
  if (out.service === 'thumbnail') { out.video_length = null; out.raw_footage = null; }
  if (out.service === 'editing') { out.video_topic = null; out.thumb_refs = null; }

  return { ok: Object.keys(errors).length === 0, errors, value: out };
}
