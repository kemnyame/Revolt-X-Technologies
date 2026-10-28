CREATE TABLE "portal_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text,
	"action" text NOT NULL,
	"note" text NOT NULL,
	"actor" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_records" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"module" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"unit_id" text NOT NULL,
	"area" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"owner_email" text NOT NULL,
	"reviewer_email" text NOT NULL,
	"due_date" text NOT NULL,
	"details" jsonb NOT NULL,
	"license_id" text,
	"related_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "portal_units" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_events" ADD CONSTRAINT "portal_events_record_id_portal_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."portal_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_evidence" ADD CONSTRAINT "portal_evidence_record_id_portal_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."portal_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_records" ADD CONSTRAINT "portal_records_unit_id_portal_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."portal_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_records" ADD CONSTRAINT "portal_records_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_event_record_time" ON "portal_events" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "portal_event_time" ON "portal_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "portal_evidence_record" ON "portal_evidence" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_reference_unique" ON "portal_records" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "portal_module_status_due" ON "portal_records" USING btree ("module","status","due_date");--> statement-breakpoint
CREATE INDEX "portal_unit_area" ON "portal_records" USING btree ("unit_id","area");--> statement-breakpoint
CREATE INDEX "portal_owner_due" ON "portal_records" USING btree ("owner_email","due_date");--> statement-breakpoint
CREATE INDEX "portal_related" ON "portal_records" USING btree ("related_id");--> statement-breakpoint
CREATE INDEX "portal_updated" ON "portal_records" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_unit_name_area" ON "portal_units" USING btree ("name","area");
--> statement-breakpoint
-- Decision history and evidence are append-only, including at the SQL boundary.
CREATE FUNCTION icdd_portal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ICDD decision history and evidence are append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER portal_events_immutable BEFORE UPDATE OR DELETE ON portal_events FOR EACH ROW EXECUTE FUNCTION icdd_portal_immutable();
--> statement-breakpoint
CREATE TRIGGER portal_evidence_immutable BEFORE UPDATE OR DELETE ON portal_evidence FOR EACH ROW EXECUTE FUNCTION icdd_portal_immutable();
--> statement-breakpoint
ALTER TABLE portal_records ADD CONSTRAINT portal_related_record_fk FOREIGN KEY (related_id) REFERENCES portal_records(id);
--> statement-breakpoint
ALTER TABLE portal_records ADD CONSTRAINT portal_no_self_link CHECK (related_id IS NULL OR related_id <> id);
