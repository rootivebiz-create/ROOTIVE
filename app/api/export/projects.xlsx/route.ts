/**
 * GET /api/export/projects.xlsx?m=YYYY-MM|all — 案件別採算 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは projects.csv と同じ（案件利益 ＝ 稼働の利益 − 直課経費）。
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { projectsCsvRows } from "@/lib/exports/projects-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { toProjectRow } from "@/components/projects/helpers";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** PROJECTS_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = [
  "text", // 稼動月
  "text", // 案件
  "text", // 取引先
  "number", // 稼働件数
  "number", // ドライバー数
  "qty", // 数量
  "money", // 売上
  "money", // ドライバー支払
  "money", // 単価差額利益
  "money", // ロイヤリティ
  "money", // 稼働の利益
  "money", // 直課経費
  "money", // 案件利益
  "percent", // 利益率
  "percent", // 目標利益率
  "text", // 判定
];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_project_pl").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("project_sort_order").order("project_name").range(from, to);
  });

  const sheet = sheetFromRows("案件別採算", projectsCsvRows(rows.map(toProjectRow)), { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "other", label: "案件別採算 Excel", month, rows: rows.length, req });
  return xlsxResponse(`案件別採算_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
