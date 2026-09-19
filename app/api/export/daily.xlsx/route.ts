/**
 * GET /api/export/daily.xlsx?m=YYYY-MM|all&kind=report|entry
 *  - kind=report：点呼記録簿・業務記録（既定）
 *  - kind=entry：日別の稼働（ドライバー報告と承認状況）
 * スタッフ（owner/admin/viewer）のみ。内容・並びは daily.csv と同じで、kind ごとに 1 シート。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { ServerSupabase } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/month";
import { monthFileLabel } from "@/lib/exports/csv";
import {
  dailyCsvFilename,
  dailyCsvKindFromParam,
  dailyReportsCsvRows,
  dayEntriesCsvRows,
  type DailyReportCsvSource,
  type DayEntryCsvSource,
} from "@/lib/exports/daily-csv";
import { buildXlsx, sheetFromRows, xlsxFilename, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** DAILY_REPORT_CSV_HEADERS と同じ並びの列の型（点呼の時刻は日付＋時刻なので文字列のまま） */
const REPORT_TYPES: XlsxCellType[] = [
  "date", // 日付
  "text", // ドライバー
  "text", // 車両
  "text", // 業務前点呼 時刻
  "text", // 業務前点呼 方法
  "number", // 業務前点呼 アルコール
  "text", // 業務前点呼 体調
  "text", // 業務前点呼 日常点検
  "text", // 業務前点呼 指示事項
  "text", // 業務前点呼 実施者
  "text", // 業務後点呼 時刻
  "text", // 業務後点呼 方法
  "number", // 業務後点呼 アルコール
  "text", // 業務後点呼 体調
  "text", // 業務後点呼 事故・違反の報告
  "text", // 業務後点呼 実施者
  "text", // 業務開始
  "text", // 業務終了
  "number", // 休憩（分）
  "number", // 走行距離
  "qty", // 稼働合計
  "text", // 備考
];

/** DAY_ENTRY_CSV_HEADERS と同じ並びの列の型 */
const ENTRY_TYPES: XlsxCellType[] = ["date", "text", "text", "text", "text", "qty", "text", "text", "text", "text", "text", "text"];

/** スタッフの表示名（id → 名前）。閲覧できないユーザー（ドライバー本人）は含まれない */
async function loadStaffNames(supabase: ServerSupabase): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("v_staff").select("id, display_name");
  if (error) throw error;
  const map = new Map<string, string>();
  for (const s of data ?? []) {
    if (s.id) map.set(s.id, s.display_name ?? "");
  }
  return map;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });
  const kind = dailyCsvKindFromParam(req.nextUrl.searchParams.get("kind"));
  const monthDate = month === "all" ? null : monthToDate(month);
  const filename = xlsxFilename(dailyCsvFilename(monthFileLabel(month), kind));

  if (kind === "entry") {
    const [rows, staff] = await Promise.all([
      fetchAllRows((from, to) => {
        const base = supabase.from("v_work_day_entry_list").select("*").eq("company_id", company.id);
        const filtered = monthDate ? base.eq("month", monthDate) : base;
        return filtered.order("work_date").order("driver_sort_order").order("id").range(from, to);
      }),
      loadStaffNames(supabase),
    ]);

    const sheetRows: DayEntryCsvSource[] = rows.map((e) => ({
      ...e,
      approved_by_name: e.approved_by ? (staff.get(e.approved_by) ?? "") : "",
    }));
    const sheet = sheetFromRows("日別の稼働", dayEntriesCsvRows(sheetRows), { types: ENTRY_TYPES });
    return xlsxResponse(filename, buildXlsx([sheet]));
  }

  // 点呼の実施者（pre_by / post_by）はビューに無いので、元のテーブルから引いて名前を当てる
  const [rows, actors, staff] = await Promise.all([
    fetchAllRows((from, to) => {
      const base = supabase.from("v_daily_report_list").select("*").eq("company_id", company.id);
      const filtered = monthDate ? base.eq("month", monthDate) : base;
      return filtered.order("work_date").order("driver_name").order("id").range(from, to);
    }),
    fetchAllRows((from, to) => {
      const base = supabase.from("daily_reports").select("id, pre_by, post_by").eq("company_id", company.id);
      const filtered = monthDate ? base.eq("month", monthDate) : base;
      return filtered.order("id").range(from, to);
    }),
    loadStaffNames(supabase),
  ]);

  const actorById = new Map(actors.map((a) => [a.id, a]));
  /** スタッフに居なければドライバー本人が記録したもの */
  const nameOf = (userId: string | null | undefined, driverName: string | null | undefined): string => {
    if (!userId) return "";
    return staff.get(userId) ?? `${driverName ?? ""}（本人）`;
  };

  const sheetRows: DailyReportCsvSource[] = rows.map((r) => {
    const a = r.id ? actorById.get(r.id) : undefined;
    return {
      ...r,
      pre_by_name: r.pre_at ? nameOf(a?.pre_by, r.driver_name) : "",
      post_by_name: r.post_at ? nameOf(a?.post_by, r.driver_name) : "",
    };
  });

  const sheet = sheetFromRows("点呼記録簿", dailyReportsCsvRows(sheetRows), { types: REPORT_TYPES });
  return xlsxResponse(filename, buildXlsx([sheet]));
});
