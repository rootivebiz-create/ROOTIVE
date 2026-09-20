/**
 * GET /api/export/fleet.csv?kind=vehicle|document — 車両 / 書類と期限の CSV。スタッフ（owner/admin/viewer）
 * 稼動月には依存しない（全件）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { documentsCsv, vehiclesCsv } from "@/lib/exports/fleet-csv";
import { csvResponse } from "@/lib/exports/download";
import { fleetCsvKindSchema } from "@/lib/schemas/fleet";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const parsed = fleetCsvKindSchema.safeParse(req.nextUrl.searchParams.get("kind") ?? "vehicle");
  if (!parsed.success) throw new ExportError(400, "出力の種類は ?kind=vehicle または ?kind=document で指定してください。");

  if (parsed.data === "vehicle") {
    const rows = await fetchAllRows((from, to) =>
      supabase.from("v_vehicle_list").select("*").eq("company_id", company.id).order("sort_order").order("plate").range(from, to),
    );
    await recordExport({ profileId: profile.id, kind: "other", label: "車両一覧 CSV", rows: rows.length, req });
    return csvResponse("車両一覧.csv", vehiclesCsv(rows));
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
  await recordExport({ profileId: profile.id, kind: "other", label: "書類と期限 CSV", rows: rows.length, req });
  return csvResponse("書類と期限.csv", documentsCsv(rows));
});
