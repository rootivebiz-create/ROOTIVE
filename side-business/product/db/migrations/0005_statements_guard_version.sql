-- 版とハッシュも「中身」として扱う（締めたあとに版だけ書き換えて、確認の記録と食い違わせない）
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
     AND NEW.total = OLD.total
     AND NEW.version = OLD.version
     AND NEW.hash = OLD.hash THEN
    RETURN NEW;
  END IF;
  RETURN shimebi_guard_closed_month_row(TG_OP, OLD, NEW);
END;
$$ LANGUAGE plpgsql;
