/**
 * GET /api/export/compliance.csv?kind=roster|instruction|incident|aptitude
 *   監査で求められる帳票の CSV。スタッフ（owner/admin/viewer）のみ。
 *   ?from= / ?to= で期間を絞れる（台帳は期間を持たないので無視する）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { todayJST } from "@/lib/daily/helpers";
import { dateSchema } from "@/lib/schemas/dispatch";
import {
  aptitudesToCsv,
  complianceCsvFilename,
  complianceCsvKindFromParam,
  COMPLIANCE_CSV_LABELS,
  incidentsToCsv,
  instructionsToCsv,
  rosterToCsv,
  type AptitudeCsvSource,
  type IncidentCsvSource,
  type InstructionCsvSource,
  type RosterCsvSource,
} from "@/lib/exports/compliance-csv";
import { csvResponse, safeFilePart } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** ?from= / ?to=（両方そろっているときだけ絞る） */
function range(req: NextRequest): { from: string | null; to: string | null } {
  const raw = { from: req.nextUrl.searchParams.get("from"), to: req.nextUrl.searchParams.get("to") };
  if (!raw.from && !raw.to) return { from: null, to: null };
  const from = raw.from ? dateSchema.safeParse(raw.from) : null;
  const to = raw.to ? dateSchema.safeParse(raw.to) : null;
  if ((from && !from.success) || (to && !to.success)) {
    throw new ExportError(400, "期間は ?from=YYYY-MM-DD&to=YYYY-MM-DD で指定してください。");
  }
  return { from: from?.success ? from.data : null, to: to?.success ? to.data : null };
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const kind = complianceCsvKindFromParam(req.nextUrl.searchParams.get("kind"));
  const { from, to } = range(req);
  const today = todayJST();

  /** 期間で絞る（日付の列名は帳票ごとに違う） */
  const between = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T, col: string): T => {
    let out = q;
    if (from) out = out.gte(col, from);
    if (to) out = out.lte(col, to);
    return out;
  };

  let csv: string;
  let rowCount = 0;

  if (kind === "roster") {
    const rows = await fetchAllRows<RosterCsvSource>((start, end) =>
      supabase.from("v_driver_roster").select("*").eq("company_id", company.id).order("sort_order").order("name").range(start, end),
    );
    rowCount = rows.length;
    csv = rosterToCsv(rows);
  } else if (kind === "instruction") {
    const rows = await fetchAllRows<InstructionCsvSource>((start, end) =>
      between(supabase.from("v_driver_instruction_list").select("*").eq("company_id", company.id), "instructed_on")
        .order("instructed_on")
        .range(start, end),
    );
    rowCount = rows.length;
    csv = instructionsToCsv(rows);
  } else if (kind === "incident") {
    const rows = await fetchAllRows<IncidentCsvSource>((start, end) =>
      between(supabase.from("v_incident_list").select("*").eq("company_id", company.id), "occurred_at")
        .order("occurred_at")
        .range(start, end),
    );
    rowCount = rows.length;
    csv = incidentsToCsv(rows);
  } else {
    const rows = await fetchAllRows<AptitudeCsvSource>((start, end) =>
      between(supabase.from("v_aptitude_list").select("*").eq("company_id", company.id), "taken_on")
        .order("taken_on")
        .range(start, end),
    );
    rowCount = rows.length;
    csv = aptitudesToCsv(rows);
  }

  // 台帳は生年月日・住所・免許証番号、ほかも氏名と健康の記録を含むので機密として記録する（0025）
  await recordExport({
    profileId: profile.id,
    kind: kind === "roster" ? "roster" : "compliance",
    label: `${COMPLIANCE_CSV_LABELS[kind]} CSV`,
    rows: rowCount,
    req,
  });
  return csvResponse(safeFilePart(complianceCsvFilename(kind, today)), csv);
});
