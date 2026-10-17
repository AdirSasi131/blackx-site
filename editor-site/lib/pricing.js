// Pure pricing logic: no DB, no I/O, so it is easy to unit test.
// An estimate is a suggestion for the owner, never a final quote.

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const VIDEO_LENGTH_MINUTES = { shorts: 1, under_5: 4, '5_10': 8, '10_20': 15, '20_40': 30, '40_plus': 50 };
export const VIDEOS_PER_MONTH = { '1_2': 2, '3_5': 4, '6_10': 8, '10_plus': 12 };

export function estimate(input, pricing) {
  const p = pricing;
  const reasons = [];
  const assumptions = [];
  const lines = [];
  let hours = 0;
  let hoursKnown = true;

  const service = input.service || 'editing';
  const wantsEditing = service === 'editing' || service === 'both';
  const wantsThumbs = service === 'thumbnail' || service === 'both';
  const videos = Math.max(0, Math.floor(num(input.videos)));
  const minutes = Math.max(0, num(input.minutes, 10));
  const shorts = Math.max(0, Math.floor(num(input.shorts)));
  const thumbs = Math.max(0, Math.floor(num(input.thumbnails)));
  const complexity = ['simple', 'standard', 'advanced'].includes(input.complexity) ? input.complexity : 'standard';
  const CX = { simple: 'פשוט', standard: 'סטנדרטי', advanced: 'מתקדם' };
  const mult = num(p.complexity?.[complexity], 1);

  if (!p.is_real) assumptions.push('משתמשים במחירי דוגמה (SAMPLE). הזינו את התעריפים האמיתיים שלכם בכרטיסייה “מחיר והצעות מחיר” וסמנו “אלה הם התעריפים האמיתיים שלי”.');
  if (service === 'other') reasons.push('סוג השירות הוא “אחר”: נדרשת הצעת מחיר ידנית.');
  if (input.special) reasons.push('סומנו דרישות מיוחדות: נדרש ביקורת ידנית.');

  let core = 0; // editing + shorts + thumbnails, after complexity and per-line discounts
  let editingSubtotal = 0;
  let thumbSubtotal = 0;

  // Long-form editing
  if (wantsEditing && videos > 0) {
    if (p.editing.mode === 'quote') {
      reasons.push('עריכת וידאו מוגדרת כמצעת מחיר ידנית בהגדרות המחיר שלכם.');
      hoursKnown = false;
    } else {
      const extra = Math.max(0, minutes - p.editing.base_minutes);
      const each = (p.editing.base_price + extra * p.editing.extra_per_minute) * mult;
      const amount = r2(each * videos);
      editingSubtotal += amount;
      lines.push({
        label: `עריכת וידאו × ${videos}`,
        amount,
        detail: `${minutes} דקות לכל סרטון: ${p.editing.base_price} בסיס${extra ? ` + ${r1(extra)} דקות נוספות × ${p.editing.extra_per_minute}` : ''}${mult !== 1 ? `, × ${mult} ${CX[complexity]}` : ''}`,
      });
      hours += (p.editing.hours_base + extra * p.editing.hours_per_extra_minute) * mult * videos;
      if (minutes > p.editing.quote_over_minutes) reasons.push(`סרטונים שארוכים מ-${p.editing.quote_over_minutes} דקות נמצאים תחת הצעת מחיר ידנית.`);
    }
  }

  // Short-form editing
  if (wantsEditing && shorts > 0) {
    if (p.short_form.mode === 'quote') {
      reasons.push('עריכת סרטונים קצרים מוגדרת כמצעת מחיר ידנית בהגדרות המחיר שלכם.');
      hoursKnown = false;
    } else {
      const amount = r2(p.short_form.price_each * mult * shorts);
      editingSubtotal += amount;
      lines.push({ label: `עריכות קצרות × ${shorts}`, amount, detail: `${p.short_form.price_each} לכל אחת${mult !== 1 ? `, × ${mult} ${CX[complexity]}` : ''}` });
      hours += p.short_form.hours_each * mult * shorts;
    }
  }

  // Thumbnails
  if (wantsThumbs && thumbs > 0) {
    if (p.thumbnail.mode === 'quote') {
      reasons.push('עיצוב תמונות ממוזערות מוגדר כמצעת מחיר ידנית בהגדרות המחיר שלכם.');
      hoursKnown = false;
    } else {
      let amount = p.thumbnail.price_each * thumbs;
      let detail = `${p.thumbnail.price_each} לכל אחת`;
      if (p.thumbnail.volume_discount_pct > 0 && thumbs >= p.thumbnail.volume_threshold) {
        amount *= 1 - p.thumbnail.volume_discount_pct / 100;
        detail += `, −${p.thumbnail.volume_discount_pct}% החל מ-${p.thumbnail.volume_threshold}+`;
      }
      amount = r2(amount);
      thumbSubtotal += amount;
      lines.push({ label: `תמונות ממוזערות × ${thumbs}`, amount, detail });
      hours += p.thumbnail.hours_each * thumbs;
    }
  }

  core = editingSubtotal + thumbSubtotal;

  // Bundle discount: only when both services are actually priced
  if (editingSubtotal > 0 && thumbSubtotal > 0 && p.bundle_discount_pct > 0) {
    const d = -r2(core * (p.bundle_discount_pct / 100));
    lines.push({ label: 'הנחת חבילה', amount: d, detail: `${p.bundle_discount_pct}% הנחה על עריכה + תמונות ממוזערות` });
    core += d;
  }

  // Add-ons
  const itemCount = videos + shorts;
  for (const key of input.addons || []) {
    const a = (p.addons || []).find((x) => x.key === key);
    if (!a) continue;
    const qty = a.unit === 'per_item' ? Math.max(1, itemCount) : 1;
    const amount = r2(a.price * qty);
    lines.push({ label: a.label + (qty > 1 ? ` × ${qty}` : ''), amount, detail: a.unit === 'per_item' ? `${a.price} לכל סרטון/קצר` : 'תשלום אחיד' });
    core += amount;
    hours += num(a.hours) * qty;
  }

  // Rush
  if (input.rush && p.rush_pct > 0 && core > 0) {
    const d = r2(core * (p.rush_pct / 100));
    lines.push({ label: 'משלוח דחוף', amount: d, detail: `+${p.rush_pct}%` });
    core += d;
  }

  // Recurring package
  const totalItems = videos + shorts + thumbs;
  if (input.recurring) {
    assumptions.push('מחיר כחבילה חודשית שוטפת (הסכומים לחודש).');
    if (p.recurring.discount_pct > 0 && totalItems >= p.recurring.min_items && core > 0) {
      const d = -r2(core * (p.recurring.discount_pct / 100));
      lines.push({ label: 'הנחת מנוי', amount: d, detail: `${p.recurring.discount_pct}% עבור ${p.recurring.min_items}+ פריטים לחודש` });
      core += d;
    }
    if (p.recurring.monthly_minimum > 0 && core > 0 && core < p.recurring.monthly_minimum) {
      const d = r2(p.recurring.monthly_minimum - core);
      lines.push({ label: 'השלמה למינימום חודשי', amount: d, detail: `מינימום ${p.recurring.monthly_minimum}/חודש` });
      core += d;
    }
  }

  if (complexity !== 'standard') assumptions.push(`מורכבות מוגדרת כ-“${CX[complexity]}” (× ${mult}).`);
  if (input.rush) assumptions.push('ביקשו משלוח דחוף.');
  for (const a of input.assumptions || []) assumptions.push(a);

  const priced = lines.length > 0 && !reasons.some((r) => r.startsWith('סוג השירות'));
  if (!priced && reasons.length === 0) reasons.push('אין מה למחור מהמידע שניתן.');
  const needsManualReview = reasons.length > 0;

  return {
    currency: p.currency,
    recurring: !!input.recurring,
    lines,
    total: priced && core > 0 ? r2(core) : null,
    hours: hoursKnown && hours > 0 ? r1(hours) : null,
    needsManualReview,
    reasons,
    assumptions,
    sample: !p.is_real,
    disclaimer: 'הערכה בלבד: אינה הצעת מחיר סופית. אתם קובעים את המחיר הסופי.',
  };
}

