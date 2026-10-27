# ICDD License Renewal Tracker

Private software, hardware and service renewal tracking on Render with a Neon PostgreSQL database.

## Features

- The exact 14-column ICDD Excel/CSV import and export template, with row validation and duplicate matching before saving.
- A searchable register, renewal calendar, Ghana cedi amounts, archived records and full renewal history.
- Reminder emails beginning **two calendar months before expiry**, with optional day-based follow-ups and overdue repeats. Month-end dates clamp to the last valid day, so 30 April 2027 starts on 28 February 2027.
- Separate logs for provider acceptance, failure, retries and requests needing review. Acceptance is not a claim of inbox delivery.
- Passwordless email-code sign-in, with a server-enforced allowlist for workspace owners.

## Email setup

In **Email reminders**, enter a sender address on a verified Resend domain, a sending-only API key and the recipients. Save and send a test before enabling reminders. The current connected sending domains were not verified at migration time, so sending stays disabled until a working connection is supplied.

`Months before renewal` defaults to 2. Additional reminder days default to 30, 14, 7, 1 and 0. A value of 0 months enables day-based reminders only. Inactive, suspended, retired, cancelled and archived records are excluded. Imports inside the reminder window are included at the next check.

The API key is encrypted in PostgreSQL with AES-GCM using the runtime-only `EMAIL_SETTINGS_KEY`. Notification emails contain the item, vendor, owner and renewal date. Payments and notes are excluded. A lease, immutable request payloads and provider idempotency keys prevent duplicate requests. Uncertain requests beyond the provider retry window are held for review.

## Hosting

This app is deployed from the `icdd-license-renewal-tracker` branch in the existing technologies repository, under `renewal-app`. It is isolated from the other application's default branch. The Render web service runs Next.js; a Neon Function Trigger checks renewals daily at 08:00 UTC even when the website is closed. The Render account did not have billing details for a paid cron service, so the scheduled worker runs on Neon. Its source is in the sibling renewal-worker directory.

Required runtime settings are listed in `.env.example`. Set values only in Render's environment settings. PostgreSQL connections use certificate-validated TLS. Normal queries use the pooled Neon URL; Drizzle migrations use the direct URL. Never place credentials, licence data or email addresses in public source files.

`ADMIN_EMAILS` is the server-side allowlist. Sign-in codes are issued by Neon Auth using the same-origin Next.js auth proxy. Session and verified email checks are required on every protected API. Arbitrary signup, password and admin auth methods are not exposed by this app. Configure a dedicated production SMTP provider in Neon Auth when a verified sending domain is ready; the initial managed auth mailer uses Neon's shared sender.

`/api/reminders/run` and `/api/reminders/status` require an authorised owner session or the runtime `CRON_SECRET` in an Authorization bearer header. They are not public write endpoints. The health endpoint exposes connectivity only.

## Release checks

`scripts/check-release.mjs` applies the migration to the isolated Neon development branch, tests real PostgreSQL imports, transactions, history, owner restrictions, encryption and two-month reminder deduplication using synthetic records and a mocked mail provider, then applies migrations to production. Development test records are archived after each run; tests never send real email. The web build then runs `next build`.

The original register was empty at migration time. Sender, recipient and email connection setup remain in the app. No live licence records or payments were fabricated during the move.
