// Spam / risk flagging. Severity levels:
//   spam  -> obvious abuse; lead is saved but auto-marked as spam (reviewable, never deleted)
//   warn  -> suspicious or duplicate; lead goes to "Needs Review"
//   info  -> informational only (e.g. incomplete); never treated as suspicious
// A small channel, low budget or missing optional fields are NEVER flagged.

import crypto from 'node:crypto';

const SPAM_WORDS =
  /\b(seo (services?|packages?)|backlinks?|guest post|rank (your )?(site|website)|crypto(currency)? (signal|invest)|forex|binary options|casino|viagra|cialis|payday loan|buy followers|buy (youtube )?views|cheap (likes|views|subscribers)|telegram signals|whatsapp me for|click here to claim|you have won|make \$?\d+ ?(k|,000)? (a|per) (day|week))\b/i;

export function signToken(secret, ts = Date.now()) {
  const mac = crypto.createHmac('sha256', secret).update(String(ts)).digest('hex').slice(0, 32);
  return `${ts}.${mac}`;
}

export function checkToken(secret, token) {
  if (typeof token !== 'string') return { valid: false };
  const [ts, mac] = token.split('.');
  if (!/^\d{10,15}$/.test(ts || '') || !mac) return { valid: false };
  const expect = crypto.createHmac('sha256', secret).update(ts).digest('hex').slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };
  return { valid: true, ageMs: Date.now() - Number(ts) };
}

export function hashIp(secret, ip) {
  return crypto.createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 24);
}

const countLinks = (s) => (s?.match(/https?:\/\/|www\./gi) || []).length;

export function analyze({ lead, honeypot, token, duplicates }) {
  const flags = [];
  const flag = (code, severity, label) => flags.push({ code, severity, label });

  if (honeypot) flag('honeypot', 'spam', 'שדת מלכוד מוסתר מולא (בוט)');

  if (!token.valid) flag('no_token', 'warn', 'אסימון הטופס חסר או לא תקין (הטופס לא נטען באופן רגיל)');
  else if (token.ageMs < 2500) flag('too_fast', 'warn', 'נשלח מהר בצורה חריגה (פחות מ-3 שניות)');

  const text = [lead.details, lead.thumb_refs, lead.style_ref, lead.video_topic, lead.service_other, lead.name].filter(Boolean).join(' \n ');
  const links = countLinks(lead.details) + countLinks(lead.thumb_refs) + countLinks(lead.service_other);
  const hasSpamWords = SPAM_WORDS.test(text);
  if (hasSpamWords) flag('spam_keywords', links >= 1 ? 'spam' : 'warn', 'מכיל ניסוח אופייני לספאם');
  if (links > 3) flag('many_links', 'warn', `ההודעה מכילה ${links} קישורים`);
  if (/https?:\/\/|www\./i.test(lead.name)) flag('name_is_url', 'warn', 'שדה השם מכיל קישור');
  if (/(.)\1{9,}/.test(text)) flag('repeated_chars', 'warn', 'רצפים ארוכים של תווים חוזרים');

  if (duplicates.sameContact) flag('duplicate_contact', 'warn', 'אותו פרט קשר נשלח לאחרונה');
  if (duplicates.sameChannel) flag('duplicate_channel', 'warn', 'אותו קישור לערוץ נשלח לאחרונה');

  const missing = [];
  if (!lead.details) missing.push('message');
  if (!lead.budget) missing.push('budget');
  if (!lead.videos_per_month) missing.push('frequency');
  if (missing.length >= 3) flag('incomplete', 'info', 'פרטים אופציונליים הושארו ריקים (לא בעיה)');

  return {
    flags,
    isSpam: flags.some((f) => f.severity === 'spam'),
    suspicious: flags.some((f) => f.severity === 'warn'),
  };
}
