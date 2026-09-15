# Revolt-X: Render + PostgreSQL deployment

This build uses PostgreSQL instead of SQLite so application data is not stored on the web server's ephemeral filesystem.

## Local development
1. Install Node.js 22+ and PostgreSQL.
2. Create a database named `revoltx`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in your shell/environment. (This project intentionally does not load `.env` automatically.)
4. Run `npm install`.
5. Run `npm start`.
6. Open http://localhost:3000 and /admin/ for administration.

The server creates the required PostgreSQL tables automatically at startup and seeds the first administrator if no admin exists.

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
