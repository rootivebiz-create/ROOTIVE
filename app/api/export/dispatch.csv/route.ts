/**
 * GET /api/export/dispatch.csv?from=YYYY-MM-DD&to=YYYY-MM-DD — 期間の配車予定 CSV。
 * スタッフ（owner/admin/viewer）のみ。期間の指定が無ければ「今日から 2 週間」。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { addDays, todayJST } from "@/lib/daily/helpers";
import { dateSchema } from "@/lib/schemas/dispatch";
import { dispatchCsvFilename, dispatchToCsv, type DispatchCsvSource } from "@/lib/exports/dispatch-csv";
import { csvResponse, safeFilePart } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ?from= / ?to=（未指定なら今日から 2 週間） */
function rangeParam(req: NextRequest): { from: string; to: string } {
  const today = todayJST();
  const raw = { from: req.nextUrl.searchParams.get("from") ?? today, to: req.nextUrl.searchParams.get("to") ?? addDays(today, 13) };
  const parsed = dateSchema.safeParse(raw.from);
  const parsedTo = dateSchema.safeParse(raw.to);
  if (!parsed.success || !parsedTo.success) throw new ExportError(400, "期間は ?from=YYYY-MM-DD&to=YYYY-MM-DD で指定してください。");
  if (parsedTo.data < parsed.data) throw new ExportError(400, "終わりの日は始まりの日より後にしてください。");
  return { from: parsed.data, to: parsedTo.data };
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const { from, to } = rangeParam(req);

  const rows = await fetchAllRows<DispatchCsvSource>((start, end) =>
    supabase
      .from("v_dispatch_list")
      .select("*")
      .eq("company_id", company.id)
      .gte("on_date", from)
      .lte("on_date", to)
      .order("on_date")
      .order("driver_sort_order")
      .order("id")
      .range(start, end),
  );

  await recordExport({ profileId: profile.id, kind: "other", label: "配車予定 CSV", rows: rows.length, req });
  return csvResponse(safeFilePart(dispatchCsvFilename(from, to)), dispatchToCsv(rows));
});
