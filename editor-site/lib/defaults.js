// Default (editable) configuration. Everything here can be changed from the owner dashboard.
// Pricing values are SAMPLE numbers only until the owner ticks "These are my real rates".

export const DEFAULT_SITE = {
  brand_name: 'Blackx Studio',
  hero_headline: 'התוכן שלכם ראוי לעריכה טובה יותר.',
  hero_sub: 'עריכת וידאו מקצועית ליוטיוב ותמונות ממוזערות מותאמות אישית, שמעוצבות סביב התוכן, הקהל והסגנון שלכם.',
  about_title: 'הסיפור מאחורי העריכה.',
  about_text:
    'Blackx Studio הוא סטודיו לעריכת וידאו ועיצוב תמונות ממוזערות שעובד באופן אישי עם יוצרים שאכפת להם מהערוץ שלהם.\n\nאנחנו מתמקדים בקצב, בפרטים הקטנים ובעבודה שמתאימה לסגנון שלכם ולא לתבנית. המחירים הוגנים, התקשורת ישירה, ומה שהכי מעניין אותנו הוא לבנות קשרי עבודה לטווח ארוך.',
  skills: [],
  profile_image_url: '',
  privacy_email: '',
};

export const DEFAULT_BUSINESS = {
  contact_email: '',
  whatsapp: '', // digits only, with country code, e.g. 15551234567
  show_whatsapp_public: false, // show a "message me on WhatsApp" link under the inquiry form
  preferred_channel: 'email', // email | whatsapp | discord | telegram | instagram | other
  availability: 'open', // open | limited | closed
  availability_note: '',
  min_budget: 0,
  weekly_capacity_hours: 30,
  target_hourly_rate: 0,
  accepted_payments: 'visa,mastercard,amex,paypal,applepay,googlepay,bit,bank', // comma-separated payment methods shown on the public site
};

export const DEFAULT_NOTIFICATIONS = { email: true, webhook: true, include_spam: false };

export const DEFAULT_SCORING = {
  weights: { channel: 15, service: 10, frequency: 15, recurring: 15, budget: 15, timing: 10, details: 10, capacity: 10 },
  thresholds: { high: 70, review: 40 },
};

export const DEFAULT_PRICING = {
  currency: 'USD',
  is_real: false, // false => every estimate is labelled as using SAMPLE prices
  editing: {
    mode: 'fixed', // fixed | quote
    base_price: 100,
    base_minutes: 10,
    extra_per_minute: 6,
    quote_over_minutes: 60,
    hours_base: 3,
    hours_per_extra_minute: 0.25,
  },
  short_form: { mode: 'fixed', price_each: 25, hours_each: 0.75 },
  thumbnail: { mode: 'fixed', price_each: 30, hours_each: 1, volume_threshold: 5, volume_discount_pct: 10 },
  bundle_discount_pct: 10,
  complexity: { simple: 0.85, standard: 1, advanced: 1.4 },
  rush_pct: 30,
  recurring: { discount_pct: 10, min_items: 4, monthly_minimum: 0 },
  addons: [
    { key: 'captions', label: 'כתוביות מונפשות', price: 15, unit: 'per_item', hours: 0.5 },
    { key: 'extra_revision', label: 'סבב תיקונים נוסף', price: 20, unit: 'flat', hours: 0.5 },
  ],
};
