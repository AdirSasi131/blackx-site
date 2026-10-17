const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
// Safe DOM builder: dynamic text always goes through text nodes, never innerHTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const state = { csrf: null, tab: 'leads', overview: null, filters: { spam: 'hide', status: '', service: '', priority: '', q: '', sort: 'date', dir: 'desc' }, openLead: null };
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf || '';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (raw) return res;
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && path !== '/api/admin/login') { state.csrf = null; boot(); throw Object.assign(new Error('התנתקתם'), { handled: true }); }
  if (!res.ok) throw Object.assign(new Error(data.error || `בקשה נכשלה (${res.status})`), { status: res.status, errors: data.errors });
  return data;
}
function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast toast--${kind}` }, msg);
  $('#toast').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 2800);
}
const fail = (e) => { if (!e.handled) toast(e.message || 'משהו השתבש', 'bad'); };
const fmtDate = (iso) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
const fmtShort = (iso) => {
  const d = new Date(iso); const diff = (Date.now() - d) / 36e5;
  if (diff < 1) return `לפני ${Math.max(1, Math.round(diff * 60))} דקות`;
  if (diff < 24) return `לפני ${Math.round(diff)} שעות`;
  return d.toLocaleDateString('he-IL', { month: 'short', day: 'numeric' });
};
const money = (n, cur = 'USD') => (n == null ? '–' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n));
const L = {
  service: { editing: 'עריכת וידאו', thumbnail: 'תמונות ממוזערות', both: 'עריכה + תמונות ממוזערות', other: 'אחר' },
  collab: { one_time: 'פרויקט חד-פעמי', recurring: 'עבודה שוטפת', not_sure: 'עוד לא בטוח' },
  vpm: { '1_2': '1–2 בחודש', '3_5': '3–5 בחודש', '6_10': '6–10 בחודש', '10_plus': '10+ בחודש' },
  len: { shorts: 'קצר (תחת לדקה)', under_5: 'עד 5 דקות', '5_10': '5–10 דקות', '10_20': '10–20 דקות', '20_40': '20–40 דקות', '40_plus': '40+ דקות' },
  budget: { under_50: 'מתחת ל-50', '50_150': '50 – 150', '150_400': '150 – 400', '400_1000': '400 – 1,000', '1000_plus': '1,000+', not_sure: 'עוד לא בטוח' },
  timing: { asap: 'בהקדם האפשרי', two_weeks: 'תוך שבועיים', this_month: 'החודש', flexible: 'גמיש' },
  raw: { ready: 'מוכן לשליחה', partial: 'הוקלט חלקית', not_yet: 'עוד לא הוקלט' },
  pay: { card: 'כרטיס אשראי', paypal: 'PayPal', bit: 'Bit', bank: 'העברה בנקאית', not_sure: 'עוד לא בטוח' },
};
const STATUS_LABEL = { New: 'חדש', 'Needs Review': 'דורש בדיקה', Qualified: 'מתאים', Negotiating: 'במשא ומתן', Accepted: 'התקבל', Rejected: 'נדחה', Archived: 'בארכיון' };
const SCORE_LABEL = { 'High priority': 'עדיפות גבוהה', 'Needs review': 'דורש בדיקה', 'Low priority': 'עדיפות נמוכה' };
const PRIORITY_LABEL = { High: 'גבוה', Medium: 'בינוני', Low: 'נמוך' };
const CONTACT_LABEL = { email: 'אימייל', whatsapp: 'וואטסאפ', discord: 'דיסקורד', telegram: 'טלגרם', instagram: 'אינסטגרם', other: 'אחר' };
const CATEGORY_LABEL = { gaming: 'גיימינג', commentary: 'פרשנות', education: 'חינוך', vlogs: 'ולוגים', entertainment: 'בידור', tech: 'טכנולוגיה', other: 'אחר' };
const PLATFORM_LABEL = { youtube: 'יוטיוב', shorts: 'שורטס', tiktok: 'טיקטוק', instagram: 'אינסטגרם', twitch: 'טוויץ', podcast: 'פודקאסט', other: 'אחר' };
const KIND_LABEL = { video: 'סרטון', short: 'קצר', thumbnail: 'תמונה ממוזערת', before_after: 'לפני ואחרי' };
const SEV_LABEL = { spam: 'ספאם', warn: 'אזהרה', info: 'מידע' };
const CX = { simple: 'פשוט', standard: 'סטנדרטי', advanced: 'מתקדם' };
const statusPill = (s) => h('span', { class: `pill ${s === 'New' ? 'pill--new' : ['Qualified', 'Accepted'].includes(s) ? 'pill--good' : ['Rejected', 'Archived'].includes(s) ? 'pill--bad' : s === 'Needs Review' ? 'pill--warn' : 'pill--info'}` }, STATUS_LABEL[s] || s);
const scoreCls = (c) => (c === 'High priority' ? 'score--high' : c === 'Needs review' ? 'score--review' : 'score--low');
async function copy(text, label = 'הועתק') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text); document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(label); } catch { toast('ההעתקה נכשלה. סמנו את הטקסט ידנית.', 'bad'); }
    ta.remove();
  }
}
function field(label, input, { hint, err } = {}) {
  return h('label', { class: 'f' }, h('span', { class: 'f__l' }, label), input, hint ? h('span', { class: 'f__h' }, hint) : null, h('span', { class: 'f__e', 'data-err': err || '' }));
}
function showFieldErrors(root, errors = {}) {
  root.querySelectorAll('.f__e').forEach((e) => (e.textContent = ''));
  for (const [k, v] of Object.entries(errors)) {
    const el = root.querySelector(`[data-name="${k}"]`)?.closest('.f')?.querySelector('.f__e');
    if (el) el.textContent = v;
  }
}
const num = (el) => (el.value === '' ? null : Number(el.value));
/* ======================================================= auth */
function authScreen(setup) {
  const err = h('p', { class: 'alert alert--bad', hidden: true, role: 'alert' });
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minlength: setup ? 10 : 1 });
  const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, setup ? 'צור חשבון בעל אתר' : 'התחברות');
  const form = h('form', { class: 'auth__card', onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try {
      const r = await api(setup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: setup ? { email: email.value, password: pw.value, code: code.value } : { email: email.value, password: pw.value } });
      state.csrf = r.csrf; boot();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; pw.value = ''; }
  } },
  h('span', { class: 'brandmark', 'aria-hidden': 'true' }, '▶'),
  h('h1', null, setup ? 'הגדרת לוח הבקרה הראשונית' : 'התחברות בעל האתר'),
  h('p', { class: 'muted' }, setup ? 'צרו את חשבון הבעל היחיד. השתמשו בקוד ההגדרה החד-פעמי המודפס ביומן השרת.' : 'אזור פרטי. התחברו כדי לנהל את הפניות והמחירים שלכם.'),
  err,
  setup ? field('קוד הגדרה ראשונית', code, { hint: 'מודפס ביומן השרת בעת ההפעלה' }) : null,
  field('אימייל', email),
  field('סיסמה', pw, { hint: setup ? 'לפחות 10 תווים' : null }),
  btn);
  app.replaceChildren(h('div', { class: 'auth' }, form));
  (setup ? code : email).focus();
}
/* ======================================================= shell */
async function shell(view) {
  try { state.overview = await api('/api/admin/overview'); } catch (e) { return fail(e); }
  const ov = state.overview;
  const tabs = [['leads', 'פניות'], ['pricing', 'מחיר והצעות מחיר'], ['portfolio', 'תיק עבודות'], ['settings', 'הגדרות']];
  const nav = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'סעיפי לוח הבקרה' }, tabs.map(([k, l]) =>
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(state.tab === k), onclick: () => { state.tab = k; render(); } }, l,
      k === 'leads' && ov.counts.New ? h('span', { class: 'count', 'aria-label': `${ov.counts.New} חדשות` }, ov.counts.New) : null)));
  const main = h('main', { id: 'main' });
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'top__in' },
      h('div', { class: 'top__brand' }, h('span', { class: 'brandmark', 'aria-hidden': 'true' }, '▶'), h('span', { class: 't' }, 'לוח בקרה')),
      nav,
      h('div', { class: 'top__right' },
        h('a', { class: 'btn btn--sm btn--ghost', href: '/', target: '_blank', rel: 'noopener' }, 'צפייה באתר ↗'),
        h('button', { class: 'btn btn--sm', onclick: async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch {} state.csrf = null; boot(); } }, 'התנתקות')))),
    main);
  await view(main);
}
function render() {
  const views = { leads: leadsView, pricing: pricingView, portfolio: portfolioView, settings: settingsView };
  return shell(views[state.tab]);
}
/* ======================================================= leads */
async function leadsView(main) {
  const ov = state.overview;
  const f = state.filters;
  const list = h('div', { class: 'leads', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'טוען…'));
  const statTile = (label, count, patch) => h('button', { class: 'stat', 'aria-pressed': String(Object.entries(patch).every(([k, v]) => f[k] === v)), onclick: () => { Object.assign(f, { status: '', spam: 'hide' }, patch); render(); } }, h('b', null, count), h('span', null, label));
  const checklist = ov.checklist.filter((c) => !c.done);
  const sel = (key, label, opts) => h('select', { 'aria-label': label, onchange: (e) => { f[key] = e.target.value; load(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
  const search = h('input', { type: 'text', placeholder: 'חיפוש לפי שם, יצירת קשר, ערוץ, הערות…', 'aria-label': 'חיפוש פניות', value: f.q });
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = search.value; load(); }, 250); });
  main.append(
    h('div', { class: 'page-title' }, h('h1', null, 'פניות'),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn--sm', href: '/api/admin/export?format=csv' }, 'ייצוא CSV'),
        h('a', { class: 'btn btn--sm', href: '/api/admin/export?format=json' }, 'ייצוא JSON'))),
    !ov.notify.email && !ov.notify.webhook ? h('p', { class: 'alert alert--warn' }, 'לא הוגדרו התראות, ולכן פניות חדשות מופיעות רק כאן. ראו את README כדי להפעיל התראות באימייל או ב-webhook.') : null,
    h('div', { class: 'stats' },
      statTile('כל הפניות הפעילות', ov.total, { status: '' }),
      statTile('חדשות', ov.counts.New || 0, { status: 'New' }),
      statTile('דורשות בדיקה', ov.counts['Needs Review'] || 0, { status: 'Needs Review' }),
      statTile('מתאימות', ov.counts.Qualified || 0, { status: 'Qualified' }),
      statTile('במשא ומתן', ov.counts.Negotiating || 0, { status: 'Negotiating' }),
      statTile('התקבלו', ov.counts.Accepted || 0, { status: 'Accepted' }),
      statTile('ספאם', ov.spam, { spam: 'only' })),
    checklist.length ? h('details', { class: 'panel' }, h('summary', null, h('b', null, `רשימת הגדרה ראשונית · נותרו ${checklist.length}`)),
      h('ul', { class: 'check-list' }, ov.checklist.map((c) => h('li', { class: c.done ? 'done' : '' }, h('span', { class: `dot ${c.done ? 'dot--ok' : ''}` }), c.label)))) : null,
    h('div', { class: 'toolbar' }, search,
      sel('status', 'סטטוס', [['', 'כל סטטוס'], ...ov.statuses.map((s) => [s, STATUS_LABEL[s] || s])]),
      sel('service', 'שירות', [['', 'כל שירות'], ['editing', 'עריכת וידאו'], ['thumbnail', 'תמונות ממוזערות'], ['both', 'שניהם'], ['other', 'אחר']]),
      sel('priority', 'עדיפות', [['', 'כל עדיפות'], ['High priority', 'עדיפות גבוהה'], ['Needs review', 'דורש בדיקה'], ['Low priority', 'עדיפות נמוכה']]),
      sel('sort', 'מיון לפי', [['date', 'מיון: תאריך'], ['score', 'מיון: ציון'], ['service', 'מיון: שירות'], ['status', 'מיון: סטטוס']]),
      sel('dir', 'כיוון', [['desc', 'חדש / גבוה ביותר'], ['asc', 'ישן / נמוך ביותר']])),
    h('div', { class: 'lead-head', 'aria-hidden': 'true' }, h('span', null, 'ציון'), h('span', null, 'לקוח'), h('span', null, 'בקשה'), h('span', null, 'סטטוס'), h('span', null, 'תקבל'), h('span', null, 'דגלים')),
    list);
  async function load() {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    try {
      const { leads } = await api(`/api/admin/leads?${p}`);
      if (!leads.length) {
        const filtered = f.status || f.service || f.priority || f.q || f.spam !== 'hide';
        list.replaceChildren(h('div', { class: 'empty' }, h('b', null, filtered ? 'אין פניות התואמות את הסינונים האלה' : 'אין עדיין פניות'),
          h('span', null, filtered ? 'נסו לנקות סינון אחד.' : 'כשמישהו ישלח את הטופס באתר שלכם, הוא יופיע כאן.')));
        return;
      }
      list.replaceChildren(...leads.map(leadRow));
    } catch (e) { list.replaceChildren(h('div', { class: 'alert alert--bad' }, e.message)); }
  }
  load();
  state.reloadLeads = load;
}
function leadRow(l) {
  const flagPills = l.flags.filter((x) => x.severity !== 'info').map((x) => h('span', { class: `pill ${x.severity === 'spam' ? 'pill--bad' : 'pill--warn'}`, title: x.label }, x.severity === 'spam' ? 'ספאם' : 'בדיקה'));
  return h('button', { class: `lead${l.is_spam ? ' lead--spam' : ''}${l.status === 'New' ? ' lead--new' : ''}`, onclick: () => openLead(l.id), 'aria-label': `פתיחת פנייה מ-${l.name}` },
    h('span', { class: `score ${scoreCls(l.score_category)}`, title: SCORE_LABEL[l.score_category] || l.score_category }, l.score),
    h('span', { class: 'lead__who' }, h('b', null, l.name), h('span', null, `${CONTACT_LABEL[l.contact_method] || l.contact_method}: ${l.contact_value}`)),
    h('span', { class: 'lead__svc' }, h('b', null, L.service[l.service] || l.service), h('span', null, `${CATEGORY_LABEL[l.category] || l.category}${l.budget ? ` · ${L.budget[l.budget]}` : ''}`)),
    h('span', null, statusPill(l.status)),
    h('span', { class: 'small muted' }, fmtShort(l.created_at)),
    h('span', { class: 'lead__flags' }, l.is_spam ? h('span', { class: 'pill pill--bad' }, 'סומן כספאם') : null, flagPills));
}
async function openLead(id) {
  let data;
  try { data = await api(`/api/admin/leads/${id}`); } catch (e) { return fail(e); }
  closeLead();
  const prevFocus = document.activeElement;
  let { lead, analysis } = data;
  const body = h('div', { class: 'drawer__body' });
  const closeBtn = h('button', { class: 'btn btn--sm', onclick: closeLead, 'aria-label': 'סגירה' }, 'סגירה ✕');
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'פרטי פנייה' }, h('div', { class: 'drawer__head' }, h('h2', null, lead.name), closeBtn), body);
  const scrim = h('div', { class: 'scrim', onclick: closeLead });
  document.body.append(scrim, drawer);
  document.body.style.overflow = 'hidden';
  state.openLead = { drawer, scrim, prevFocus };
  const onKey = (e) => { if (e.key === 'Escape') closeLead(); };
  document.addEventListener('keydown', onKey);
  state.openLead.onKey = onKey;
  const kv = (k, v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : [h('dt', null, k), h('dd', null, v)]);
  function paint() {
    const statusSel = h('select', { 'aria-label': 'סטטוס', onchange: async (e) => save({ status: e.target.value }, 'הסטטוס עודכן') }, state.overview.statuses.map((s) => h('option', { value: s, selected: lead.status === s }, STATUS_LABEL[s] || s)));
    const notes = h('textarea', { rows: 4, 'aria-label': 'הערות פרטיות', placeholder: 'הערות פרטיות. רק אתם יכולים לראות אותן.', value: lead.notes });
    const wa = lead.contact_method === 'whatsapp' ? `https://wa.me/${lead.contact_value.replace(/\D/g, '')}` : null;
    const mail = lead.contact_method === 'email' ? `mailto:${lead.contact_value}` : null;
    const hours = h('input', { type: 'number', min: 0, step: '0.5', value: lead.est_hours ?? '', 'data-name': 'est_hours' });
    const rev = h('input', { type: 'number', min: 0, step: '1', value: lead.est_revenue ?? '', 'data-name': 'est_revenue' });
    const cost = h('input', { type: 'number', min: 0, step: '1', value: lead.est_costs ?? '', 'data-name': 'est_costs' });
    const profBox = h('div', { class: 'grid' });
    const est = analysis.estimate;
    const cur = est.currency;
    function paintProf(p, pr) {
      profBox.replaceChildren(
        h('table', { class: 't' }, h('tbody', null,
          h('tr', null, h('td', null, 'הכנסה צפויה'), h('td', { class: 'num' }, money(p.revenue, cur))),
          h('tr', null, h('td', null, 'עלויות פרויקט ישירות'), h('td', { class: 'num' }, money(p.costs, cur))),
          h('tr', null, h('td', null, h('b', null, 'רווח אחרי עלויות'), h('small', null, 'הכנסה פחות עלויות. לא מובטח.')), h('td', { class: 'num' }, h('b', null, money(p.earningsAfterCosts, cur)))),
          h('tr', null, h('td', null, 'שעות מוערכות'), h('td', { class: 'num' }, p.hours ?? '–')),
          h('tr', null, h('td', null, h('b', null, 'תעריף שעתי אפקטיבי'), h('small', { class: 'formula' }, '(הכנסה פחות עלויות) ÷ שעות')), h('td', { class: 'num' }, h('b', null, p.effectiveHourlyRate == null ? '–' : `${money(p.effectiveHourlyRate, cur)}/שעה`))),
          p.targetHourlyRate ? h('tr', null, h('td', null, 'התעריף היעד שלכם'), h('td', { class: 'num' }, `${money(p.targetHourlyRate, cur)}/שעה`)) : null)),
        p.capacity ? h('p', { class: `alert ${p.capacity.fits ? 'alert--ok' : 'alert--warn'}` },
          p.capacity.fits ? `מתאים לקיבולת שלכם: ${p.capacity.withThisProject} מתוך ${p.capacity.monthlyCapacityHours} שעות בחודש, כולל ${p.capacity.committedHours} שעות שכבר מחויבות.`
            : `חריגה בקיבולת של ${p.capacity.overBy} שעות: ${p.capacity.withThisProject} לעומת ${p.capacity.monthlyCapacityHours} שעות בחודש (${p.capacity.committedHours} שעות כבר מחויבות).`) : h('p', { class: 'muted small' }, 'הזינו שעות מוערכות כדי לבדוק קיבולת.'),
        h('p', null, 'עדיפות הפרויקט: ', h('span', { class: `pill ${pr === 'High' ? 'pill--good' : pr === 'Low' ? 'pill--bad' : 'pill--warn'}` }, PRIORITY_LABEL[pr] || pr)));
    }
    paintProf(analysis.profitability, analysis.priority);
    body.replaceChildren(
      h('div', { class: 'row' }, statusPill(lead.status), lead.is_spam ? h('span', { class: 'pill pill--bad' }, 'סומן כספאם') : null, h('span', { class: 'dim small' }, `נקבל ב-${fmtDate(lead.created_at)}`)),
      h('div', { class: 'row' },
        h('label', { class: 'f', style: 'flex:1;min-width:180px' }, h('span', { class: 'f__l' }, 'סטטוס'), statusSel),
        lead.is_spam
          ? h('button', { class: 'btn', onclick: () => save({ is_spam: false, status: 'Needs Review' }, 'שוחזר מספאם') }, 'לא ספאם, שחזר')
          : h('button', { class: 'btn btn--danger', onclick: () => save({ is_spam: true }, 'סומן כספאם') }, 'סמן כספאם')),

      h('section', { class: 'panel' }, h('h3', null, 'יצירת קשר'),
        h('div', { class: 'row' },
          h('b', null, `${CONTACT_LABEL[lead.contact_method] || lead.contact_method}: ${lead.contact_value}`),
          h('button', { class: 'btn btn--sm', onclick: () => copy(lead.contact_value, 'פרטי הקשר הועתקו') }, 'העתק'),
          mail ? h('a', { class: 'btn btn--sm', href: mail }, 'אימייל') : null,
          wa ? h('a', { class: 'btn btn--sm', href: wa, target: '_blank', rel: 'noopener noreferrer' }, 'וואטסאפ') : null),
        h('div', { class: 'row' },
          h('a', { class: 'btn btn--sm', href: lead.channel_url, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'פתח את הערוץ ↗'),
          h('button', { class: 'btn btn--sm', onclick: () => copy(lead.channel_url, 'הקישור הועתק') }, 'העתק קישור'),
          h('span', { class: 'dim small' }, new URL(lead.channel_url).hostname))),

      h('section', { class: 'panel' },
        h('div', { class: 'panel__head' }, h('h3', null, 'ניקוד והכשרה'),
          h('div', { class: 'bigscore' }, h('b', null, lead.score), h('span', { class: `pill ${lead.score_category === 'High priority' ? 'pill--good' : lead.score_category === 'Low priority' ? '' : 'pill--warn'}` }, SCORE_LABEL[lead.score_category] || lead.score_category))),
        h('p', { class: 'muted small' }, 'כלי עדיפות הנבנה מהחוקים שלכם. הוא לעולם לא דוחה אף אחד. אתם מחליטים.'),
        h('div', { class: 'grid' }, lead.score_breakdown.map((x) => h('div', { class: 'factor' }, h('span', null, x.label), h('div', { class: 'bar', role: 'presentation' }, h('i', { style: `width:${x.max ? (x.earned / x.max) * 100 : 0}%` })), h('span', { class: 'dim', style: 'text-align:right' }, `${x.earned}/${x.max}`), h('small', null, x.note)))),
        lead.flags.length ? h('div', { class: 'grid' }, h('h3', null, 'דגלי סיכון'), h('ul', { class: 'list-dots' }, lead.flags.map((x) => h('li', null, h('span', { class: `pill ${x.severity === 'spam' ? 'pill--bad' : x.severity === 'warn' ? 'pill--warn' : 'pill--info'}` }, SEV_LABEL[x.severity] || x.severity), ' ', x.label)))) : null),

      h('section', { class: 'panel' }, h('h3', null, 'הפרטים שנשלחו'),
        h('dl', { class: 'kv' },
          kv('שירות', L.service[lead.service] + (lead.service_other ? `: ${lead.service_other}` : '')),
          kv('נושא הערוץ', (CATEGORY_LABEL[lead.category] || lead.category) + (lead.category_other ? ` (${lead.category_other})` : '')),
          kv('סוג שיתוף פעולה', L.collab[lead.collab]), kv('סרטונים בחודש', L.vpm[lead.videos_per_month]), kv('אורך טיפוסי', L.len[lead.video_length]),
          kv('חומר גלם', L.raw[lead.raw_footage]), kv('פלטפורמות', lead.platforms.map((p) => PLATFORM_LABEL[p] || p).join(', ')), kv('הפניית סגנון', lead.style_ref),
          kv('נושא הסרטון', lead.video_topic), kv('הפניות לתמונות ממוזערות', lead.thumb_refs), kv('תקציב', L.budget[lead.budget]), kv('מתי רוצים להתחיל', L.timing[lead.start_timing]), kv('שיטת תשלום', L.pay[lead.payment_method] || lead.payment_method),
          kv('הודעה', lead.details ? h('div', { class: 'pre' }, lead.details) : null))),

      h('section', { class: 'panel' }, h('h3', null, 'הצעת מחיר מוצעת'),
        h('p', { class: 'muted small' }, 'מבוסס על חוקי המחיר שלכם ועל מה שאמר הלקוח. הערכה בלבד. אתם קובעים את המחיר הסופי.'),
        est.sample ? h('p', { class: 'alert alert--warn' }, 'משתמש במחירי דוגמה. הזינו את התעריפים האמיתיים שלכם במחירים.') : null,
        estimateView(est)),

      h('section', { class: 'panel' }, h('h3', null, 'רווחיות וקיבולת'),
        h('p', { class: 'muted small' }, 'הזינו מספרים משלכם. הכנסה אינה רווח, ושום דבר מזה אינו מובטח.'),
        h('div', { class: 'grid c3' },
          field(`הכנסה צפויה (${cur})`, rev), field('שעות מוערכות', hours), field(`עלויות ישירות (${cur})`, cost)),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn--sm', onclick: () => { if (est.total != null) rev.value = est.total; if (est.hours != null) hours.value = est.hours; toast('אוזן מההערכה. עדכנו ואז שמרו.'); } }, 'השתמשו בהצעה המוצעת'),
          h('button', { class: 'btn btn--sm btn--primary', onclick: () => save({ est_revenue: num(rev), est_hours: num(hours), est_costs: num(cost) }, 'המספרים נשמרו') }, 'שמור מספרים')),
        profBox),

      h('section', { class: 'panel' }, h('h3', null, 'הערות פרטיות'), notes,
        h('div', { class: 'row' }, h('button', { class: 'btn btn--primary btn--sm', onclick: () => save({ notes: notes.value }, 'ההערות נשמרו') }, 'שמור הערות'))),

      (lead.is_spam || lead.status === 'Archived') ? h('section', { class: 'panel' }, h('h3', null, 'אזור מסוכן'),
        h('p', { class: 'muted small' }, 'מחיקה לצמיתות אינה ניתנת לביטול. יצאו קודם לקובץ אם אינכם בטוחים.'),
        h('div', { class: 'row' }, h('button', { class: 'btn btn--danger btn--sm', onclick: async () => {
          if (!confirm('למחוק את הפנייה הזו לצמיתות? לא ניתן לבטל פעולה זו.')) return;
          try { await api(`/api/admin/leads/${lead.id}`, { method: 'DELETE' }); toast('נמחק'); closeLead(); render(); } catch (e) { fail(e); }
        } }, 'מחק לצמיתות'))) : null);
  }

  async function save(patch, msg) {
    try {
      const r = await api(`/api/admin/leads/${lead.id}`, { method: 'PATCH', body: patch });
      lead = r.lead; analysis = r.analysis; paint(); toast(msg);
      state.overview = await api('/api/admin/overview');
      const c = $('.tab .count'); if (c) c.textContent = state.overview.counts.New || '';
      state.reloadLeads?.();
    } catch (e) { fail(e); }
  }
  paint();
  closeBtn.focus();
}

