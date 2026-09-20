/**
 * GET /api/export/hr.csv?kind=applicant|contract — 採用（応募者）／業務委託契約の CSV。
 * スタッフ（owner/admin/viewer）。kind の既定は "applicant"（画面の「採用」タブと同じ）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { applicantsCsv, contractsCsv, hrCsvFilename } from "@/lib/exports/hr-csv";
import { hrCsvKindSchema, type HrCsvKind } from "@/lib/schemas/hr";
import { csvResponse } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ?kind=（未指定は "applicant"、不正は 400） */
function kindParam(req: NextRequest): HrCsvKind {
  const raw = req.nextUrl.searchParams.get("kind");
  if (raw == null || raw === "") return "applicant";
  const parsed = hrCsvKindSchema.safeParse(raw);
  if (!parsed.success) throw new ExportError(400, "種類は ?kind=applicant / contract で指定してください。");
  return parsed.data;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const kind = kindParam(req);

  if (kind === "contract") {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from("v_contract_list")
        .select("*")
        .eq("company_id", company.id)
        .order("end_on", { ascending: true, nullsFirst: false })
        .order("driver_name")
        .range(from, to),
    );
    await recordExport({ profileId: profile.id, kind: "other", label: "契約 CSV", rows: rows.length, req });
    return csvResponse(hrCsvFilename(kind), contractsCsv(rows));
  }

  const rows = await fetchAllRows((from, to) =>
    supabase.from("v_applicant_list").select("*").eq("company_id", company.id).order("applied_on", { ascending: false }).order("name").range(from, to),
  );
  await recordExport({ profileId: profile.id, kind: "other", label: "応募者 CSV", rows: rows.length, req });
  return csvResponse(hrCsvFilename(kind), applicantsCsv(rows));
});
