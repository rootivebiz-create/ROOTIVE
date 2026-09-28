-- 明細の版は追記だけ（書き換え・削除は、会社ごと消すときを除いて止める）
CREATE OR REPLACE FUNCTION shimebi_versions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shimebi_purging(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'VERSIONS_APPEND_ONLY: 明細の版は変更できません' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER statement_versions_append_only BEFORE UPDATE OR DELETE ON statement_versions
  FOR EACH ROW EXECUTE FUNCTION shimebi_versions_append_only();
