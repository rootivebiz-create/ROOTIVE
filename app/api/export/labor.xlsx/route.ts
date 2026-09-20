/**
 * GET /api/export/labor.xlsx?m=YYYY-MM&kind=day|month
 *  - kind=day：日ごとの拘束時間・実働・休息期間・連続勤務（既定）
 *  - kind=month：ドライバー × 月のまとめ
 * スタッフ（owner/admin/viewer）のみ。内容・並びは labor.csv と同じで、kind ごとに 1 シート。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import { laborCsvFilename, laborCsvKindFromParam, laborDaysCsvRows, laborMonthsCsvRows, type LaborDayCsvSource } from "@/lib/exports/labor-csv";
import { buildXlsx, sheetFromRows, xlsxFilename, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** LABOR_DAY_CSV_HEADERS と同じ並びの列の型（開始・終了は日付＋時刻なので文字列のまま） */
const DAY_TYPES: XlsxCellType[] = [
  "date", // 日付
  "text", // ドライバー
  "text", // 開始
  "text", // 終了
  "number", // 拘束（分）
  "number", // 休憩（分）
  "number", // 実働（分）
  "number", // 休息（分）
  "number", // 連続日数
  "text", // 拘束の判定
  "text", // 休息の判定
  "text", // 休憩の判定
];

/** LABOR_MONTH_CSV_HEADERS と同じ並びの列の型 */
const MONTH_TYPES: XlsxCellType[] = [
  "text", // 稼動月
  "text", // ドライバー
  "number", // 日報の日数
  "number", // 対象日数
  "number", // 拘束の合計（分）
  "number", // 拘束の平均（分）
  "number", // 拘束の最大（分）
  "number", // 実働の合計（分）
  "qty", // 走行距離
  "number", // 拘束が目安超（日）
  "number", // 拘束が上限超（日）
  "number", // 休息が目安割れ（日）
  "number", // 休息が下限割れ（日）
  "number", // 休憩が不足（日）
  "number", // 連続勤務の最大（日）
  "text", // 1 か月の拘束が上限超
  "text", // 連続勤務が上限超
  "text", // 判定
];

/** ドライバーの表示名（id → 名前）。v_daily_labor には名前が無いので引いて当てる */
async function loadDriverNames(supabase: ServerSupabase, companyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("drivers").select("id, name").eq("company_id", companyId);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.id) map.set(d.id, d.name ?? "");
  }
  return map;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req);
  const kind = laborCsvKindFromParam(req.nextUrl.searchParams.get("kind"));
  const monthDate = monthToDate(month);
  const filename = xlsxFilename(laborCsvFilename(monthFileLabel(month), kind));

  if (kind === "month") {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from("v_driver_month_labor")
        .select("*")
        .eq("company_id", company.id)
        .eq("month", monthDate)
        .order("driver_sort_order")
        .order("driver_name")
        .order("driver_id")
        .range(from, to),
    );
    const sheet = sheetFromRows("労務（月別）", laborMonthsCsvRows(rows), { types: MONTH_TYPES });
    return xlsxResponse(filename, buildXlsx([sheet]));
  }

  const [rows, drivers] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("v_daily_labor").select("*").eq("company_id", company.id).eq("month", monthDate).order("work_date").order("driver_id").order("id").range(from, to),
    ),
    loadDriverNames(supabase, company.id),
  ]);

  const sheetRows: LaborDayCsvSource[] = rows.map((r) => ({ ...r, driver_name: r.driver_id ? (drivers.get(r.driver_id) ?? "") : "" }));
  const sheet = sheetFromRows("労務（日別）", laborDaysCsvRows(sheetRows), { types: DAY_TYPES });
  return xlsxResponse(filename, buildXlsx([sheet]));
});
