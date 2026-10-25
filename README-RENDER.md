# Revolt-X: Render + PostgreSQL deployment

This build uses PostgreSQL instead of SQLite so application data is not stored on the web server's ephemeral filesystem.

## Local development
1. Install Node.js 22+ and PostgreSQL.
2. Create a database named `revoltx`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in your shell/environment. (This project intentionally does not load `.env` automatically.)
4. Run `npm install`.
5. Run `npm start`.
6. Open http://localhost:10000 and /admin/ for administration (or use the configured `PORT`).

The server creates the required PostgreSQL tables automatically at startup and seeds the first administrator if no admin exists.

## Availability during a database outage

The HTTP server starts independently of PostgreSQL. Public pages, Adriana's answers and solution recommendations remain available if the database is missing or unreachable. Activity logging is best effort; it does not block an assistant response.

- `/api/health` checks website availability and returns HTTP 200 with `status: "degraded"` and `database: "unavailable"` during an outage. Keep this as the Render health-check path so the public website remains reachable.
- `/api/health/database` returns HTTP 503 while database features are unavailable and checks connectivity once initialization succeeds.
- Demo submissions and admin APIs return HTTP 503 with a retry message while the database is unavailable. Failed submissions are not reported as saved, and the demo form keeps the visitor's entries.
- Database connection attempts and queries have five-second timeouts. Initialization retries every 30 seconds without restarting the website. After connectivity returns, existing database-backed features resume automatically.

This does not restore an expired database or recover its records. Restore the existing database or connect a durable PostgreSQL database separately. Do not replace the connection with an empty database and assume historical enquiries or administrator accounts have been recovered.

Run availability checks with `node --test tests/website-availability.test.js`. They exercise the actual HTTP server with no database, an unresolvable database hostname, and a controlled database outage/recovery. No live customer records or AI provider calls are used.

## Render Blueprint deployment
1. Push this entire folder to a GitHub repository.
2. Create a Render Blueprint and select the repository. Render reads `render.yaml`.
3. When prompted, enter strong values for `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Apply the Blueprint. It provisions the Node web service and PostgreSQL database and injects `DATABASE_URL` automatically.
5. When deployment completes, open the generated onrender.com URL.
6. Test `/api/health`, submit a demo request, then sign in at `/admin/`.

## Important free-tier note
Render's free web service can sleep after inactivity. Render's free PostgreSQL database is intended for evaluation and currently expires after 30 days. Do not treat the free database as permanent production storage. Before taking real customer data, upgrade the database or move `DATABASE_URL` to a durable PostgreSQL provider.

## Security
- Never commit `.env` or passwords.
- Change the initial admin password after first login.
- Production admin cookies are Secure, HttpOnly and SameSite=Strict.
- Use a custom domain and HTTPS before commercial launch.

