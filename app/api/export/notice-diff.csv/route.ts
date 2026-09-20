/**
 * GET /api/export/notice-diff.csv?id=<uuid> — 支払通知 1 件の突合 CSV。スタッフ（owner/admin/viewer）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { loadPaymentNotice, loadPaymentNoticeDiff } from "@/lib/db/queries";
import { noticeDiffCsvFilename, noticeDiffToCsv } from "@/lib/exports/notice-csv";
import { csvResponse, safeFilePart } from "@/lib/exports/download";
import { uuidSchema } from "@/lib/schemas/common";
import { ExportError, handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const parsed = uuidSchema.safeParse(req.nextUrl.searchParams.get("id") ?? "");
  if (!parsed.success) throw new ExportError(400, "支払通知は ?id=<ID> で指定してください。");

  const notice = await loadPaymentNotice(supabase, company.id, parsed.data);
  if (!notice) throw new ExportError(404, "支払通知書が見つかりません。");

  const rows = await loadPaymentNoticeDiff(supabase, company.id, parsed.data);
  return csvResponse(safeFilePart(noticeDiffCsvFilename(notice)), noticeDiffToCsv(notice, rows));
});
