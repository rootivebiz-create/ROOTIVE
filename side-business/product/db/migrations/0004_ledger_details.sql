CREATE TABLE "transfer_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"transfer_date" date NOT NULL,
	"executed_on" date,
	"statement_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"file_name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "basis" text;--> statement-breakpoint
ALTER TABLE "deduction_rules" ADD COLUMN "agreed_on" date;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "started_on" date;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "end_on" date;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "end_noticed_on" date;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "registration_checked_on" date;--> statement-breakpoint
ALTER TABLE "payment_notices" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "payment_notices" ADD COLUMN "fee_deducted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_overrides" ADD COLUMN "agreed_on" date;--> statement-breakpoint
ALTER TABLE "rate_overrides" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "our_qty" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "their_qty" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "our_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "their_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "statement_confirmations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_confirmations" ADD COLUMN "hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_messages" ADD COLUMN "line_key" text;--> statement-breakpoint
ALTER TABLE "statement_messages" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_batches_month" ON "transfer_batches" USING btree ("tenant_id","month");--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;