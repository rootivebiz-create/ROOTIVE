/**
 * GET /api/export/backup.json — バックアップ JSON（§8.4、全テーブル）。admin 以上
 */
import type { NextRequest } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth/session";
import { jsonFileResponse, timestampJST } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (_req: NextRequest) => {
  const { supabase } = await requireExportRole(ADMIN_ROLES);
  const { data, error } = await supabase.rpc("export_backup");
  if (error) throw error;
  return jsonFileResponse(`backup_${timestampJST()}.json`, data);
});
