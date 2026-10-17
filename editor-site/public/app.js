(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Safe DOM builder: all dynamic text goes through textContent, never innerHTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }

  /* ---------------- nav ---------------- */
  const toggle = $('#nav-toggle');
  const links = $('#nav-links');
  const setMenu = (open) => {
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'סגירת תפריט' : 'פתיחת תפריט');
  };
  toggle.addEventListener('click', () => setMenu(!links.classList.contains('open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  window.matchMedia('(min-width: 821px)').addEventListener('change', () => setMenu(false));

  /* ---------------- reveal on scroll ---------------- */
  const revealEls = $$('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach((el, i) => { el.style.transitionDelay = `${Math.min(i % 4, 3) * 60}ms`; io.observe(el); });
  } else revealEls.forEach((el) => el.classList.add('in'));

  /* ---------------- decorative audio waveform ---------------- */
  const wave = $('.wave');
  if (wave) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120; i++) {
      const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9));
      wave.append(h('i', { style: `height:${Math.round((18 + rnd() * 70) * env)}%` }));
    }
  }

  /* ---------------- portfolio ---------------- */
  const KIND_LABEL = { video: 'סרטונים', short: 'סרטונים קצרים', thumbnail: 'תמונות ממוזערות', before_after: 'לפני ואחרי' };
  const PLAY_ICON = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '26'); s.setAttribute('height', '26');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M7 4.5v15l13-7.5z'); p.setAttribute('fill', 'currentColor'); s.append(p);
    return s;
  };

  function videoMedia(item) {
    const m = item.media || {};
    if (m.provider === 'file') {
      return h('video', { controls: true, preload: 'none', playsinline: true, poster: item.thumb_url || null, 'aria-label': item.title }, h('source', { src: m.url }));
    }
    if ((m.provider === 'youtube' || m.provider === 'vimeo') && m.id) {
      const src = m.provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.id)}?autoplay=1&rel=0&playsinline=1`
        : `https://player.vimeo.com/video/${encodeURIComponent(m.id)}?autoplay=1`;
      const btn = h('button', { class: 'piece__play', type: 'button', 'aria-label': `הפעלת סרטון: ${item.title}` },
        item.thumb_url ? h('img', { src: item.thumb_url, alt: '', loading: 'lazy' }) : null, h('span', null, PLAY_ICON()));
      btn.addEventListener('click', () => {
        const frame = h('iframe', { src, title: item.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy' });
        btn.replaceWith(frame);
        frame.focus();
      });
      return btn;
    }
    return item.thumb_url ? h('img', { src: item.thumb_url, alt: item.title, loading: 'lazy' }) : null;
  }

  function beforeAfter(item) {
    const wrap = h('div', { class: 'ba', dir: 'ltr' },
      h('img', { src: item.after_url, alt: `${item.title}: אחרי`, loading: 'lazy' }),
      h('img', { class: 'ba__before', src: item.before_url, alt: `${item.title}: לפני`, loading: 'lazy' }),
      h('div', { class: 'ba__handle' }), h('span', { class: 'ba__lab ba__lab--b' }, 'לפני'), h('span', { class: 'ba__lab ba__lab--a' }, 'אחרי'));
    const range = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': `השוואת לפני ואחרי: ${item.title}` });
    range.addEventListener('input', () => wrap.style.setProperty('--pos', `${range.value}%`));
    wrap.append(range);
    return wrap;
  }

  function pieceEl(item) {
    let media;
    if (item.kind === 'before_after' && item.before_url && item.after_url) media = beforeAfter(item);
    else if (item.kind === 'thumbnail') {
      const src = item.thumb_url || (item.media && item.media.url);
      media = src ? h('img', { src, alt: item.title, loading: 'lazy' }) : null;
    } else media = videoMedia(item);
    return h('article', { class: `piece${item.kind === 'short' ? ' piece--short' : ''}` },
      h('div', { class: 'piece__media' }, media),
      h('div', { class: 'piece__body' },
        h('h3', null, item.title),
        item.description ? h('p', null, item.description) : null,
        item.tags && item.tags.length ? h('ul', { class: 'tags' }, item.tags.map((t) => h('li', null, t))) : null));
  }

  function placeholderEl(label, kind) {
    return h('article', { class: `piece piece--ph${kind === 'short' ? ' piece--short' : ''}`, 'aria-label': 'מציין מקום' },
      h('div', { class: 'piece__media' }, h('span', { class: 'badge' }, 'מציין מקום'), h('span', null, label)),
      h('div', { class: 'piece__body' }, h('h3', null, 'העבודות שלכם יופיעו כאן'), h('p', null, 'מקום שמור. הוסיפו פרויקטים אמיתיים מלוח הבקרה של הבעלים.')));
  }

  function renderWork(items) {
    const grid = $('#work-grid');
    if (!grid) return;
    const filters = $('#work-filters');
    grid.replaceChildren();
    filters.replaceChildren();
    if (!items.length) {
      [['עריכת וידאו', 'video'], ['עיצוב תמונה ממוזערת', 'thumbnail'], ['עריכת סרטון קצר', 'short']].forEach(([l, k]) => grid.append(placeholderEl(l, k)));
      filters.hidden = true;
      return;
    }
    const kinds = [...new Set(items.map((i) => i.kind))];
    const draw = (kind) => {
      grid.replaceChildren(...items.filter((i) => kind === 'all' || i.kind === kind).map(pieceEl));
      $$('button', filters).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    };
    if (kinds.length > 1) {
      filters.hidden = false;
      [['all', 'הכול'], ...kinds.map((k) => [k, KIND_LABEL[k]])].forEach(([k, l]) =>
        filters.append(h('button', { type: 'button', 'data-kind': k, 'aria-pressed': 'false', onclick: () => draw(k) }, l)));
    } else filters.hidden = true;
    draw('all');
  }

  if ($('#work-grid')) {
    fetch('/api/portfolio').then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => renderWork(d.items || []))
      .catch(() => { $('#work-grid').replaceChildren(h('p', { class: 'muted' }, 'לא הצלחנו לטעון את תיק העבודות כרגע. נסו לרענן בעוד רגע.')); });
  }

  /* ---------------- privacy dialog ---------------- */
  const dlg = $('#privacy');
  const openPrivacy = () => (typeof dlg.showModal === 'function' ? dlg.showModal() : dlg.setAttribute('open', ''));
  $('#open-privacy').addEventListener('click', openPrivacy);
  $('#open-privacy-2').addEventListener('click', openPrivacy);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------------- intake form ---------------- */
  const form = $('#lead-form');
  const statusEl = $('#form-status');
  const submitBtn = $('#submit-btn');
  const successEl = $('#form-success');
  let token = '';
  let idemKey = uuid();
  let submitting = false;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  }
  function loadToken() {
    fetch('/api/form-token').then((r) => r.json()).then((d) => { token = d.token || ''; }).catch(() => { token = ''; });
  }
  loadToken();

  // contact method -> input hints
  const CONTACT = {
    email: { type: 'email', mode: 'email', ph: 'you@example.com', ac: 'email', dir: 'ltr' },
    whatsapp: { type: 'text', mode: 'tel', ph: '+972 50 123 4567', ac: 'tel', dir: 'ltr' },
    discord: { type: 'text', mode: 'text', ph: 'username', ac: 'off', dir: 'ltr' },
    telegram: { type: 'text', mode: 'text', ph: '@username', ac: 'off', dir: 'ltr' },
    instagram: { type: 'text', mode: 'text', ph: '@username', ac: 'off', dir: 'ltr' },
    other: { type: 'text', mode: 'text', ph: 'איך אפשר ליצור איתכם קשר?', ac: 'off', dir: 'rtl' },
  };
  const cm = $('#f-contact-method');
  const cv = $('#f-contact-value');
  cm.addEventListener('change', () => {
    const c = CONTACT[cm.value];
    cv.type = c.type; cv.inputMode = c.mode; cv.placeholder = c.ph; cv.autocomplete = c.ac; cv.dir = c.dir;
  });

  const val = (name) => (form.elements[name] ? form.elements[name].value.trim() : '');
  const checkedVal = (name) => { const el = form.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };

  // conditional sections
  function syncConditional() {
    const service = checkedVal('service');
    $$('.cond', form).forEach((c) => { c.hidden = !c.dataset.for.split(' ').includes(service); });
    const so = $('#f-service-other');
    so.hidden = service !== 'other';
    $('#f-category-other').hidden = checkedVal('category') !== 'other';
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'service' || e.target.name === 'category') syncConditional();
  });
  syncConditional();

  // errors
  const errTarget = (name) => $(`#err-${name}`);
  function setErr(name, msg) {
    const p = errTarget(name);
    if (p) p.textContent = msg || '';
    const field = form.querySelector(`[name="${name}"]`);
    if (field && field.type !== 'radio' && field.type !== 'checkbox') field.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const wrap = form.querySelector(`.field[data-field="${name}"]`);
    if (wrap) { if (msg) wrap.setAttribute('data-invalid', ''); else wrap.removeAttribute('data-invalid'); }
    if (name === 'service_other') { const so = $('#f-service-other'); so.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
  }
  const FIELD_ORDER = ['name', 'contact_value', 'channel_url', 'category', 'service', 'service_other', 'collab', 'payment_method', 'start_timing', 'budget', 'consent'];
  const clearAll = () => FIELD_ORDER.forEach((n) => setErr(n, ''));
  form.addEventListener('input', (e) => { if (e.target.name) setErr(e.target.name, ''); if (e.target.name === 'service_other') setErr('service_other', ''); });
  form.addEventListener('change', (e) => { if (e.target.name) setErr(e.target.name, ''); });

  function validUrl(raw) {
    let s = raw.trim();
    if (!s) return false;
    if (/^@[\w.-]{2,50}$/.test(s)) return true;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return /^https?:$/.test(u.protocol) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname) && !/^\d+(\.\d+){3}$/.test(u.hostname);
    } catch { return false; }
  }

  function validate() {
    const e = {};
    if (!val('name')) e.name = 'ספרו לי איך לקרוא לכם.';
    const method = cm.value;
    const c = val('contact_value');
    if (!c) e.contact_value = 'נא להזין פרטי קשר.';
    else if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(c)) e.contact_value = 'נא להזין כתובת אימייל תקינה.';
    else if (method === 'whatsapp' && !/^\+?\d{7,15}$/.test(c.replace(/[\s().-]/g, ''))) e.contact_value = 'נא להזין מספר טלפון תקין, כולל קידומת מדינה.';
    else if (!['email', 'whatsapp'].includes(method) && c.length < 3) e.contact_value = 'נא להזין את שם המשתמש שלכם.';
    if (!val('channel_url')) e.channel_url = 'נא להוסיף קישור לערוץ או לפרופיל שלכם.';
    else if (!validUrl(val('channel_url'))) e.channel_url = 'זה לא נראה כמו קישור תקין (לדוגמה: youtube.com/@yourchannel).';
    if (!checkedVal('category')) e.category = 'נא לבחור על מה הערוץ שלכם.';
    const service = checkedVal('service');
    if (!service) e.service = 'נא לבחור מה אתם צריכים.';
    else if (service === 'other' && val('service_other').length < 5) e.service_other = 'נא לתאר במילים ספורות מה אתם צריכים.';
    if (!checkedVal('collab')) e.collab = 'נא לבחור סוג שיתוף פעולה.';
    if (!checkedVal('payment_method')) e.payment_method = 'נא לבחור איך תעדיפו לשלם.';
    if (!val('start_timing')) e.start_timing = 'נא לבחור מתי תרצו להתחיל.';
    if (!val('budget')) e.budget = 'נא לבחור תקציב משוער.';
    if (!form.elements.consent.checked) e.consent = 'נא לאשר כדי שאוכל ליצור איתכם קשר בנוגע לפנייה.';
    return e;
  }

  function showErrors(errors) {
    clearAll();
    Object.entries(errors).forEach(([k, v]) => setErr(k, v));
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (!first) return;
    const target = first === 'service_other' ? $('#f-service-other')
      : form.querySelector(`input[name="${first}"]`) || form.querySelector(`[name="${first}"]`);
    if (target) { target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); target.focus({ preventScroll: true }); }
  }

  function setStatus(msg, ok) { statusEl.textContent = msg || ''; statusEl.classList.toggle('ok', !!ok); }
  function setBusy(b) {
    submitting = b;
    submitBtn.disabled = b;
    submitBtn.setAttribute('aria-busy', String(b));
    $('.btn__label', submitBtn).textContent = b ? 'שולח…' : 'שליחת פנייה';
  }

  function payload() {
    const service = checkedVal('service');
    const visible = (cond) => !!$(`.cond[data-for~="${service}"] [name="${cond}"]`, form);
    const p = {
      name: val('name'), contact_method: cm.value, contact_value: val('contact_value'), channel_url: val('channel_url'),
      category: checkedVal('category'), category_other: val('category_other'),
      service, service_other: service === 'other' ? val('service_other') : '',
      collab: checkedVal('collab'), payment_method: checkedVal('payment_method'),
      videos_per_month: val('videos_per_month'), start_timing: val('start_timing'), budget: val('budget'), details: val('details'),
      platforms: $$('input[name="platforms"]:checked', form).map((i) => i.value),
      consent: form.elements.consent.checked,
      company_website: val('company_website'), form_token: token, idem_key: idemKey,
    };
    ['video_length', 'raw_footage', 'style_ref', 'video_topic', 'thumb_refs'].forEach((k) => { if (visible(k)) p[k] = val(k); });
    return p;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submitting) return;
    setStatus('');
    const errors = validate();
    if (Object.keys(errors).length) { showErrors(errors); setStatus('נא לבדוק את השדות המסומנים.'); return; }
    clearAll();
    setBusy(true);
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON error page */ }
      if (res.ok && data.ok) {
        $('#success-title').textContent = `תודה, ${val('name').split(/\s+/)[0]}. הפנייה שלכם התקבלה.`;
        form.hidden = true;
        successEl.hidden = false;
        successEl.focus();
        successEl.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      } else if (res.status === 422 && data.errors) {
        showErrors(data.errors);
        setStatus('נא לבדוק את השדות המסומנים.');
      } else if (res.status === 429) {
        setStatus(data.error || 'נשלחו יותר מדי פניות מהחיבור הזה. נסו שוב מאוחר יותר.');
      } else {
        setStatus('מצטערים, לא הצלחנו לשלוח את הפנייה ושום דבר לא נשמר. נסו שוב בעוד רגע.');
      }
    } catch {
      setStatus('לא הצלחנו להגיע לשרת ולכן לא נשלח דבר. בדקו את החיבור ונסו שוב. התשובות שלכם עדיין כאן.');
    } finally {
      setBusy(false);
    }
  });

  $('#form-again').addEventListener('click', () => {
    form.reset();
    cm.dispatchEvent(new Event('change'));
    syncConditional();
    clearAll();
    setStatus('');
    idemKey = uuid();
    loadToken();
    successEl.hidden = true;
    form.hidden = false;
    form.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  // Convenience: after a CTA jump, focus the first field on devices with a real pointer (avoids popping the keyboard on phones)
  $$('a[href="#start"]').forEach((a) => a.addEventListener('click', () => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) setTimeout(() => $('#f-name').focus({ preventScroll: true }), 650);
  }));
})();
