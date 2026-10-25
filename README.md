# Revolt-X Technologies website

A responsive company website with plain-language service pages, original brand imagery, a searchable solutions catalogue, an enquiry form, Adriana website guidance and a private administration area.

## Main files

- `data/site-content.json`: solution descriptions and common questions.
- `scripts/build-site.cjs`: shared navigation, layouts and static page generation.
- `public/css/site.css`: ivory, aubergine, copper, sage and lilac design system and responsive layouts.
- `public/js/app.js`: mobile menus, search, tabs, forms and Adriana.
- `public/admin/`: responsive enquiry administration.
- `server.js`: validated HTTP APIs, administrator sessions and database resilience.
- `db/migrations/`: versioned PostgreSQL schema.

Run `npm ci`, `npm run build` and `npm test`. See `README-RENDER.md` for database configuration and deployment.
