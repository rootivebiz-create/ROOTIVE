-- 締めた月の稼働・調整・明細は書き換えられないようにする（画面やサーバーの確認をすり抜けても、ここで止まる）
CREATE OR REPLACE FUNCTION shimebi_guard_closed_month() RETURNS trigger AS $$
DECLARE
  target_tenant uuid;
  target_month date;
BEGIN
  IF TG_OP = 'DELETE' THEN
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
  -- UPDATE で月を「締めた月へ」動かすことも止める
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
CREATE TRIGGER work_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON work_entries
  FOR EACH ROW EXECUTE FUNCTION shimebi_guard_closed_month();
--> statement-breakpoint
CREATE TRIGGER adjustments_guard BEFORE INSERT OR UPDATE OR DELETE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION shimebi_guard_closed_month();
--> statement-breakpoint
CREATE TRIGGER statements_guard BEFORE INSERT OR UPDATE OR DELETE ON statements
  FOR EACH ROW EXECUTE FUNCTION shimebi_guard_closed_month();
--> statement-breakpoint
-- 操作の記録は消せない・書き換えられない
CREATE OR REPLACE FUNCTION shimebi_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: 操作の記録は変更できません' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION shimebi_audit_append_only();
--> statement-breakpoint
-- 数量・金額の最低限の形
ALTER TABLE work_entries ADD CONSTRAINT work_entries_qty_nonneg CHECK (qty >= 0);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'staff', 'viewer'));
--> statement-breakpoint
ALTER TABLE month_closes ADD CONSTRAINT month_closes_status_check CHECK (status IN ('open', 'closed'));
--> statement-breakpoint
ALTER TABLE deduction_rules ADD CONSTRAINT deduction_rules_kind_check CHECK (kind IN ('percent', 'fixed', 'per_unit'));
