-- 会社ごと消すとき（デモの会社の片付け・解約のあとの削除）だけ、締めた月と操作の記録の守りを外す。
-- 同じトランザクションの中で set_config('shimebi.purge_tenant', '<会社の id>', true) を呼んだときに限る。
CREATE OR REPLACE FUNCTION shimebi_purging(target uuid) RETURNS boolean AS $$
  SELECT coalesce(current_setting('shimebi.purge_tenant', true), '') = target::text;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION shimebi_guard_closed_month() RETURNS trigger AS $$
DECLARE
  target_tenant uuid;
  target_month date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF shimebi_purging(OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    target_tenant := OLD.tenant_id;
    target_month := OLD.month;
  ELSE
    target_tenant := NEW.tenant_id;
    target_month := NEW.month;
  END IF;
  IF EXISTS (
    SELECT 1 FROM month_closes mc
    WHERE mc.tenant_id = target_tenant AND mc.month = target_month AND mc.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'MONTH_CLOSED: % は締め済みです', to_char(target_month, 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.month <> NEW.month AND EXISTS (
    SELECT 1 FROM month_closes mc
    WHERE mc.tenant_id = OLD.tenant_id AND mc.month = OLD.month AND mc.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'MONTH_CLOSED: % は締め済みです', to_char(OLD.month, 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION shimebi_guard_statements() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shimebi_purging(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.month = OLD.month
     AND NEW.driver_id = OLD.driver_id
     AND NEW.snapshot = OLD.snapshot
     AND NEW.subtotal = OLD.subtotal
     AND NEW.tax = OLD.tax
     AND NEW.deductions = OLD.deductions
     AND NEW.withholding = OLD.withholding
     AND NEW.total = OLD.total
     AND NEW.version = OLD.version
     AND NEW.hash = OLD.hash THEN
    RETURN NEW;
  END IF;
  RETURN shimebi_guard_closed_month_row(TG_OP, OLD, NEW);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION shimebi_audit_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shimebi_purging(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: 操作の記録は変更できません' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
