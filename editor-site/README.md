# Video Editor & Thumbnail Designer: Client Site

Public landing page + 60-second intake form + private owner dashboard (lead inbox, scoring, pricing, quotes, profitability, portfolio, settings).
Node 22+, **zero npm dependencies**, SQLite database (built into Node).

## Run it

```bash
cd editor-site
cp .env.example .env        # optional: edit values
npm start                   # http://localhost:3000   dashboard: /admin
```

**First run:** the server log prints a one-time setup code. Open `/admin`, enter the code, your email and a password (10+ chars).
Alternatively set `OWNER_EMAIL` and `OWNER_PASSWORD` in `.env`, or run `npm run create-owner -- you@example.com "your long password"` (also resets a forgotten password).

## First 10 minutes in the dashboard

1. **Pricing & quotes**: replace the SAMPLE numbers with your real rates, tick "These are my real rates", Save. Until you do, every estimate is labelled SAMPLE.
2. **Settings → Site content**: your name, hero text, About text (in your own words), skills, profile photo, privacy contact email.
3. **Settings → Business**: contact email / WhatsApp, availability, weekly capacity, target hourly rate.
4. **Portfolio**: add real work (YouTube/Vimeo link, MP4 upload, thumbnails, before/after). With no items the site shows clearly labelled placeholders.
5. The **Setup checklist** on the Leads tab tracks what is left.

## Reviewing leads

Leads tab → click a lead: full submission, score breakdown, risk flags, suggested quote, profitability/capacity, private notes, status. Copy/Email/WhatsApp buttons and "Open channel". "Mark as spam" is reversible and never deletes; permanent deletion is only offered for spam/archived leads. Export all leads as CSV/JSON from the top of the tab.

## Notifications (optional; the dashboard works without them)

- **Email** (Resend): `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` (a verified sender in Resend).
- **Discord/Slack**: `NOTIFY_WEBHOOK_URL`.
Secrets live only in server environment variables. Failures are logged and never block a submission.

## Deploy

Needs a host that runs a Node process **with a persistent disk** (Render, Railway, Fly.io, a VPS). Not suitable for serverless/ephemeral filesystems.
- Start command `npm start`; set `DATA_DIR` to the persistent disk path (holds `app.db` and `uploads/`).
- Behind a proxy/PaaS set `TRUST_PROXY=1` and serve over HTTPS (session cookie becomes `Secure` automatically). Set `PUBLIC_URL`.
- **Backups:** `npm run backup` writes a consistent DB copy to `DATA_DIR/backups/`; also copy `DATA_DIR/uploads/`. CSV/JSON export is in the dashboard.

## Security summary (what is actually enforced)

Server-side owner auth (scrypt password hash, random server-side sessions, HttpOnly + SameSite=Strict cookie), CSRF token + same-origin check on every owner write, login throttling, all `/api/admin/*` routes check the session on the server, strict CSP, parameterised SQL, escaped output, upload type sniffing, body size limits.
Spam: server validation + length limits, hidden honeypot, signed form token with minimum-time check, per-IP rate limit (6/hour, stored as a keyed hash, not raw IP), duplicate detection, spam-wording check. Obvious spam is saved but auto-flagged (reviewable); suspicious ones go to "Needs Review". Small channels, low budgets and blank optional fields are never flagged.

## Tests

`npm test`: unit tests (pricing, scoring, validation, spam) plus an end-to-end run against a real server and temp database.

## Known limitations / needs your input

- Prices, name, about text, portfolio and contact details are placeholders until you enter them. Nothing is invented.
- SF Pro is used when installed (Apple devices); otherwise a close system font. To self-host a licensed copy, add `@font-face` rules in `public/styles.css` pointing at `public/fonts/`.
- The hero shows an interface illustration, labelled as not client work. No design reference videos/screenshots were attached, so the visual direction (near-black, off-white, orange accent) is my own; send references to refine.
- Single owner account. No built-in CAPTCHA (add one only if spam becomes a problem). Privacy notice is a plain-language draft, not legal advice; have it checked for your region.
- Data is a local SQLite file: back it up.
