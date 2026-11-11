# ICDD License Renewal Tracker

Private software, hardware and service renewal tracking on Render with a Neon PostgreSQL database.

## Features

- The exact 14-column ICDD Excel/CSV import and export template, with row validation and duplicate matching before saving.
- A searchable register, renewal calendar, Ghana cedi amounts, archived records and full renewal history.
- Reminder emails beginning **two calendar months before expiry**, with optional day-based follow-ups and overdue repeats. Month-end dates clamp to the last valid day, so 30 April 2027 starts on 28 February 2027.
- Separate logs for provider acceptance, failure, retries and requests needing review. Acceptance is not a claim of inbox delivery.
- Passwordless email-code sign-in, with owner, admin, editor and view-only roles. Admins add or suspend people in **Users & access**.

## Email setup

This tracker supports its owner's connected Gmail account. Gmail delivery uses the authorized ChatGPT Gmail connection, not Resend and not SMTP credentials copied into the website. The connected account must match the saved sender. A ChatGPT task checks the protected Neon queue hourly, submits each message through Gmail, and records the actual Gmail message ID. The task and both Gmail and Neon connections must stay enabled for delivery.

In **Email reminders**, choose Connected Gmail account, add any valid recipient addresses and enable reminders. Gmail does not require verifying a domain in Resend. Tests queue for the next delivery check; a queued message is not labeled accepted until Gmail returns a message ID. Gmail and other providers still apply their normal sending and delivery limits.

In **Users & access**, “Receive renewal emails” is selected when adding a user. Clear it for someone who only needs workspace access. Suspending a user removes their address from the reminder recipient list. Other recipients can be added directly in Email reminders without giving them login access. Up to 10 addresses can be saved.

`Months before renewal` defaults to 2. Additional reminder days default to 30, 14, 7, 1 and 0. A value of 0 months enables day-based reminders only. Inactive, suspended, retired, cancelled and archived records are excluded. Imports inside the reminder window are included at the next check.

The daily Neon Function check prepares immutable requests. The Gmail delivery task claims each request once, checks that its sender, recipient and records are still eligible, then acknowledges submission. Paused renewal reminders are held. Explicitly queued connection tests can still be sent while renewal reminders are paused. Interrupted or uncertain submissions are held for review instead of automatically resent. Message content is data, never instructions to the delivery task.

Payments, notes and seat counts stay in the tracker. Notifications contain the item, vendor, owner and renewal date. Gmail access tokens are never copied into this app, its database, source or task prompt. Resend remains an optional alternative for a verified company domain; its saved key is encrypted with AES-GCM using the runtime-only `EMAIL_SETTINGS_KEY`.

## Hosting

This app is deployed from the `icdd-license-renewal-tracker` branch in the existing technologies repository, under `renewal-app`. It is isolated from the other application's default branch. The Render web service runs Next.js; a Neon Function Trigger checks renewals daily at 08:00 UTC even when the website is closed. The Render account did not have billing details for a paid cron service, so the scheduled worker runs on Neon. Its source is in the sibling renewal-worker directory.

Required runtime settings are listed in `.env.example`. Set values only in Render's environment settings. PostgreSQL connections use certificate-validated TLS. Normal queries use the pooled Neon URL; Drizzle migrations use the direct URL. Never place credentials, licence data or email addresses in public source files.

`ADMIN_EMAILS` identifies the bootstrap owner. Active users added in the workspace can also sign in; their role and status are rechecked on every protected request. Owner access cannot be removed through user management. Sign-in codes are issued by Neon Auth using the same-origin Next.js auth proxy. Session and verified email checks are required on every protected API. Arbitrary signup, password and admin auth methods are not exposed by this app. Configure a dedicated production SMTP provider in Neon Auth when a verified sending domain is ready; the initial managed auth mailer uses Neon's shared sender.

`/api/reminders/run` and `/api/reminders/status` require an authorised owner/admin session or the runtime `CRON_SECRET` in an Authorization bearer header. They are not public write endpoints. The health endpoint exposes connectivity only.

## Release checks

`scripts/check-release.mjs` applies the migration to the isolated Neon development branch, tests real PostgreSQL imports, transactions, history, role permissions, user suspension, encryption and two-month reminder deduplication using synthetic records and a mocked mail provider, then applies migrations to production. Development test records are archived after each run; tests never send real email. The web build then runs `next build`.

Recipients may be any valid email address, whether or not they have tracker access. A manual connection test can target any address without changing the saved reminder list. Adding a workspace user does not send an invitation. Their renewal subscription is controlled by the Receive renewal emails checkbox. The Gmail option sends through the connected account. The Resend option requires a verified sending domain.

The original register was empty at migration time. Sender, recipient and reminder controls remain in the app. No live licence records or payments were fabricated during the move.
