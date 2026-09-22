/**
 * GET /api/export/roster.pdf?all=1 — 運転者台帳 PDF（1 人 1 ページ）。
 * 既定は在籍中のドライバーだけ。?all=1 で退職した人（保存期間中）も入れる。
 * スタッフ（owner/admin/viewer）のみ。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { todayJST } from "@/lib/daily/helpers";
import { loadRosterForPdf } from "@/lib/compliance/queries";
import { renderRosterPdf } from "@/lib/pdf/roster";
import { pdfResponse, safeFilePart } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const includeRetired = req.nextUrl.searchParams.get("all") === "1";
  const today = todayJST();

  const drivers = await loadRosterForPdf(supabase, company.id, { includeRetired });
  const pdf = await renderRosterPdf({ companyName: company.name, today, drivers });

  await recordExport({ profileId: profile.id, kind: "other", label: "運転者台帳 PDF", rows: drivers.length, req });
  return pdfResponse(safeFilePart(`運転者台帳_${today}.pdf`), pdf);
});
