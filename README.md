# Revolt-X Technologies website

A responsive company website with plain-language service pages, a broad company layout with selective glass surfaces, a custom Adriana monogram, original brand imagery, a searchable solutions catalogue, an enquiry form, Adriana website guidance and a private administration area.

## Main files

- `data/site-content.json`: solution descriptions and common questions.
- `scripts/build-site.cjs`: shared navigation, layouts and static page generation.
- `public/css/site.css`: core layouts and accessible controls.
- `public/css/enterprise.css`: midnight plum, amber, lilac and sage styling, responsive page layouts, sticky section navigation, motion and reduced-transparency fallbacks.
- `public/assets/adriana-mark.svg`: custom Adriana monogram.
- `public/js/app.js`: mobile menus, search, keyboard-accessible journey tabs, a manual examples carousel, section progress, forms and Adriana.
- `public/admin/`: responsive enquiry administration.
- `server.js`: validated HTTP APIs, administrator sessions and database resilience.
- `db/migrations/`: versioned PostgreSQL schema.

Run `npm ci`, `npm run build` and `npm test`. See `README-RENDER.md` for database configuration and deployment.
