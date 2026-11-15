# Revolt-X Warehouse

A multi-workspace warehouse system. The web interface records inventory and storage locations, inbound shipments, cash and Mobile Money sales, credit sales and collections, pending and settled cheques, expenses, users and audit entries.

## Run locally

Use Node.js 22 or 24 and a dedicated PostgreSQL database. Run `npm install`, `npm test` and `npm run check`. Set the variables in `.env.example` in your shell, then run `npm start`. The app creates its initial tables on startup, and `/health` verifies the database connection. Use a dedicated database for local development and a different database for live data.

## Business onboarding

1. Create a business workspace. Save its code and your one-time recovery code in a password manager.
2. Add products with their SKU, location, reorder point and default unit prices. Set units per box and, if applicable, boxes per carton. When reviewing stock, the system converts the total units to full cartons, full boxes and loose units.
3. Receive opening stock or imports under **Inbound stock**. Enter units, boxes and cartons in any combination. A receipt uses the unit cost and updates availability immediately.
4. Use **Users & access** to create a one-time invitation for each employee. Send each link privately. Role changes and deactivation revoke existing sessions.
5. Open a sale to record collections, clear or reject a cheque, or print its receipt. Each cleared payment has its own receipt. Goods received receipts and sales records also offer **Print / Save PDF**. Configure the business address and phone under **Settings**.
6. Use **Reports** for stock, sales, collections, received shipments, credit aging, cheques and expenses. Exports follow the current report filters.
7. Open **End of day**, select the business date, and record the opening and counted cash to save a reconciliation with the report values at that time. The cash estimate uses cleared cash payments and recorded cash expenses. Reversals require a reason and leave the original document in the history.

The demo uses fictional data in a private, expiring workspace. Opening a demo while signed in to a business requires signing out first. The application records payments collected elsewhere. It does not charge cards, move Mobile Money, deposit cheques, issue tax invoices or replace a general ledger. Catalogue cost supports an indicative stock value, not FIFO accounting.

For customer rollout, confirm access roles, local tax and invoice requirements, backup restoration, account recovery and the expected hosting capacity. Set `ALLOW_SIGNUP=0` after provisioning if registrations should be closed. `ENABLE_DEMO=0` disables the demo for a deployment. Each workspace has one currency and one stock ledger with bin locations.
