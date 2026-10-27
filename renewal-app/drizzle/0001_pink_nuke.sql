CREATE TABLE "workspace_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"user_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"last_sign_in_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_users_email" ON "workspace_users" USING btree ("email");