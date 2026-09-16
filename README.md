# Revolt-X Technologies Commercial Platform v2

Production-oriented Node.js website with a public commercial site, 10 solution pages, Business Assistant, Intelligence Advisor, demo-request workflow, SQLite database and secure administration portal.

## Run locally

Requires Node.js 22+.

1. Copy `.env.example` to `.env` and use its values in your shell/hosting environment. This project intentionally does not auto-load `.env` to avoid an extra dependency.
2. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first production start.
3. Run `npm install`.
4. Run `npm start`.
5. Public website: `http://localhost:3000`
6. Admin: `http://localhost:3000/admin/`

If no admin environment variables are supplied on the very first local run, the development fallback is `admin@revoltx.local` / `ChangeMe123!`. Change it immediately in Admin > Security. Never use the fallback in production.

## Database

The application uses Node 22's built-in SQLite driver. Default local database: `data/revoltx.db`.

Tables include administrators, secure sessions, demo requests, Business Assistant logs, Intelligence Advisor logs and settings. WAL mode is enabled.

For Railway or another ephemeral container host, mount a persistent volume and set `DATABASE_PATH=/data/revoltx.db`. Without persistent storage, database data may disappear when the container is replaced.

## Railway deployment

The package includes `Dockerfile` and `railway.json`.

Set these Railway variables:

- `NODE_ENV=production`
- `ADMIN_EMAIL=<your admin email>`
- `ADMIN_PASSWORD=<strong unique initial password>`
- `DATABASE_PATH=/data/revoltx.db`

Create/mount a Railway Volume at `/data`, deploy the repository, then open `/api/health` to verify the application and `/admin/` for administration.

## Other hosting

Any host that supports Node.js 22 and persistent disk can run the app. `Procfile` is included for compatible platforms. The server listens on the host-provided `PORT`.

## Security notes

Admin passwords are scrypt-hashed. Admin sessions use random server-side tokens and HttpOnly, SameSite=Strict cookies; production cookies are Secure. Change the initial admin password, use HTTPS, protect hosting credentials, back up the SQLite database and do not commit `.env` or database files.

For a larger multi-admin deployment, the next hardening step should add rate limiting, CSRF protection, email-based password recovery/MFA, audit events and managed PostgreSQL.

## Business Assistant

Revolt-X questions are answered from the site's solution knowledge. General public questions currently use a limited Wikipedia lookup. For a full commercial AI assistant, connect the `/api/assistant` route to your chosen AI/search provider and keep provider API keys in hosting environment variables.


## V5 navigation and responsive update
Products and Solutions now use responsive mega menus. Revolt-X OS and Revolt-X AI retain dedicated pages. The 10 core commercial offerings are positioned as Solutions, while packaged applications are positioned as Products. Added favicon, platform carousel, compact product showcase, and mobile refinements.

## V9 update
Retains the established Revolt-X visual design while fixing mobile navigation, simplifying mega menus, expanding Adriana, improving product showcase imagery, and refining the footer.