// Map a stored lead to calculator inputs, recording every assumption made.
export function leadToEstimateInput(lead) {
  const assumptions = [];
  const recurring = lead.collab === 'recurring';
  const service = lead.service;
  let count;
  if (lead.videos_per_month && VIDEOS_PER_MONTH[lead.videos_per_month]) {
    count = recurring ? VIDEOS_PER_MONTH[lead.videos_per_month] : 1;
    if (!recurring) assumptions.push('פרויקט חד-פעמי: מחור עבור סרטון אחד.');
  } else if (recurring) {
    count = 4;
    assumptions.push('מספר סרטונים בחודש לא צוין: ההנחה היא 4.');
  } else {
    count = 1;
  }
  let minutes = 10;
  let shortForm = lead.video_length === 'shorts';
  if (lead.video_length && VIDEO_LENGTH_MINUTES[lead.video_length]) minutes = VIDEO_LENGTH_MINUTES[lead.video_length];
  else if (service === 'editing' || service === 'both') assumptions.push('אורך הסרטון לא צוין: ההנחה היא 10 דקות.');
  if (lead.start_timing === 'asap') assumptions.push('מעוניינים להתחיל בהקדם: כדאי לשקול תוספת משלוח דחוף.');
  if (lead.budget && lead.budget !== 'not_sure') assumptions.push('טווח התקציב שציין הלקוח אינו משמש לקביעת המחיר.');
  return {
    service,
    videos: shortForm ? 0 : count,
    shorts: shortForm ? count : 0,
    minutes,
    thumbnails: service === 'thumbnail' || service === 'both' ? count : 0,
    complexity: 'standard',
    recurring,
    rush: false,
    addons: [],
    special: false,
    assumptions,
  };
}

