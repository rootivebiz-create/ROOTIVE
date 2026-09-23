/**
 * GET /api/export/backup.json — バックアップ JSON（§8.4、全テーブル）。admin 以上
 */
import type { NextRequest } from "next/server";
import { MANAGER_ROLES } from "@/lib/auth/session";
import { jsonFileResponse, timestampJST } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, profile } = await requireExportRole(MANAGER_ROLES);
  const { data, error } = await supabase.rpc("export_backup");
  if (error) throw error;
  await recordExport({ profileId: profile.id, kind: "backup", label: "バックアップ JSON", req });
  return jsonFileResponse(`backup_${timestampJST()}.json`, data);
});
