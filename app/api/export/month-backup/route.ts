/**
 * GET /api/export/month-backup?m=YYYY-MM — 締め時バックアップ（Storage）のダウンロード。admin 以上
 * month_closings.backup_path → 署名付き URL（60 秒）へ 302 リダイレクト
 */
import { NextResponse, type NextRequest } from "next/server";
import { MANAGER_ROLES } from "@/lib/auth/session";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { monthToDate } from "@/lib/month";
import { ExportError, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGER_ROLES);
  const month = monthParam(req);

  const { data: closing, error } = await supabase.from("month_closings").select("backup_path, status").eq("company_id", company.id).eq("month", monthToDate(month)).maybeSingle();
  if (error) throw error;
  const path = closing?.backup_path;
  if (!path) throw new ExportError(404, `${month} の締め時バックアップはありません。月締めを行うと自動で保存されます。`);
  // 自社フォルダ（<company_id>/...）以外のパスは署名しない（backup_path が書き換えられた場合の他社データ参照を防ぐ）
  if (!path.startsWith(`${company.id}/`) || path.includes("..")) {
    throw new ExportError(403, "バックアップの保存先が不正です。");
  }

  // サービスロールが無い環境では本人の権限（RLS：自社フォルダ・admin 以上）で署名する
  const storage = (hasServiceRoleKey() ? createAdminClient() : supabase).storage;
  const { data: signed, error: signErr } = await storage.from("backups").createSignedUrl(path, 60);
  if (signErr || !signed?.signedUrl) throw new ExportError(500, `バックアップのダウンロード URL を作成できませんでした: ${signErr?.message ?? "unknown"}`);

  await recordExport({ profileId: profile.id, kind: "backup", label: "締め時バックアップ", month, req });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
});