// Validate + normalise pricing coming from the dashboard. Throws {errors} on bad input.
export function normalizePricing(input, base) {
  const errors = {};
  const out = structuredClone(base);
  const n = (path, obj, key, { min = 0, max = 1e6 } = {}) => {
    if (obj?.[key] === undefined) return;
    const v = Number(obj[key]);
    if (!Number.isFinite(v) || v < min || v > max) errors[`${path}.${key}`] = `Must be a number between ${min} and ${max}.`;
    else return v;
  };
  const mode = (path, obj, tgt) => {
    if (obj?.mode === undefined) return;
    if (!['fixed', 'quote'].includes(obj.mode)) errors[`${path}.mode`] = 'Must be fixed or quote.';
    else tgt.mode = obj.mode;
  };
  const apply = (path, src, tgt, specs) => {
    for (const [key, opts] of Object.entries(specs)) {
      const v = n(path, src, key, opts);
      if (v !== undefined) tgt[key] = v;
    }
  };
  if (input.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(String(input.currency))) errors.currency = 'Use a 3-letter code like USD.';
    else out.currency = input.currency;
  }
  if (input.is_real !== undefined) out.is_real = !!input.is_real;
  mode('editing', input.editing, out.editing);
  apply('editing', input.editing, out.editing, {
    base_price: {}, base_minutes: { min: 1, max: 600 }, extra_per_minute: {}, quote_over_minutes: { min: 1, max: 1000 },
    hours_base: { max: 500 }, hours_per_extra_minute: { max: 50 },
  });
  mode('short_form', input.short_form, out.short_form);
  apply('short_form', input.short_form, out.short_form, { price_each: {}, hours_each: { max: 100 } });
  mode('thumbnail', input.thumbnail, out.thumbnail);
  apply('thumbnail', input.thumbnail, out.thumbnail, {
    price_each: {}, hours_each: { max: 100 }, volume_threshold: { min: 1, max: 1000 }, volume_discount_pct: { max: 100 },
  });
  if (input.bundle_discount_pct !== undefined) {
    const v = n('', input, 'bundle_discount_pct', { max: 100 });
    if (v !== undefined) out.bundle_discount_pct = v;
  }
  if (input.rush_pct !== undefined) {
    const v = n('', input, 'rush_pct', { max: 500 });
    if (v !== undefined) out.rush_pct = v;
  }
  apply('complexity', input.complexity, out.complexity, { simple: { min: 0.1, max: 10 }, standard: { min: 0.1, max: 10 }, advanced: { min: 0.1, max: 10 } });
  apply('recurring', input.recurring, out.recurring, { discount_pct: { max: 100 }, min_items: { min: 1, max: 1000 }, monthly_minimum: {} });
  if (input.addons !== undefined) {
    if (!Array.isArray(input.addons) || input.addons.length > 30) errors.addons = 'Up to 30 add-ons.';
    else {
      const seen = new Set();
      out.addons = [];
      input.addons.forEach((a, i) => {
        const label = String(a.label || '').trim().slice(0, 60);
        const price = Number(a.price);
        const hours = Number(a.hours || 0);
        const unit = a.unit === 'per_item' ? 'per_item' : 'flat';
        let key = String(a.key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).slice(0, 40) || `addon_${i}`;
        while (seen.has(key)) key += '_';
        seen.add(key);
        if (!label) errors[`addons.${i}.label`] = 'Name required.';
        if (!Number.isFinite(price) || price < 0 || price > 1e6) errors[`addons.${i}.price`] = 'Invalid price.';
        if (!Number.isFinite(hours) || hours < 0 || hours > 500) errors[`addons.${i}.hours`] = 'Invalid hours.';
        out.addons.push({ key, label, price, unit, hours });
      });
    }
  }
  if (Object.keys(errors).length) throw Object.assign(new Error('invalid pricing'), { errors });
  return out;
}

