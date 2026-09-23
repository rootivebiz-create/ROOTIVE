/**
 * GET /api/export/cashflow.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD — 資金繰り Excel。スタッフ（owner/admin/viewer）
 * 内容・並び・期間の既定は cashflow.csv と同じ（金額は税込、残高はその日の終わり）。
 */
import type { NextRequest } from "next/server";
import { MANAGEMENT_VIEW_ROLES } from "@/lib/auth/session";
import { loadCashForecast, loadCashSnapshots } from "@/lib/db/queries";
import { buildCashTimeline, pickOpeningBalance, resolveRange, toCashflowCsvRows } from "@/components/cashflow/helpers";
import { cashflowCsvRows } from "@/lib/exports/cashflow-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** CASHFLOW_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["date", "text", "text", "text", "money", "money", "money", "text", "text"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(MANAGEMENT_VIEW_ROLES);
  const sp = req.nextUrl.searchParams;
  const range = resolveRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined);

  const [events, snapshots] = await Promise.all([loadCashForecast(supabase, range.from, range.to), loadCashSnapshots(supabase, company.id)]);
  const opening = pickOpeningBalance(snapshots, range.from);
  const timeline = buildCashTimeline({ events, openingBalance: opening?.balance ?? 0, from: range.from, to: range.to });

  const sheet = sheetFromRows("資金繰り", cashflowCsvRows(toCashflowCsvRows(timeline)), { types: TYPES });
  await recordExport({ profileId: profile.id, kind: "other", label: "資金繰り Excel", req });
  return xlsxResponse(`資金繰り_${range.from}_${range.to}.xlsx`, buildXlsx([sheet]));
});
