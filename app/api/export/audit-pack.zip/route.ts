/**
 * GET /api/export/audit-pack.zip?from=YYYY-MM-DD&to=YYYY-MM-DD&parts=roster,daily,...
 *   監査で求められる記録を 1 つの ZIP にまとめる。スタッフ（owner/admin/viewer）のみ。
 *
 * 期間を省略すると「今日から 1 年前まで」。運転者台帳は期間を持たないので常に全員ぶん。
 * 途中で失敗したものは README.txt に記録し、残りは作り続ける（月次パックと同じ考え方）。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { addDays, todayJST } from "@/lib/daily/helpers";
import { translateError } from "@/lib/actions/result";
import { dateSchema } from "@/lib/schemas/dispatch";
import { loadRosterForPdf } from "@/lib/compliance/queries";
import { renderRosterPdf } from "@/lib/pdf/roster";
import {
  aptitudesToCsv,
  incidentsToCsv,
  instructionsToCsv,
  rosterToCsv,
  type AptitudeCsvSource,
  type IncidentCsvSource,
  type InstructionCsvSource,
  type RosterCsvSource,
} from "@/lib/exports/compliance-csv";
import { documentsCsv, vehiclesCsv, type DocumentCsvSource, type VehicleCsvSource } from "@/lib/exports/fleet-csv";
import { toDailyReportsCsv, type DailyReportCsvSource } from "@/lib/exports/daily-csv";
import { toLaborDaysCsv, type LaborDayCsvSource } from "@/lib/exports/labor-csv";
import {
  auditPackFilename,
  auditPackReadme,
  parseAuditPackParts,
  type AuditPackError,
  type AuditPackFile,
  type AuditPackPart,
} from "@/lib/exports/audit-pack";
import { buildZip, type ZipEntry } from "@/lib/exports/zip";
import { binaryResponse, safeFilePart, timestampJST } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const enc = new TextEncoder();

/** ?from= / ?to=（未指定なら 1 年前 〜 今日） */
function range(req: NextRequest): { from: string; to: string } {
  const today = todayJST();
  const raw = { from: req.nextUrl.searchParams.get("from") ?? addDays(today, -365), to: req.nextUrl.searchParams.get("to") ?? today };
  const from = dateSchema.safeParse(raw.from);
  const to = dateSchema.safeParse(raw.to);
  if (!from.success || !to.success) throw new ExportError(400, "期間は ?from=YYYY-MM-DD&to=YYYY-MM-DD で指定してください。");
  if (to.data < from.data) throw new ExportError(400, "終わりの日は始まりの日より後にしてください。");
  return { from: from.data, to: to.data };
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const { from, to } = range(req);
  const parts = parseAuditPackParts(req.nextUrl.searchParams.get("parts"));

  const entries: ZipEntry[] = [];
  const files: AuditPackFile[] = [];
  const errors: AuditPackError[] = [];

  /** 1 つ作って ZIP に入れる。失敗しても残りは続ける */
  const add = async (part: AuditPackPart, name: string, make: () => Promise<{ data: Uint8Array; rows: number }>) => {
    try {
      const { data, rows } = await make();
      entries.push({ name, data });
      files.push({ name, rows });
    } catch (e) {
      errors.push({ part, message: translateError(e) });
    }
  };

  const text = (s: string): Uint8Array => enc.encode(s);

  if (parts.includes("roster")) {
    await add("roster", "運転者台帳.pdf", async () => {
      const drivers = await loadRosterForPdf(supabase, company.id, { includeRetired: true });
      return { data: await renderRosterPdf({ companyName: company.name, today: to, drivers }), rows: drivers.length };
    });
    await add("roster", "運転者台帳.csv", async () => {
      const rows = await fetchAllRows<RosterCsvSource>((s, e) =>
        supabase.from("v_driver_roster").select("*").eq("company_id", company.id).order("sort_order").order("name").range(s, e),
      );
      return { data: text(rosterToCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("daily")) {
    await add("daily", "運転日報・点呼記録.csv", async () => {
      const rows = await fetchAllRows<DailyReportCsvSource>((s, e) =>
        supabase
          .from("v_daily_report_list")
          .select("*")
          .eq("company_id", company.id)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date")
          .order("driver_sort_order")
          .range(s, e),
      );
      return { data: text(toDailyReportsCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("instruction")) {
    await add("instruction", "指導・監督の記録.csv", async () => {
      const rows = await fetchAllRows<InstructionCsvSource>((s, e) =>
        supabase
          .from("v_driver_instruction_list")
          .select("*")
          .eq("company_id", company.id)
          .gte("instructed_on", from)
          .lte("instructed_on", to)
          .order("instructed_on")
          .range(s, e),
      );
      return { data: text(instructionsToCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("incident")) {
    await add("incident", "事故・違反の記録.csv", async () => {
      const rows = await fetchAllRows<IncidentCsvSource>((s, e) =>
        supabase
          .from("v_incident_list")
          .select("*")
          .eq("company_id", company.id)
          .gte("occurred_at", from)
          .lte("occurred_at", `${to}T23:59:59+09:00`)
          .order("occurred_at")
          .range(s, e),
      );
      return { data: text(incidentsToCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("aptitude")) {
    await add("aptitude", "適性診断の記録.csv", async () => {
      const rows = await fetchAllRows<AptitudeCsvSource>((s, e) =>
        supabase
          .from("v_aptitude_list")
          .select("*")
          .eq("company_id", company.id)
          .gte("taken_on", from)
          .lte("taken_on", to)
          .order("taken_on")
          .range(s, e),
      );
      return { data: text(aptitudesToCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("fleet")) {
    await add("fleet", "車両.csv", async () => {
      const rows = await fetchAllRows<VehicleCsvSource>((s, e) =>
        supabase.from("v_vehicle_list").select("*").eq("company_id", company.id).order("sort_order").range(s, e),
      );
      return { data: text(vehiclesCsv(rows)), rows: rows.length };
    });
    await add("fleet", "書類と期限.csv", async () => {
      const rows = await fetchAllRows<DocumentCsvSource>((s, e) =>
        supabase.from("v_document_list").select("*").eq("company_id", company.id).order("expires_on").range(s, e),
      );
      return { data: text(documentsCsv(rows)), rows: rows.length };
    });
  }

  if (parts.includes("labor")) {
    await add("labor", "拘束時間・休息.csv", async () => {
      const rows = await fetchAllRows<LaborDayCsvSource>((s, e) =>
        supabase
          .from("v_daily_labor")
          .select("*")
          .eq("company_id", company.id)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date")
          .range(s, e),
      );
      return { data: text(toLaborDaysCsv(rows)), rows: rows.length };
    });
  }

  // 保存期間は README にそのまま載せる
  const { data: retentionRows } = await supabase.from("v_record_retention").select("*").eq("company_id", company.id);
  const retention = (retentionRows ?? []).map((r) => ({
    label: r.label ?? "",
    years: Number(r.years ?? 0),
    basis: r.basis ?? "",
  }));

  entries.unshift({
    name: "README.txt",
    data: text(
      auditPackReadme({
        companyName: company.name,
        from,
        to,
        generatedAt: timestampJST(),
        files,
        errors,
        retention,
      }),
    ),
  });

  const zip = buildZip(entries);
  await recordExport({ profileId: profile.id, kind: "month-pack", label: "監査一式 ZIP", rows: files.length, req });
  return binaryResponse(safeFilePart(auditPackFilename(from, to)), zip, "application/zip");
});