function closeLead() {
  const o = state.openLead; if (!o) return;
  o.drawer.remove(); o.scrim.remove(); document.removeEventListener('keydown', o.onKey);
  document.body.style.overflow = '';
  o.prevFocus?.focus?.();
  state.openLead = null;
  state.reloadLeads?.();
  api('/api/admin/overview').then((ov) => { state.overview = ov; const c = $('.tab .count'); if (c) c.textContent = ov.counts.New || ''; }).catch(() => {});
}

function estimateView(est) {
  return h('div', { class: 'grid' },
    h('div', { class: 'est__total' }, h('b', null, est.total == null ? 'נדרשת הצעת מחיר ידנית' : money(est.total, est.currency)), est.recurring && est.total != null ? h('span', { class: 'muted' }, 'לחודש') : null, est.hours != null ? h('span', { class: 'pill' }, `עומס עבודה של ~${est.hours} שעות`) : null,
      est.needsManualReview ? h('span', { class: 'pill pill--warn' }, 'דורש בדיקה ידנית') : h('span', { class: 'pill pill--good' }, 'מחור במלואו לפי החוקים')),
    est.lines.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'פריט'), h('th', { class: 'num' }, 'סכום'))),
      h('tbody', null, est.lines.map((l) => h('tr', null, h('td', null, l.label, h('small', null, l.detail)), h('td', { class: 'num' }, money(l.amount, est.currency)))),
        est.total != null ? h('tr', null, h('td', null, h('b', null, 'סך הכל מוערך')), h('td', { class: 'num' }, h('b', null, money(est.total, est.currency)))) : null)) : null,
    est.reasons.length ? h('div', null, h('h3', null, 'מדוע נדרשת בדיקה ידנית'), h('ul', { class: 'list-dots' }, est.reasons.map((r) => h('li', null, r)))) : null,
    est.assumptions.length ? h('div', null, h('h3', null, 'הנחות'), h('ul', { class: 'list-dots' }, est.assumptions.map((r) => h('li', null, r)))) : null,
    h('p', { class: 'dim small' }, est.disclaimer));
}

