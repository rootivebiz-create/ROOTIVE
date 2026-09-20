/**
 * GET /api/export/entries.xlsx?m=YYYY-MM|all — 稼働明細 Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは entries.csv と同じで、金額・率・数量に Excel の書式を付ける。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { monthToDate } from "@/lib/month";
import { entriesCsvRows, monthFileLabel } from "@/lib/exports/csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ENTRIES_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = [
  "text", // 稼動月
  "text", // ドライバー
  "text", // 案件
  "text", // 内容
  "text", // 区分
  "qty", // 数量
  "money", // 受注単価
  "money", // 支払単価
  "money", // 会社売上
  "money", // ドライバー売上
  "money", // 単価差額利益
  "percent", // ロイヤリティ率
  "money", // ロイヤリティ額
  "money", // 行の利益
  "text", // 備考
];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });

  const rows = await fetchAllRows((from, to) => {
    const base = supabase.from("v_work_entry_calc").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("driver_sort_order").order("driver_name").order("created_at").order("id").range(from, to);
  });

  const sheet = sheetFromRows("稼働明細", entriesCsvRows(rows), { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "entries", label: "稼働明細 Excel", month, rows: rows.length, req });
  return xlsxResponse(`稼働明細_${monthFileLabel(month)}.xlsx`, buildXlsx([sheet]));
});
