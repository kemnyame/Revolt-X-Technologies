CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"details" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"payload" text NOT NULL,
	"provider_id" text,
	"error" text,
	"attempts" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lease" (
	"id" integer PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"lease_until" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"sn" text NOT NULL,
	"name" text NOT NULL,
	"vendor" text NOT NULL,
	"license_type" text NOT NULL,
	"department" text NOT NULL,
	"purchase_date" text,
	"expiry_date" text,
	"quantity_purchased" bigint,
	"seat_count" bigint,
	"quantity_in_use" bigint,
	"status" text NOT NULL,
	"last_payment_date" text,
	"last_payment_minor" bigint,
	"notes" text NOT NULL,
	"match_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "request_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_events" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"expiry_date" text NOT NULL,
	"bucket" text NOT NULL,
	"recipient" text NOT NULL,
	"email_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" text PRIMARY KEY NOT NULL,
	"license_id" text NOT NULL,
	"previous_expiry" text,
	"next_expiry" text NOT NULL,
	"payment_date" text NOT NULL,
	"payment_minor" bigint,
	"notes" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_email" text NOT NULL,
	"reply_to" text NOT NULL,
	"recipients" text NOT NULL,
	"lead_days" text NOT NULL,
	"lead_months" integer DEFAULT 2 NOT NULL,
	"overdue_interval" integer NOT NULL,
	"enabled" integer NOT NULL,
	"encrypted_api_key" text,
	"job_last_checked" text,
	"job_last_result" text,
	"schedule_registered" integer NOT NULL,
	"last_test_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_created" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_match_key" ON "licenses" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "licenses_expiry" ON "licenses" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "licenses_department" ON "licenses" USING btree ("department");--> statement-breakpoint
CREATE INDEX "reminder_events_email" ON "reminder_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "renewals_license" ON "renewals" USING btree ("license_id");