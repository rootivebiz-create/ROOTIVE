ALTER TABLE "clients" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "work_entries_batch" ON "work_entries" USING btree ("tenant_id","import_batch_id");