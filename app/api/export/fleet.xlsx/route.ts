/**
 * GET /api/export/fleet.xlsx?kind=vehicle|document — 車両 / 書類と期限の Excel。スタッフ（owner/admin/viewer）
 * 内容・並びは fleet.csv と同じ（稼動月には依存しない）。kind ごとに 1 シート。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { documentsCsvRows, vehiclesCsvRows } from "@/lib/exports/fleet-csv";
import { buildXlsx, sheetFromRows, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { fleetCsvKindSchema } from "@/lib/schemas/fleet";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** VEHICLES_CSV_HEADERS と同じ並びの列の型 */
const VEHICLE_TYPES: XlsxCellType[] = ["text", "text", "text", "text", "text", "money", "number", "date", "text", "number", "text", "text"];

/** DOCUMENTS_CSV_HEADERS と同じ並びの列の型 */
const DOCUMENT_TYPES: XlsxCellType[] = ["text", "text", "text", "text", "text", "date", "date", "number", "text", "number", "text", "text"];

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const parsed = fleetCsvKindSchema.safeParse(req.nextUrl.searchParams.get("kind") ?? "vehicle");
  if (!parsed.success) throw new ExportError(400, "出力の種類は ?kind=vehicle または ?kind=document で指定してください。");

  if (parsed.data === "vehicle") {
    const rows = await fetchAllRows((from, to) =>
      supabase.from("v_vehicle_list").select("*").eq("company_id", company.id).order("sort_order").order("plate").range(from, to),
    );
    const sheet = sheetFromRows("車両一覧", vehiclesCsvRows(rows), { types: VEHICLE_TYPES });
    await recordExport({ profileId: profile.id, kind: "other", label: "車両一覧 Excel", rows: rows.length, req });
    return xlsxResponse("車両一覧.xlsx", buildXlsx([sheet]));
  }

  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("v_document_list")
      .select("*")
      .eq("company_id", company.id)
      .order("expires_on", { ascending: true, nullsFirst: false })
      .order("id")
      .range(from, to),
  );
  const sheet = sheetFromRows("書類と期限", documentsCsvRows(rows), { types: DOCUMENT_TYPES });
  await recordExport({ profileId: profile.id, kind: "other", label: "書類と期限 Excel", rows: rows.length, req });
  return xlsxResponse("書類と期限.xlsx", buildXlsx([sheet]));
});
