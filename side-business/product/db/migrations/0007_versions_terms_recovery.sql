CREATE TABLE "statement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"month" date NOT NULL,
	"driver_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"issued_on" date NOT NULL,
	"content" jsonb NOT NULL,
	"deemed_clause" boolean DEFAULT false NOT NULL,
	"subcontract" jsonb,
	"document_name" text,
	"link_nonce" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"received_ip_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "file_hash" text;--> statement-breakpoint
ALTER TABLE "month_closes" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "month_closes" ADD COLUMN "minutes_spent" integer;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "recovered_amount" integer;--> statement-breakpoint
ALTER TABLE "statement_versions" ADD CONSTRAINT "statement_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_records" ADD CONSTRAINT "terms_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_records" ADD CONSTRAINT "terms_records_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_records" ADD CONSTRAINT "terms_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_versions_unique" ON "statement_versions" USING btree ("tenant_id","statement_id","version");--> statement-breakpoint
CREATE INDEX "statement_versions_month" ON "statement_versions" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_records_unique" ON "terms_records" USING btree ("tenant_id","driver_id","version");