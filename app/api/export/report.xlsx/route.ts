/**
 * GET /api/export/report.xlsx?y=YYYY — 年次レポート Excel。スタッフ（owner/admin/viewer）
 * 「月次推移」シート（report.csv と同じ内容・同じ並び）と「合計」シート（縦並びの年計）の 2 シート。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { currentMonthJST } from "@/lib/month";
import { loadMonthPlRange } from "@/lib/db/queries";
import { parseYear, toReportRows, yearOfMonth, yearRange } from "@/components/reports/helpers";
import { REPORT_CSV_HEADERS, reportToCsvRow, reportTotalCsvRow } from "@/lib/exports/report-csv";
import { buildXlsx, sheetFromRows, type XlsxCell, type XlsxCellType, type XlsxSheet } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { ExportError, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** REPORT_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = [
  "text", // 稼動月
  "money", // 売上
  "money", // 支払
  "money", // 単価差額利益
  "money", // ロイヤリティ
  "money", // 管理費
  "money", // 調整
  "money", // 会社利益
  "money", // 経費（固定）
  "money", // 経費（変動）
  "money", // 経費合計
  "money", // 営業利益
  "percent", // 営業利益率
  "money", // 消費税
  "money", // 税込支払額
  "text", // 状態
];

/** ?y=YYYY（未指定なら日本時間の今年）。不正は 400 */
function yearParam(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("y");
  if (raw == null || raw === "") return yearOfMonth(currentMonthJST());
  const y = parseYear(raw);
  if (y == null) throw new ExportError(400, "年は ?y=YYYY（西暦 4 桁）で指定してください。");
  return y;
}

/** 合計シート：項目を縦に並べる（稼動月・状態の列は年計に意味が無いので出さない） */
function totalSheet(total: (string | number | null | undefined)[]): XlsxSheet {
  const rows: XlsxCell[][] = [["項目", "年計"]];
  REPORT_CSV_HEADERS.forEach((header, i) => {
    if (i === 0 || header === "状態") return;
    rows.push([header, { v: total[i] ?? null, t: TYPES[i], bold: true }]);
  });
  return { name: "合計", rows, columns: [{ width: 18 }, { width: 16 }], freezeHeader: true };
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const year = yearParam(req);
  const { from, to } = yearRange(year);

  const pl = await loadMonthPlRange(supabase, company.id, from, to);
  const monthRows = toReportRows(pl, year);

  const trend = sheetFromRows("月次推移", [[...REPORT_CSV_HEADERS], ...monthRows.map(reportToCsvRow)], { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "report", label: "年次レポート Excel", req });
  return xlsxResponse(`年次レポート_${year}.xlsx`, buildXlsx([trend, totalSheet(reportTotalCsvRow(monthRows))]));
});