// Owner-entered profitability maths. Transparent and unit-testable.
export function profitability({ revenue, hours, costs }, { weeklyCapacityHours, committedHours, targetHourlyRate }) {
  const rev = revenue == null ? null : num(revenue);
  const hrs = hours == null ? null : num(hours);
  const c = num(costs, 0);
  const out = { revenue: rev, hours: hrs, costs: c, earningsAfterCosts: null, effectiveHourlyRate: null, capacity: null };
  if (rev != null) out.earningsAfterCosts = r2(rev - c);
  if (rev != null && hrs != null && hrs > 0) out.effectiveHourlyRate = r2((rev - c) / hrs);
  if (hrs != null && weeklyCapacityHours > 0) {
    const monthly = weeklyCapacityHours * 4.33;
    const after = committedHours + hrs;
    out.capacity = {
      monthlyCapacityHours: r1(monthly),
      committedHours: r1(committedHours),
      withThisProject: r1(after),
      fits: after <= monthly,
      overBy: after > monthly ? r1(after - monthly) : 0,
    };
  }
  out.targetHourlyRate = targetHourlyRate > 0 ? targetHourlyRate : null;
  return out;
}

export function projectPriority(scoreCategory, prof) {
  const target = prof.targetHourlyRate;
  const rate = prof.effectiveHourlyRate;
  const capacityBad = prof.capacity && !prof.capacity.fits;
  if (scoreCategory === 'Low priority' || (target && rate != null && rate < target * 0.6)) return capacityBad ? 'Low' : 'Low';
  if (scoreCategory === 'High priority' && !capacityBad && (!target || rate == null || rate >= target)) return 'High';
  return 'Medium';
}
