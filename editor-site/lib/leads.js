import { db, now, getSetting, tx } from './db.js';
import { DEFAULT_BUSINESS, DEFAULT_PRICING, DEFAULT_SCORING } from './defaults.js';
import { scoreLead } from './scoring.js';
import { estimate, leadToEstimateInput, profitability, projectPriority } from './pricing.js';

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export function rowToLead(r) {
  if (!r) return null;
  return {
    ...r,
    is_spam: !!r.is_spam,
    consent: !!r.consent,
    platforms: parse(r.platforms, []),
    flags: parse(r.flags, []),
    score_breakdown: parse(r.score_breakdown, []),
  };
}

export function loadContext() {
  return {
    pricing: getSetting('pricing', DEFAULT_PRICING),
    scoring: getSetting('scoring', DEFAULT_SCORING),
    business: getSetting('business', DEFAULT_BUSINESS),
  };
}

// Hours already committed to Accepted / Negotiating work (owner-entered estimates only).
export function committedHours(excludeId = 0) {
  return db.prepare("SELECT COALESCE(SUM(est_hours),0) AS h FROM leads WHERE status IN ('Accepted','Negotiating') AND is_spam = 0 AND id != ?").get(excludeId).h;
}

export function rescoreLead(id, ctx = loadContext()) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!row) return;
  const lead = rowToLead(row);
  const res = scoreLead(lead, { ...ctx, committedHours: committedHours(id) });
  db.prepare('UPDATE leads SET score = ?, score_category = ?, score_breakdown = ? WHERE id = ?').run(res.score, res.category, JSON.stringify(res.factors), id);
}

export function rescoreAll() {
  const ctx = loadContext();
  const ids = db.prepare('SELECT id FROM leads').all();
  tx(() => ids.forEach(({ id }) => rescoreLead(id, ctx)));
  return ids.length;
}

export function leadAnalysis(lead) {
  const ctx = loadContext();
  const est = estimate(leadToEstimateInput(lead), ctx.pricing);
  const prof = profitability(
    { revenue: lead.est_revenue, hours: lead.est_hours, costs: lead.est_costs },
    { weeklyCapacityHours: ctx.business.weekly_capacity_hours, committedHours: committedHours(lead.id), targetHourlyRate: ctx.business.target_hourly_rate },
  );
  return { estimate: est, profitability: prof, priority: projectPriority(lead.score_category, prof) };
}

const COLUMNS = [
  'id', 'created_at', 'status', 'is_spam', 'score', 'score_category', 'name', 'contact_method', 'contact_value', 'channel_url',
  'category', 'category_other', 'service', 'service_other', 'collab', 'videos_per_month', 'video_length', 'platforms', 'budget',
  'start_timing', 'raw_footage', 'style_ref', 'video_topic', 'thumb_refs', 'details', 'flags', 'notes', 'est_revenue', 'est_hours', 'est_costs',
];

function csvCell(v) {
  let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportCsv() {
  const rows = db.prepare('SELECT * FROM leads ORDER BY id').all().map(rowToLead);
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n');
}

export function exportJson() {
  return JSON.stringify({ exported_at: now(), leads: db.prepare('SELECT * FROM leads ORDER BY id').all().map(rowToLead) }, null, 2);
}