/* ======================================================= pricing */
async function pricingView(main) {
  let pricing;
  try { ({ pricing } = await api('/api/admin/pricing')); } catch (e) { return fail(e); }
  const P = structuredClone(pricing);
  const root = h('div');
  const numIn = (obj, key, opts = {}) => h('input', { type: 'number', min: opts.min ?? 0, step: opts.step ?? 'any', value: obj[key], 'data-name': opts.path, oninput: (e) => { obj[key] = e.target.value === '' ? '' : Number(e.target.value); } });
  const modeSeg = (obj, path) => {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': 'מצב תמחור' });
    const draw = () => wrap.replaceChildren(...[['fixed', 'מחיר קבוע'], ['quote', 'הצעת מחיר בלבד']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(obj.mode === v), onclick: () => { obj.mode = v; draw(); } }, l)));
    draw();
    return wrap;
  };

  const addonsBox = h('div', { class: 'addons' });
  function drawAddons() {
    addonsBox.replaceChildren(...P.addons.map((a, i) => h('div', { class: 'addon' },
      field('שם התוספת', h('input', { type: 'text', value: a.label, maxlength: 60, 'data-name': `addons.${i}.label`, oninput: (e) => (a.label = e.target.value) })),
      field('מחיר', h('input', { type: 'number', min: 0, step: 'any', value: a.price, 'data-name': `addons.${i}.price`, oninput: (e) => (a.price = Number(e.target.value)) })),
      field('חיוב', h('select', { onchange: (e) => (a.unit = e.target.value) }, h('option', { value: 'flat', selected: a.unit === 'flat' }, 'תשלום אחיד'), h('option', { value: 'per_item', selected: a.unit === 'per_item' }, 'לכל סרטון'))),
      field('שעות', h('input', { type: 'number', min: 0, step: 'any', value: a.hours, 'data-name': `addons.${i}.hours`, oninput: (e) => (a.hours = Number(e.target.value)) })),
      h('button', { class: 'btn btn--sm btn--danger', type: 'button', 'aria-label': `הסר את ${a.label}`, onclick: () => { P.addons.splice(i, 1); drawAddons(); drawCalcAddons(); } }, 'הסר'))));
  }
  drawAddons();

  const real = h('input', { type: 'checkbox', checked: P.is_real, onchange: (e) => (P.is_real = e.target.checked) });
  const cur = h('input', { type: 'text', value: P.currency, maxlength: 3, 'data-name': 'currency', style: 'text-transform:uppercase', oninput: (e) => (P.currency = e.target.value.toUpperCase()) });

  const saveBtn = h('button', { class: 'btn btn--primary', onclick: async () => {
    saveBtn.disabled = true;
    try { const r = await api('/api/admin/pricing', { method: 'PUT', body: P }); Object.assign(P, r.pricing); toast('המחירים נשמרו'); showFieldErrors(root, {}); await runCalc(); state.overview = await api('/api/admin/overview'); }
    catch (e) { showFieldErrors(root, e.errors); fail(e); } finally { saveBtn.disabled = false; }
  } }, 'שמור מחירים');

  // calculator
  const C = { service: 'editing', videos: 1, minutes: 10, shorts: 0, thumbnails: 0, complexity: 'standard', recurring: false, rush: false, special: false, addons: [] };
  const out = h('div', { class: 'grid' });
  const addonChecks = h('div', { class: 'row' });
  function drawCalcAddons() {
    C.addons = C.addons.filter((k) => P.addons.some((a) => a.key === k));
    addonChecks.replaceChildren(...P.addons.filter((a) => a.key).map((a) => h('label', { class: 'f--inline f' }, h('input', { type: 'checkbox', checked: C.addons.includes(a.key), onchange: (e) => { C.addons = e.target.checked ? [...C.addons, a.key] : C.addons.filter((k) => k !== a.key); runCalc(); } }), h('span', { class: 'f__l' }, a.label))));
  }
  let calcSeq = 0;
  async function runCalc() {
    const seq = ++calcSeq;
    try { const { estimate } = await api('/api/admin/estimate', { method: 'POST', body: C }); if (seq === calcSeq) out.replaceChildren(estimateView(estimate)); }
    catch (e) { if (seq === calcSeq) out.replaceChildren(h('p', { class: 'alert alert--bad' }, e.message)); }
  }
  const cin = (key, label, extra = {}) => field(label, h('input', { type: 'number', min: 0, step: extra.step || 1, value: C[key], oninput: (e) => { C[key] = Number(e.target.value || 0); runCalc(); } }));
  drawCalcAddons();

  root.append(h('div', { class: 'cols' },
    h('div', { class: 'grid' },
      h('div', { class: 'page-title' }, h('h1', null, 'מחיר והצעות מחיר'), saveBtn),
      !P.is_real ? h('p', { class: 'alert alert--warn' }, 'אלה הם ערכי דוגמה, לא מחירים אמיתיים. הזינו את התעריפים שלכם, ואסמנו “אלה הם התעריפים האמיתיים שלי”. עד אז כל הערכה מתויגת כדוגמה.') : null,
      h('section', { class: 'panel' }, h('h2', null, 'כללי'),
        h('div', { class: 'grid c2' }, field('מטבע', cur, { hint: 'קוד בן 3 אותיות, למשל USD, EUR, ILS' }),
          h('label', { class: 'f f--inline', style: 'align-self:end;min-height:40px' }, real, h('span', { class: 'f__l' }, 'אלה הם התעריפים האמיתיים שלי')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'עריכת וידאו רגילה ליוטיוב'), modeSeg(P.editing)),
        h('p', { class: 'muted small' }, 'מחיר = מחיר בסיס + דקות נוספות × תעריף, כפול מורכבות. סרטונים ארוכים יכולים להיות לפי הצעת מחיר בלבד.'),
        h('div', { class: 'grid c3' },
          field('מחיר בסיס', numIn(P.editing, 'base_price', { path: 'editing.base_price' })), field('אורך בסיס מכוסה (דקות)', numIn(P.editing, 'base_minutes', { path: 'editing.base_minutes', min: 1 })), field('מחיר לדקה נוספת', numIn(P.editing, 'extra_per_minute', { path: 'editing.extra_per_minute' })),
          field('הצעת מחיר בלבד מעל (דקות)', numIn(P.editing, 'quote_over_minutes', { path: 'editing.quote_over_minutes', min: 1 }), { hint: 'מסמן סרטונים ארוכים או מורכבים לבדיקה ידנית' }),
          field('שעות לסרטון בסיס', numIn(P.editing, 'hours_base', { path: 'editing.hours_base' })), field('שעות נוספות לדקה נוספת', numIn(P.editing, 'hours_per_extra_minute', { path: 'editing.hours_per_extra_minute' })))),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'סרטונים קצרים'), modeSeg(P.short_form)),
        h('div', { class: 'grid c2' }, field('מחיר לכל אחת', numIn(P.short_form, 'price_each', { path: 'short_form.price_each' })), field('שעות לכל אחת', numIn(P.short_form, 'hours_each', { path: 'short_form.hours_each' })))),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'עיצוב תמונות ממוזערות'), modeSeg(P.thumbnail)),
        h('div', { class: 'grid c2' }, field('מחיר לכל אחת', numIn(P.thumbnail, 'price_each', { path: 'thumbnail.price_each' })), field('שעות לכל אחת', numIn(P.thumbnail, 'hours_each', { path: 'thumbnail.hours_each' })),
          field('הנחת נפח החל מ-(כמות)', numIn(P.thumbnail, 'volume_threshold', { path: 'thumbnail.volume_threshold', min: 1 })), field('אחוז הנחת נפח', numIn(P.thumbnail, 'volume_discount_pct', { path: 'thumbnail.volume_discount_pct' })))),
      h('section', { class: 'panel' }, h('h2', null, 'חבילות, מורכבות, דחיפות ומנוי'),
        h('div', { class: 'grid c3' },
          field('אחוז הנחת חבילה (עריכה + תמונות)', numIn(P, 'bundle_discount_pct', { path: 'bundle_discount_pct' })), field('אחוח תוספת משלוח דחוף', numIn(P, 'rush_pct', { path: 'rush_pct' })), h('span'),
          field('מורכבות: פשוט ×', numIn(P.complexity, 'simple', { path: 'complexity.simple', step: '0.05' })), field('מורכבות: סטנדרטי ×', numIn(P.complexity, 'standard', { path: 'complexity.standard', step: '0.05' })), field('מורכבות: מתקדם ×', numIn(P.complexity, 'advanced', { path: 'complexity.advanced', step: '0.05' })),
          field('אחוז הנחת מנוי', numIn(P.recurring, 'discount_pct', { path: 'recurring.discount_pct' })), field('…חל מפריטים / חודש', numIn(P.recurring, 'min_items', { path: 'recurring.min_items', min: 1 })), field('מינימום חבילה חודשית', numIn(P.recurring, 'monthly_minimum', { path: 'recurring.monthly_minimum' })))),
      h('section', { class: 'panel' }, h('div', { class: 'panel__head' }, h('h2', null, 'תוספות אופציונליות'),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { P.addons.push({ key: '', label: 'תוספת חדשה', price: 0, unit: 'flat', hours: 0 }); drawAddons(); } }, '+ הוסף תוספת')),
        addonsBox),
      h('div', { class: 'row' }, h('button', { class: 'btn btn--primary', onclick: () => saveBtn.click() }, 'שמור מחירים'))),

    h('aside', { class: 'sticky' }, h('section', { class: 'panel' }, h('h2', null, 'מחשבון הצעות מחיר'),
      h('p', { class: 'muted small' }, 'משתמש במחירים השמורים שלכם. שמרו שינויים תחילה כדי לראות אותם בתוצאה.'),
      h('div', { class: 'grid c2' },
        field('שירות', h('select', { onchange: (e) => { C.service = e.target.value; runCalc(); } }, ['editing', 'thumbnail', 'both', 'other'].map((v) => h('option', { value: v }, L.service[v])))),
        field('מורכבות', h('select', { onchange: (e) => { C.complexity = e.target.value; runCalc(); } }, ['simple', 'standard', 'advanced'].map((v) => h('option', { value: v, selected: v === 'standard' }, CX[v])))),
        cin('videos', 'סרטונים ארוכים'), cin('minutes', 'דקות לכל אחד'), cin('shorts', 'עריכות קצרות'), cin('thumbnails', 'תמונות ממוזערות')),
      h('div', { class: 'row' },
        h('label', { class: 'f f--inline' }, h('input', { type: 'checkbox', onchange: (e) => { C.recurring = e.target.checked; runCalc(); } }), h('span', { class: 'f__l' }, 'חבילה חודשית')),
        h('label', { class: 'f f--inline' }, h('input', { type: 'checkbox', onchange: (e) => { C.rush = e.target.checked; runCalc(); } }), h('span', { class: 'f__l' }, 'דחוף')),
        h('label', { class: 'f f--inline' }, h('input', { type: 'checkbox', onchange: (e) => { C.special = e.target.checked; runCalc(); } }), h('span', { class: 'f__l' }, 'דרישות מיוחדות'))),
      addonChecks, out))));
  main.append(root);
  runCalc();
}

