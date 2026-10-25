# Revolt-X website: Render and Neon

The website uses a Node/Express server on Render and a separate PostgreSQL project on Neon. Public pages stay available when the database is unreachable.

## Build and run

1. Run `npm ci`.
2. Run `npm run build` to generate public pages from `data/site-content.json`.
3. Apply `db/migrations/001_initial.sql` on a direct database connection, or set `DATABASE_URL_UNPOOLED` and run `npm run migrate`.
4. Configure `DATABASE_URL` with the pooled application connection. Keep credentials out of source control.
5. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in protected service configuration. A first administrator is created only when the database has no administrators and the password has at least 12 characters. No public default password is used.
6. Run `npm start`. The default port is 10000. `PORT` or the preview CLI's `--port` option can override it.

Existing administrator password hashes and enquiry records can be imported into the same table structure when a readable backup is available. Migrating the structure does not recover records from an expired, inaccessible database. The old Render database has not been deleted or upgraded as part of this change.

The blueprint now expects a Neon connection rather than creating a new trial database. Existing Render resources must be reviewed before applying a Blueprint deletion plan; committing this file alone does not delete the retained database.

## Checks

- `npm test` checks page availability, unavailable-database responses and automatic recovery.
- `scripts/verify-neon.cjs` accepts a JSON object containing `databaseUrl` on stdin. Run only against an isolated verification branch. It creates clearly labelled test enquiries and a test administrator if none exists, then checks sign-in, saved enquiries, follow-up updates, the assistant, the guide and sign-out. It never prints credentials.
- `/api/health` reports website availability and includes `status: degraded` while the database is offline. This is the Render health-check path.
- `/api/health/database` returns 503 when database features are unavailable and 200 when the database responds.

The site uses responsive images, keyboard navigation, readable control contrast and reduced-motion support. Edit shared copy in `data/site-content.json`, shared layouts in `scripts/build-site.cjs`, styles in `public/css/site.css` and interactions in `public/js/app.js`.
