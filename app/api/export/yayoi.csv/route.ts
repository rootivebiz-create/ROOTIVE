/**
 * GET /api/export/yayoi.csv?m=YYYY-MM|all — 弥生会計 仕訳インポート CSV（§8.2、Shift_JIS・25 列・ヘッダー無し）
 * スタッフ（owner/admin/viewer）。勘定科目・税区分・分割方法・日付基準は会社設定（yayoi_accounts）
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import type { Adjustment, DriverMonthSummary } from "@/lib/db/types";
import { dateToMonth, monthToDate, payoutDate } from "@/lib/month";
import { resolveYayoiAccounts } from "@/lib/yayoi/accounts";
import { buildYayoiRows, toYayoiCsvBuffer, type YayoiDriverInput } from "@/lib/yayoi/build";
import { monthFileLabel } from "@/lib/exports/csv";
import { binaryResponse } from "@/lib/exports/download";
import { fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const month = monthParam(req, { allowAll: true });
  const accounts = resolveYayoiAccounts(company.yayoi_accounts);

  // ドライバー × 月の集計
  const summaries = await fetchAllRows<DriverMonthSummary>((from, to) => {
    const base = supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id);
    const filtered = month === "all" ? base : base.eq("month", monthToDate(month));
    return filtered.order("month").order("driver_sort_order").order("driver_name").range(from, to);
  });

  // 調整（driver_month_id ごと）
  const driverMonthIds = summaries.map((s) => s.driver_month_id).filter((id): id is string => Boolean(id));
  const adjustments =
    driverMonthIds.length === 0
      ? []
      : await fetchAllRows<Adjustment>((from, to) => {
          const base = supabase.from("adjustments").select("*").eq("company_id", company.id);
          const filtered = month === "all" ? base : base.in("driver_month_id", driverMonthIds);
          return filtered.order("driver_month_id").order("sort_order").order("created_at").range(from, to);
        });
  const adjByDriverMonth = new Map<string, Adjustment[]>();
  for (const a of adjustments) {
    if (month === "all" && !driverMonthIds.includes(a.driver_month_id)) continue;
    const list = adjByDriverMonth.get(a.driver_month_id) ?? [];
    list.push(a);
    adjByDriverMonth.set(a.driver_month_id, list);
  }

  // 月ごとに仕訳を組み立てる（all の場合は月順に連結）
  const byMonth = new Map<string, YayoiDriverInput[]>();
  for (const s of summaries) {
    if (!s.month || !s.driver_id) continue;
    const m = dateToMonth(s.month);
    const list = byMonth.get(m) ?? [];
    list.push({
      driverId: s.driver_id,
      driverName: s.driver_name ?? "",
      bill: Number(s.bill ?? 0),
      pay: Number(s.pay ?? 0),
      royalty: Number(s.royalty ?? 0),
      mgmtFee: Number(s.mgmt_fee ?? 0),
      adjustments: (s.driver_month_id ? (adjByDriverMonth.get(s.driver_month_id) ?? []) : []).map((a) => ({
        label: a.label,
        amount: Number(a.amount),
        countAsProfit: a.count_as_profit,
      })),
    });
    byMonth.set(m, list);
  }

  const rows: string[][] = [];
  for (const [m, drivers] of [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    rows.push(...buildYayoiRows({ month: m, accounts, payoutDate: payoutDate(m, company.payout_month_offset, company.payout_day), drivers }));
  }

  await recordExport({ profileId: profile.id, kind: "other", label: "弥生仕訳 CSV", month, rows: rows.length, req });
  return binaryResponse(`弥生仕訳_${monthFileLabel(month)}.csv`, toYayoiCsvBuffer(rows), "text/csv; charset=Shift_JIS");
});