/* ======================================================= portfolio */
async function portfolioView(main) {
  const KINDS = [['video', 'סרטון'], ['short', 'קצר'], ['thumbnail', 'תמונה ממוזערת'], ['before_after', 'לפני ואחרי']];
  const list = h('div', { class: 'grid' });
  async function load() {
    try {
      const { items } = await api('/api/admin/portfolio');
      list.replaceChildren(...(items.length ? items.map((it, i) => h('div', { class: `pf${it.visible ? '' : ' pf--hidden'}` },
        h('div', { class: 'pf__img' }, (it.thumb_url || it.after_url) ? h('img', { src: it.thumb_url || it.after_url, alt: '' }) : KIND_LABEL[it.kind] || it.kind),
        h('div', null, h('b', null, it.title), h('div', { class: 'small muted' }, `${KINDS.find((k) => k[0] === it.kind)[1]}${it.visible ? '' : ' · מוסתר'}${it.tags.length ? ' · ' + it.tags.join(', ') : ''}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn--sm', disabled: i === 0, 'aria-label': 'הזזה למעלה', onclick: () => mv(it.id, 'up') }, '↑'),
          h('button', { class: 'btn btn--sm', disabled: i === items.length - 1, 'aria-label': 'הזזה למטה', onclick: () => mv(it.id, 'down') }, '↓'),
          h('button', { class: 'btn btn--sm', onclick: async () => { try { await api(`/api/admin/portfolio/${it.id}`, { method: 'PATCH', body: { visible: !it.visible } }); load(); } catch (e) { fail(e); } } }, it.visible ? 'הסתר' : 'הצג'),
          h('button', { class: 'btn btn--sm', onclick: () => edit(it) }, 'עריכה'),
          h('button', { class: 'btn btn--sm btn--danger', onclick: async () => { if (!confirm(`למחוק את “${it.title}”?`)) return; try { await api(`/api/admin/portfolio/${it.id}`, { method: 'DELETE' }); load(); } catch (e) { fail(e); } } }, 'מחק'))))
        : [h('div', { class: 'empty' }, h('b', null, 'אין עדיין פריטים בתיק העבודות'), h('span', null, 'האתר הציבורי מציג מצייני מקום מתויגים בבירור עד שתוסיפו עבודה אמיתית.'))]));
    } catch (e) { fail(e); }
  }
  async function mv(id, move) { try { await api(`/api/admin/portfolio/${id}`, { method: 'PATCH', body: { move } }); load(); } catch (e) { fail(e); } }

  async function upload(input, target) {
    const file = input.files[0]; if (!file) return;
    if (file.size > 80 * 1024 * 1024) return toast('הקובץ גדול מ-80 מגה. ארחו אותו ביוטיוב/וימיאו והדביקו את הקישור.', 'bad');
    toast('מעלה…');
    try {
      const res = await fetch(`/api/admin/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'X-CSRF-Token': state.csrf, 'Content-Type': 'application/octet-stream' }, body: file });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      target.value = d.url; target.dispatchEvent(new Event('input')); toast('הועלה');
    } catch (e) { fail(e); }
    input.value = '';
  }

  function edit(it) {
    const D = it || { kind: 'video', title: '', description: '', tags: [], media_url: '', thumb_url: '', before_url: '', after_url: '', visible: true };
    const inp = (k, label, hint, up) => {
      const i = h('input', { type: 'text', value: D[k] || '', maxlength: 500, 'data-name': k });
      const fi = h('input', { type: 'file', accept: up, class: 'sr', tabindex: '-1', onchange: () => upload(fi, i) });
      return h('div', { class: 'f' }, h('span', { class: 'f__l' }, label), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, i, up ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => fi.click() }, 'העלה') : null, fi), h('span', { class: 'f__h' }, hint), h('span', { class: 'f__e' }));
    };
    const kind = h('select', { onchange: () => (D.kind = kind.value) }, KINDS.map(([v, l]) => h('option', { value: v, selected: D.kind === v }, l)));
    const title = h('input', { type: 'text', value: D.title, maxlength: 100, 'data-name': 'title' });
    const desc = h('input', { type: 'text', value: D.description, maxlength: 400 });
    const tags = h('input', { type: 'text', value: (D.tags || []).join(', '), placeholder: 'גיימינג, כתוביות, גרדי צבע' });
    const vis = h('input', { type: 'checkbox', checked: D.visible });
    const fields = [inp('media_url', 'קישור או קובץ וידאו', 'קישור יוטיוב/וימיאו, MP4 ב-https, או העלאה (עד 80 מגה).', 'video/mp4,video/webm'), inp('thumb_url', 'תמונת ממוזערות / עטיפה', 'נדרש עבור פריטי תמונה ממוזערת; פוסטר אופציונלי לסרטונים.', 'image/png,image/jpeg,image/webp'),
      inp('before_url', 'תמונת לפני', 'רק עבור פריטי לפני ואחרי.', 'image/png,image/jpeg,image/webp'), inp('after_url', 'תמונת אחרי', 'רק עבור פריטי לפני ואחרי.', 'image/png,image/jpeg,image/webp')];
    const form = h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      const g = (k) => form.querySelector(`[data-name="${k}"]`).value;
      const body = { kind: kind.value, title: title.value, description: desc.value, tags: tags.value, visible: vis.checked, media_url: g('media_url'), thumb_url: g('thumb_url'), before_url: g('before_url'), after_url: g('after_url') };
      try { await api(it ? `/api/admin/portfolio/${it.id}` : '/api/admin/portfolio', { method: it ? 'PATCH' : 'POST', body }); toast('נשמר'); form.remove(); load(); }
      catch (ex) { showFieldErrors(form, ex.errors); fail(ex); }
    } }, h('h2', null, it ? 'עריכת פריט' : 'פריט חדש לתיק העבודות'),
    h('div', { class: 'grid c2' }, field('סוג', kind), field('כותרת', title)), field('תיאור קצר (לא חובה)', desc), field('תגיות (מופרדות בפסיק)', tags), ...fields,
    h('label', { class: 'f f--inline' }, vis, h('span', { class: 'f__l' }, 'גלוי באתר הציבורי')),
    h('div', { class: 'row' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'שמור פריט'), h('button', { class: 'btn', type: 'button', onclick: () => form.remove() }, 'ביטול')));
    slot.replaceChildren(form); form.scrollIntoView({ block: 'nearest' }); title.focus();
  }
  const slot = h('div');
  main.append(h('div', { class: 'page-title' }, h('h1', null, 'תיק עבודות'), h('button', { class: 'btn btn--primary', onclick: () => edit(null) }, '+ הוסף פריט')),
    h('p', { class: 'muted' }, 'הוסיפו רק עבודות שיצרתם באמת. ללא פריטים, האתר מציג מצייני מקום מתויגים.'), slot, list);
  load();
}

