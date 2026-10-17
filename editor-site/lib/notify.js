// Optional notifications. Failures are logged and never block or fail a submission.
// Secrets come from environment variables only and are never sent to the browser.

export function notifyStatus() {
  return {
    email: !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_TO),
    webhook: !!process.env.NOTIFY_WEBHOOK_URL,
  };
}

const SERVICE = { editing: 'עריכת וידאו', thumbnail: 'עיצוב תמונות ממוזערות', both: 'עריכה + תמונות ממוזערות', other: 'אחר' };
const PAY = { card: 'כרטיס אשראי', paypal: 'PayPal', bit: 'Bit', bank: 'העברה בנקאית', not_sure: 'עדיין לא בטוח' };

export async function notifyNewLead(lead, prefs) {
  if (lead.is_spam && !prefs.include_spam) return;
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const link = base ? `${base}/admin` : '/admin';
  const subject = `פנייה חדשה: ${lead.name} (${SERVICE[lead.service] || lead.service})`;
  const text = [
    subject,
    `ציון: ${lead.score}/100 (${lead.score_category})${lead.is_spam ? ' [סומן אוטומטית כספאם]' : ''}`,
    `יצירת קשר: ${lead.contact_method}: ${lead.contact_value}`,
    `ערוץ: ${lead.channel_url}`,
    `שיטת תשלום מועדפת: ${PAY[lead.payment_method] || lead.payment_method || 'לא צוין'}`,
    `פתיחת לוח הבקרה: ${link}`,
  ].join('\n');

  const jobs = [];
  if (prefs.email && process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_TO) {
    jobs.push(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.NOTIFY_EMAIL_FROM || 'פניות חדשות <onboarding@resend.dev>',
          to: process.env.NOTIFY_EMAIL_TO.split(',').map((s) => s.trim()),
          subject,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      }).then((r) => { if (!r.ok) throw new Error(`Resend HTTP ${r.status}`); }),
    );
  }
  if (prefs.webhook && process.env.NOTIFY_WEBHOOK_URL) {
    jobs.push(
      fetch(process.env.NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // "content" is read by Discord, "text" by Slack
        body: JSON.stringify({ content: text, text }),
        signal: AbortSignal.timeout(10000),
      }).then((r) => { if (!r.ok) throw new Error(`Webhook HTTP ${r.status}`); }),
    );
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('[notify] failed:', r.reason?.message || r.reason);
}
