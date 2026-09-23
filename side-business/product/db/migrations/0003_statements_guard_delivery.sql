-- 締めたあとでも、明細の「送った・開いた・リンクの作り直し」だけは記録できるようにする（金額や中身は変えられない）
CREATE OR REPLACE FUNCTION shimebi_guard_statements() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.month = OLD.month
     AND NEW.driver_id = OLD.driver_id
     AND NEW.snapshot = OLD.snapshot
     AND NEW.subtotal = OLD.subtotal
     AND NEW.tax = OLD.tax
     AND NEW.deductions = OLD.deductions
     AND NEW.withholding = OLD.withholding
     AND NEW.total = OLD.total THEN
    RETURN NEW;
  END IF;
  RETURN shimebi_guard_closed_month_row(TG_OP, OLD, NEW);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- 共通の判定を、行を受け取る形でも使えるようにする
CREATE OR REPLACE FUNCTION shimebi_guard_closed_month_row(op text, old_row statements, new_row statements) RETURNS statements AS $$
DECLARE
  target_tenant uuid;
  target_month date;
BEGIN
  IF op = 'DELETE' THEN
    target_tenant := old_row.tenant_id;
    target_month := old_row.month;
  ELSE
    target_tenant := new_row.tenant_id;
    target_month := new_row.month;
  END IF;
  IF EXISTS (SELECT 1 FROM month_closes mc WHERE mc.tenant_id = target_tenant AND mc.month = target_month AND mc.status = 'closed') THEN
    RAISE EXCEPTION 'MONTH_CLOSED: % は締め済みです', to_char(target_month, 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF op = 'UPDATE' AND old_row.month <> new_row.month AND EXISTS (
    SELECT 1 FROM month_closes mc WHERE mc.tenant_id = old_row.tenant_id AND mc.month = old_row.month AND mc.status = 'closed'
  ) THEN
    RAISE EXCEPTION 'MONTH_CLOSED: % は締め済みです', to_char(old_row.month, 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF op = 'DELETE' THEN
    RETURN old_row;
  END IF;
  RETURN new_row;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS statements_guard ON statements;
--> statement-breakpoint
CREATE TRIGGER statements_guard BEFORE INSERT OR UPDATE OR DELETE ON statements
  FOR EACH ROW EXECUTE FUNCTION shimebi_guard_statements();