/* ======================================================= settings */
async function settingsView(main) {
  let S;
  try { S = await api('/api/admin/settings'); } catch (e) { return fail(e); }
  const root = h('div', { class: 'grid' });
  const t = (obj, k, extra = {}) => h('input', { type: extra.type || 'text', value: obj[k] ?? '', maxlength: extra.max, 'data-name': `${extra.sec}.${k}`, oninput: (e) => { obj[k] = extra.type === 'number' ? Number(e.target.value) : e.target.value; }, min: extra.type === 'number' ? 0 : null, step: extra.type === 'number' ? 'any' : null });
  const area = (obj, k, sec, rows = 6) => h('textarea', { rows, 'data-name': `${sec}.${k}`, oninput: (e) => (obj[k] = e.target.value), value: obj[k] });
  const sel = (obj, k, opts) => h('select', { onchange: (e) => (obj[k] = e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: obj[k] === v }, l)));
  const chk = (obj, k, label) => h('label', { class: 'f f--inline' }, h('input', { type: 'checkbox', checked: obj[k], onchange: (e) => (obj[k] = e.target.checked) }), h('span', { class: 'f__l' }, label));

  const skills = h('input', { type: 'text', value: (S.site.skills || []).join(', '), placeholder: 'Premiere Pro, After Effects, Photoshop', oninput: (e) => (S.site.skills = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)) });
  const pimg = t(S.site, 'profile_image_url', { sec: 'site', max: 500 });
  const pfile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr', tabindex: '-1', onchange: async () => {
    const f = pfile.files[0]; if (!f) return;
    try { const r = await fetch(`/api/admin/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'X-CSRF-Token': state.csrf, 'Content-Type': 'application/octet-stream' }, body: f }); const d = await r.json(); if (!r.ok) throw new Error(d.error); pimg.value = d.url; S.site.profile_image_url = d.url; toast('הועלה. אל תשכחו לשמור.'); } catch (e) { fail(e); }
  } });

  const W = S.scoring.weights;
  const wl = { channel: 'קישור לערוץ', service: 'בהירות השירות', frequency: 'תדירות פרסום', recurring: 'עניין בעבודה שוטפת', budget: 'התאמת תקציב', timing: 'תזמון התחלה', details: 'פרטים שימושיים', capacity: 'התאמת קיבולת' };
  const weights = Object.keys(wl).map((k) => field(wl[k], h('input', { type: 'number', min: 0, max: 100, value: W[k], 'data-name': `scoring.weights.${k}`, oninput: (e) => (W[k] = Number(e.target.value)) })));

  const save = h('button', { class: 'btn btn--primary', onclick: async () => {
    save.disabled = true;
    try { const r = await api('/api/admin/settings', { method: 'PUT', body: { site: S.site, business: S.business, notifications: S.notifications, scoring: S.scoring } }); Object.assign(S, r); showFieldErrors(root, {}); toast('ההגדרות נשמרו. הפניות חולשו מחדש.'); }
    catch (e) { showFieldErrors(root, e.errors); fail(e); } finally { save.disabled = false; }
  } }, 'שמור הגדרות');

  const pw = { current: h('input', { type: 'password', autocomplete: 'current-password' }), next: h('input', { type: 'password', autocomplete: 'new-password' }) };

  root.append(
    h('div', { class: 'page-title' }, h('h1', null, 'הגדרות'), save),
    h('section', { class: 'panel' }, h('h2', null, 'תוכן האתר'),
      h('div', { class: 'grid c2' }, field('השם / המותג שלכם', t(S.site, 'brand_name', { sec: 'site', max: 60 })), field('אימייל ליצירת קשר בנושא פרטיות', t(S.site, 'privacy_email', { sec: 'site', max: 120 }), { hint: 'מופיע בהודעת הפרטיות' })),
      field('כותרת ראשית', t(S.site, 'hero_headline', { sec: 'site', max: 120 })), field('טקסט ראשי', t(S.site, 'hero_sub', { sec: 'site', max: 300 })),
      field('כותרת “אודות”', t(S.site, 'about_title', { sec: 'site', max: 100 })), field('טקסט “אודות”', area(S.site, 'about_text', 'site', 8), { hint: 'כתבו במילים שלכם. שורה ריקה = פסקה חדשה.' }),
      field('תוכנות ומיומנויות', skills, { hint: 'מופרדים בפסיק. השאירו ריק כדי להסתיר.' }),
      h('div', { class: 'f' }, h('span', { class: 'f__l' }, 'תמונת פרופיל'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, pimg, h('button', { class: 'btn btn--sm', type: 'button', onclick: () => pfile.click() }, 'העלה'), pfile), h('span', { class: 'f__e' }))),
    h('section', { class: 'panel' }, h('h2', null, 'עסק וזמינות'),
      h('div', { class: 'grid c2' },
        field('אימייל ליצירת קשר', t(S.business, 'contact_email', { sec: 'business', max: 120 })), field('מספר וואטסאפ', t(S.business, 'whatsapp', { sec: 'business', max: 30 }), { hint: 'ספרות עם קידומת מדינה, למשל 972501234567' }),
        field('הדרך המועדפת להשיב', sel(S.business, 'preferred_channel', [['email', 'אימייל'], ['whatsapp', 'וואטסאפ'], ['discord', 'דיסקורד'], ['telegram', 'טלגרם'], ['instagram', 'אינסטגרם'], ['other', 'אחר']])),
        field('זמינות (מוצגת באתר)', sel(S.business, 'availability', [['open', 'מקבל פרויקטים חדשים'], ['limited', 'זמינות מוגבלת'], ['closed', 'לא פנוי']])),
        field('הערת זמינות', t(S.business, 'availability_note', { sec: 'business', max: 160 }), { hint: 'לדוגמה: הפתיחה הבאה: נובמבר' }),
        field('תקציב מינימלי לפרויקט (להתייחסות)', t(S.business, 'min_budget', { sec: 'business', type: 'number' })), field('קיבולת שבועית (שעות)', t(S.business, 'weekly_capacity_hours', { sec: 'business', type: 'number' })), field('תעריף שעתי יעד', t(S.business, 'target_hourly_rate', { sec: 'business', type: 'number' }), { hint: '0 = לא בשימוש' })),
      chk(S.business, 'show_whatsapp_public', 'הצג קישור “כתבו לי בוואטסאפ” מתחת לטופס הפנייה')),
      h('div', { class: 'f' }, h('span', { class: 'f__l' }, 'שיטות תשלום מוצגות באתר'),
        (() => {
          const PAY_OPTS = [['visa', 'Visa'], ['mastercard', 'Mastercard'], ['amex', 'Amex'], ['paypal', 'PayPal'], ['applepay', 'Apple Pay'], ['googlepay', 'Google Pay'], ['bit', 'Bit'], ['bank', 'העברה בנקאית']];
          const sel = new Set(String(S.business.accepted_payments || '').split(',').map((s) => s.trim()).filter(Boolean));
          const box = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' });
          box.replaceChildren(...PAY_OPTS.map(([k, l]) => h('label', { class: 'f f--inline', style: 'flex:0 0 auto;display:inline-flex;align-items:center;gap:8px' }, h('input', { type: 'checkbox', checked: sel.has(k), onchange: (e) => { if (e.target.checked) sel.add(k); else sel.delete(k); S.business.accepted_payments = [...sel].join(','); } }), h('span', { class: 'f__l' }, l))));
          return box;
        })()),
    h('section', { class: 'panel' }, h('h2', null, 'התראות'),
      h('p', { class: S.notify_status.email || S.notify_status.webhook ? 'alert alert--ok' : 'alert alert--warn' }, `אימייל: ${S.notify_status.email ? 'מחובר' : 'לא מוגדר'} · Webhook: ${S.notify_status.webhook ? 'מחובר' : 'לא מוגדר'}. אישורים מוגדרים כמשתני סביבה של השרת (ראה README), לא כאן.`),
      chk(S.notifications, 'email', 'שלחו לי אימייל על פניות חדשות'), chk(S.notifications, 'webhook', 'שלחו פניות חדשות ל-webhook שלי (דיסקורד / סלאק)'), chk(S.notifications, 'include_spam', 'התראו גם על פניות שסומנו אוטומטית כספאם')),
    h('section', { class: 'panel' }, h('h2', null, 'חוקי ניקוד פניות'),
      h('p', { class: 'muted small' }, 'ככל שהמשקל גבוה יותר, האותות הזה חשוב יותר. הציונים מנורמלים ל-0–100. מידע אופציונלי חסר מקבל ניקוד ניטרלי, לעולם לא כחשוד.'),
      h('div', { class: 'grid c4' }, weights),
      h('div', { class: 'grid c2' }, field('“עדיפות גבוהה” מציון', h('input', { type: 'number', min: 0, max: 100, value: S.scoring.thresholds.high, 'data-name': 'scoring.thresholds.high', oninput: (e) => (S.scoring.thresholds.high = Number(e.target.value)) })),
        field('“דורש בדיקה” מציון', h('input', { type: 'number', min: 0, max: 100, value: S.scoring.thresholds.review, 'data-name': 'scoring.thresholds.review', oninput: (e) => (S.scoring.thresholds.review = Number(e.target.value)) })))),
    h('section', { class: 'panel' }, h('h2', null, 'שינוי סיסמה'),
      h('div', { class: 'grid c2' }, field('סיסמה נוכחית', pw.current), field('סיסמה חדשה (10+ תווים)', pw.next)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
        try { const r = await api('/api/admin/password', { method: 'POST', body: { current: pw.current.value, next: pw.next.value } }); state.csrf = r.csrf; pw.current.value = pw.next.value = ''; toast('הסיסמה שונתה. חיבורים אחרים ננתקו.'); } catch (e) { fail(e); }
      } }, 'שנה סיסמה'))));
  main.append(root);
}

/* ======================================================= boot */
async function boot() {
  try {
    const s = await (await fetch('/api/admin/status', { credentials: 'same-origin' })).json();
    if (s.setup_required) return authScreen(true);
    if (!s.signed_in) return authScreen(false);
    state.csrf = s.csrf;
    render();
  } catch { app.replaceChildren(h('p', { class: 'boot' }, 'לא ניתן להגיע לשרת. בדקו את החיבור וטענו מחדש.')); }
}
boot();
