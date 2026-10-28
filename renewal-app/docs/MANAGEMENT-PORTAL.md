# ICDD Management Portal

The existing license tracker is now one module in the private management portal. The deployment URL, sign-in system, license data, renewal history, saved recipients, two-month renewal schedule and Gmail delivery queue stay compatible with the existing worker.

## Start using the portal

1. Under **Teams & branches**, add the actual IT teams, head office departments and branches. No sample business records or branch names are installed in production.
2. Under **Users & access**, add the people who will own work. Add at least one independent **Control reviewer** or admin, different from the creator and accountable owner of the work they review.
3. Add controls to the library. A reviewer activates each control. Use **Linked → Run a control check** to create a check against an active control.
4. Create changes, exceptions, findings, actions, risks and incidents as needed. Give every record an owner, team, priority and due or review date. Link follow-up actions to the source record and, where relevant, to a license or asset.
5. Attach evidence, record the outcome, submit work and have the assigned reviewer verify closure. Keep progress notes under **History**.
6. Use the management dashboard for due work and review decisions. Filter **Management reports** by area, team and due date, then export CSV or print.

## Workflows

| Register | Main workflow |
| --- | --- |
| Change requests | Draft → Submitted → Approved → Scheduled → In progress → Implemented → Closed |
| Exceptions, findings and actions | Open → In progress → Pending review → Closed |
| Control library | Draft → Active → Retired |
| Control checks | Planned → In progress → Pending review → Closed |
| Risks | Identified → Assessing → Treatment → Monitoring → Closed |
| Incidents | Open → In progress → Resolved → Closed |

Changes require impact, implementation, testing and rollback plans plus planned dates before submission. After submission, scope and assignments are locked; outcome and post-implementation notes remain editable. Withdraw a request for revision to change its scope and obtain approval again. Both normal and emergency changes follow recorded approval; an emergency category does not silently bypass review.

Completion and review require the relevant outcome, root cause or test result. Supporting evidence is required for operational completion and closure. Review decisions require a note. Only the assigned independent reviewer can approve or verify. The creator and accountable owner cannot approve their own work, including when they are administrators. Editing pending work returns it for resubmission. Revising an active control returns it to draft.

Open linked work must be closed before its parent can be closed or retired. Cyclic relationships are rejected. Archive is available to administrators only after closure or retirement; records can be restored. There is no hard-delete action.

## Access

| Role | Capabilities |
| --- | --- |
| Owner / Admin | Manage people, teams, settings, licenses and control records; independently review assigned work |
| Editor | Maintain licenses and control records; submit work for independent review |
| Control reviewer | Maintain control records and review assigned independent work; read-only license access |
| View only | Read records, histories and evidence; export reports |

All active workspace members can read the business registers across teams. Teams are reporting and assignment groups, not security boundaries. Every protected API request rechecks the verified session and workspace membership. No user roles or existing memberships are changed automatically by this upgrade.

## Integrity and limits

- PostgreSQL transactions save records, audit events and request receipts together. Version checks reject stale saves. Request receipts bind an idempotency key to the actor, action and exact payload.
- Database triggers reject updates and deletes to decision-history events and evidence. Privileged database administrators retain infrastructure access; the portal does not promise protection against a database owner changing the database itself.
- Evidence is stored privately in Neon, delivered only after authentication, with forced download, no-store and nosniff headers. A SHA-256 hash is recorded with each file. Supported types: PDF, PNG, JPEG, plain text, CSV, DOCX and XLSX. File validation checks basic content signatures; this is not malware scanning. Open downloaded files using the organisation’s endpoint protection.
- Limits are 5 MB per evidence file, 20 files per record and 200 MB across the workspace. These explicit caps prevent unbounded attachment growth on the existing database plan. No new paid storage service is provisioned.
- Registers paginate 20 records at a time. History loads in pages of 30 events and shows the total. Detail views show the latest 50 linked records with the full linked count. CSV exports cover up to 10,000 matching records; larger results require narrower filters. Spreadsheet formula prefixes are neutralised.
- Risk scores are likelihood × impact, each on a 1–5 scale. These are management aids, not a declaration of regulatory compliance.
- Control frequency and review dates are maintained by the team. Creating a control does not automatically manufacture completed checks or findings. The dashboard provides in-app follow-up queues. Automatic email delivery remains the existing authorised **license renewal** workflow.

## Deployment and verification

This release uses additive migration `0003_icdd_management_portal`. Existing license and email tables are not rebuilt. The migration creates the management registers, teams, evidence, audit and idempotency tables. It is tracked through Drizzle.

Render's release gate first migrates the isolated Neon development branch and runs both test suites. The portal integration suite exercises independent approval, evidence gates, stale/concurrent saves, invalid links, archive/restore, suspended reviewers, audit immutability and filtered reporting. The renewal suite continues to check the license and Gmail queue contracts with a mocked sender. No real email is sent by tests. Only after these checks pass does the release gate apply production migrations. The health endpoint reports the portal ready only when the new tables exist.

Production: Neon project `red-mud-64374274`, branch `br-ancient-wildflower-b9usr1w6`, database `icdd_tracker`.

Development tests: branch `br-delicate-morning-b9h02lqb`. Synthetic test records are archived there after the run; test people and teams are suspended/inactivated. They are never inserted into production.

The existing Render URL stays in place so saved links and the renewal worker keep working. Source is under `renewal-app/` on branch `icdd-license-renewal-tracker` in the existing repository. Credentials remain in private platform settings.
