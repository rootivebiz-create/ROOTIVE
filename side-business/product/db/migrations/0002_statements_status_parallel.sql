CREATE TABLE "parallel_checks" (
	"tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"driver_id" uuid NOT NULL,
	"excel_total" integer NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parallel_checks_tenant_id_month_driver_id_pk" PRIMARY KEY("tenant_id","month","driver_id")
);
--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "parallel_checks" ADD CONSTRAINT "parallel_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parallel_checks" ADD CONSTRAINT "parallel_checks_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;