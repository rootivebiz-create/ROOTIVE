/**
 * GET /api/export/cashflow.csv?from=YYYY-MM-DD&to=YYYY-MM-DD — 資金繰り CSV。スタッフ（owner/admin/viewer）
 * 期間の既定は画面と同じ「今日から 90 日後まで」。残高は起点残高（cash_snapshots）から積み上げる。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { loadCashForecast, loadCashSnapshots } from "@/lib/db/queries";
import { buildCashTimeline, pickOpeningBalance, resolveRange, toCashflowCsvRows } from "@/components/cashflow/helpers";
import { cashflowCsvFilename, toCashflowCsv } from "@/lib/exports/cashflow-csv";
import { csvResponse } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const sp = req.nextUrl.searchParams;
  const range = resolveRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined);

  const [events, snapshots] = await Promise.all([loadCashForecast(supabase, range.from, range.to), loadCashSnapshots(supabase, company.id)]);
  const opening = pickOpeningBalance(snapshots, range.from);
  const timeline = buildCashTimeline({ events, openingBalance: opening?.balance ?? 0, from: range.from, to: range.to });

  await recordExport({ profileId: profile.id, kind: "other", label: "資金繰り CSV", rows: timeline.length, req });
  return csvResponse(cashflowCsvFilename(range.from, range.to), toCashflowCsv(toCashflowCsvRows(timeline)));
});
