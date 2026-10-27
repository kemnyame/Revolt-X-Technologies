# ICDD daily renewal check

A Neon Function forwards a trusted daily trigger to the ICDD tracker on Render, then reads back the persisted result. It uses the same reminder engine as the app's Check now button. The two-calendar-month window, recipients, pause setting and encrypted email connection are read by the Render app from Neon PostgreSQL.

The `/cron` route validates the platform's trigger delivery with `parseTriggerDelivery`; public callers cannot supply Neon's trusted delivery headers. The `/run` route permits a manual service check with the server-only bearer credential. No credentials are stored in the source or archive. Set `CRON_SECRET` and `SITE_ORIGIN` through Neon Function environment settings.

The function slug is `renewalcheck`; the production trigger is `icdd-daily-renewals`, evaluated at `0 8 * * *` UTC. The Render account did not have billing details for a paid Render cron service, so the scheduled check runs on Neon while the website remains on Render.

Build with esbuild for Node.js 24, bundle this module and the Neon trigger parser to `index.mjs`, and zip that file at the archive root. The first deployment includes the ZIP; later environment-only updates can omit it. Keep all redirects manual so the service bearer cannot leave the configured tracker origin.
