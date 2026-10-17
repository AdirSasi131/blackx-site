// Transparent, configurable lead scoring. Pure functions.
// The score is a prioritisation aid only. It never rejects anyone and says nothing about spam.
// Missing OPTIONAL information gets a neutral score rather than a penalty-as-suspicion.

import { estimate, leadToEstimateInput } from './pricing.js';

export const BUDGET_MAX = { under_50: 50, '50_150': 150, '150_400': 400, '400_1000': 1000, '1000_plus': Infinity };
export const BUDGET_LABELS = {
  under_50: 'מתחת ל-50', '50_150': '50 – 150', '150_400': '150 – 400', '400_1000': '400 – 1,000', '1000_plus': '1,000+', not_sure: 'עוד לא בטוח',
};

const KNOWN_HOSTS = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|tiktok\.com|instagram\.com|kick\.com|facebook\.com|x\.com|twitter\.com|vimeo\.com|rumble\.com)$/i;

const FREQ = { '10_plus': 1, '6_10': 0.85, '3_5': 0.65, '1_2': 0.4 };
const TIMING = { two_weeks: 1, this_month: 1, flexible: 0.8, asap: 0.7 };

export function scoreLead(lead, ctx) {
  const w = ctx.scoring.weights;
  const SVC = { editing: 'עריכת וידאו', thumbnail: 'עיצוב תמונות ממוזערות', both: 'עריכה + תמונות ממוזערות', other: 'אחר' };
  const factors = [];
  const add = (key, label, frac, note) => {
    const max = Math.max(0, Number(w[key]) || 0);
    factors.push({ key, label, max, earned: Math.round(max * frac * 10) / 10, note });
  };

  // 1. Channel link (validated server-side already)
  let host = '';
  try { host = new URL(lead.channel_url).hostname; } catch {}
  const known = KNOWN_HOSTS.test(host);
  add('channel', 'קישור לערוץ / לפרופיל', known ? 1 : 0.7, known ? 'קישור תקין לפלטפורמה מוכרת' : 'קישור תקין (פלטפורמה לא מוכרת)');

  // 2. Service clarity
  if (lead.service === 'other') add('service', 'השירות מוגדר בבירור', lead.service_other ? 0.55 : 0.35, 'התבקש “אחר”: בדקו את התיאור');
  else add('service', 'השירות מוגדר בבירור', 1, `בקשה ברורה: ${SVC[lead.service] || lead.service}`);

  // 3. Publishing frequency
  const f = FREQ[lead.videos_per_month];
  add('frequency', 'תדירות פרסום', f ?? 0.5, f ? `בערך ${lead.videos_per_month.replace('_', '–').replace('–plus', '+')} סרטונים בחודש` : 'לא צוין (ניטרלי)');

  // 4. Recurring interest
  const rec = { recurring: [1, 'מעוניין בעבודה שוטפת'], not_sure: [0.55, 'פתוח לעבודה שוטפת (עוד לא בטוח)'], one_time: [0.4, 'פרויקט חד-פעמי'] }[lead.collab] || [0.5, ''];
  add('recurring', 'פוטנציאל לטווח ארוך', rec[0], rec[1]);

  // 5. Budget compatibility with the owner's configured rates
  const est = estimate(leadToEstimateInput(lead), ctx.pricing);
  let budgetFrac = 0.5;
  let budgetNote = 'תקציב לא צוין (ניטרלי)';
  const max = BUDGET_MAX[lead.budget];
  if (max !== undefined) {
    if (est.total == null) {
      budgetFrac = 0.6;
      budgetNote = 'צוין תקציב, אך הבקשה הזו דורשת הצעת מחיר ידנית';
    } else if (max === Infinity || max >= est.total * 0.9) {
      budgetFrac = 1; budgetNote = 'התקציב נראה תואם לתעריפים שלכם';
    } else if (max >= est.total * 0.6) {
      budgetFrac = 0.65; budgetNote = 'התקציב נמוך במעט מההערכה שלכם';
    } else if (max >= est.total * 0.35) {
      budgetFrac = 0.3; budgetNote = 'התקציב נמוך בהרבה מההערכה שלכם';
    } else {
      budgetFrac = 0; budgetNote = 'התקציב נמוך במידה רבה מההערכה שלכם';
    }
    if (est.sample) budgetNote += ' (מבוסס על מחירי דוגמה)';
  } else if (lead.budget === 'not_sure') budgetNote = 'תקציב לא הוגדר (ניטרלי)';
  add('budget', 'התאמת תקציב', budgetFrac, budgetNote);

  // 6. Start timing
  const t = TIMING[lead.start_timing];
  add('timing', 'תאריך התחלה מציאותי', t ?? 0.5, t ? { asap: 'מעוניין להתחיל בהקדם', two_weeks: 'התחלה תוך כ-2 שבועות', this_month: 'התחלה החודש', flexible: 'תאריך התחלה גמיש' }[lead.start_timing] : 'לא צוין (ניטרלי)');

  // 7. Useful detail
  const len = (lead.details || '').trim().length;
  let d = len >= 80 ? 0.7 : len >= 20 ? 0.45 : 0.2;
  if (lead.style_ref) d += 0.1;
  if (lead.video_topic || lead.thumb_refs) d += 0.1;
  if (lead.platforms?.length) d += 0.1;
  add('details', 'פרטי פרויקט שימושיים', Math.min(1, d), len >= 80 ? 'הודעה מפורטת' : len >= 20 ? 'סופקו כמה פרטים' : 'מעט פרטים נוספים (אופציונלי)');

  // 8. Capacity
  let capFrac = 0.6;
  let capNote = 'דורש הערכת שעות ידנית';
  if (est.hours != null && ctx.business.weekly_capacity_hours > 0) {
    const monthly = ctx.business.weekly_capacity_hours * 4.33;
    const after = ctx.committedHours + est.hours;
    if (after <= monthly) { capFrac = 1; capNote = `~${est.hours} שעות מתאימות לקיבולת החודשית שלכם`; }
    else if (after <= monthly * 1.25) { capFrac = 0.5; capNote = `~${est.hours} שעות ימתחו את הקיבולת שלכם`; }
    else { capFrac = 0; capNote = `~${est.hours} שעות יחרוגו מהקיבולת שלכם`; }
  }
  add('capacity', 'התאמה לקיבולת', capFrac, capNote);

  const totalMax = factors.reduce((s, x) => s + x.max, 0);
  const earned = factors.reduce((s, x) => s + x.earned, 0);
  const score = totalMax > 0 ? Math.round((earned / totalMax) * 100) : 0;
  const th = ctx.scoring.thresholds;
  const category = score >= th.high ? 'High priority' : score >= th.review ? 'Needs review' : 'Low priority';
  return { score, category, factors, estimate: { total: est.total, hours: est.hours, sample: est.sample } };
}

export function normalizeScoring(input, base) {
  const errors = {};
  const out = structuredClone(base);
  for (const k of Object.keys(base.weights)) {
    if (input.weights?.[k] === undefined) continue;
    const v = Number(input.weights[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100) errors[`weights.${k}`] = '0 – 100';
    else out.weights[k] = Math.round(v);
  }
  for (const k of ['high', 'review']) {
    if (input.thresholds?.[k] === undefined) continue;
    const v = Number(input.thresholds[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100) errors[`thresholds.${k}`] = '0 – 100';
    else out.thresholds[k] = Math.round(v);
  }
  if (out.thresholds.review > out.thresholds.high) errors['thresholds.review'] = 'אסור שהוא עובר את סף העדיפות הגבוהה.';
  if (Object.values(out.weights).every((v) => v === 0)) errors.weights = 'לפחות משקל אחד חייב להיות גבוה מ-0.';
  if (Object.keys(errors).length) throw Object.assign(new Error('הגדרות ניקוד לא תקינות'), { errors });
  return out;
}
