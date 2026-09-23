/**
 * GET /api/export/drivers-pl.xlsx?m=YYYY-MM&inactive=1 — ドライバー別の採算 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは drivers-pl.csv と同じ（最終行は合計。Excel では太字にする）。
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { buildDriverPlRows, visibleDriverPlRows } from "@/components/drivers-pl/helpers";
import { toDriversPlCsvRows } from "@/lib/exports/drivers-pl-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** DRIVERS_PL_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = [
  "text", // 稼動月
  "text", // ドライバー
  "text", // 状態
  "number", // 稼働件数
  "qty", // 数量
  "money", // 売上
  "money", // 支払（税抜）
  "money", // 単価差額利益
  "money", // ロイヤリティ
  "money", // 管理費
  "money", // 調整
  "money", // 会社利益
  "percent", // 利益率
  "money", // 税込支払額
];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const month = monthParam(req);
  const includeInactive = req.nextUrl.searchParams.get("inactive") === "1";

  const [summaries, entries] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("v_driver_month_summary")
        .select("*")
        .eq("company_id", company.id)
        .eq("month", monthToDate(month))
        .order("driver_sort_order")
        .order("driver_name")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("driver_name").order("id").range(from, to),
    ),
  ]);

  const rows = visibleDriverPlRows(buildDriverPlRows(summaries, entries), { includeInactive });
  const sheet = sheetFromRows("ドライバー別採算", toDriversPlCsvRows(rows), { types: TYPES, boldLastRow: true });
  await recordExport({ profileId: profile.id, kind: "other", label: "ドライバー別採算 Excel", month, rows: rows.length, req });
  return xlsxResponse(`ドライバー別採算_${month}.xlsx`, buildXlsx([sheet]));
});
