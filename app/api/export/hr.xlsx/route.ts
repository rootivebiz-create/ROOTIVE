/**
 * GET /api/export/hr.xlsx?kind=applicant|contract — 採用（応募者）／業務委託契約の Excel。
 * スタッフ（owner/admin/viewer）。内容・並び・既定値は hr.csv と同じ。kind ごとに 1 シート。
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { applicantsCsvRows, contractsCsvRows, hrCsvFilename } from "@/lib/exports/hr-csv";
import { CHECKLIST_ITEMS } from "@/lib/hr/helpers";
import { hrCsvKindSchema, type HrCsvKind } from "@/lib/schemas/hr";
import { buildXlsx, sheetFromRows, xlsxFilename, type XlsxCellType } from "@/lib/exports/xlsx";
import { xlsxResponse } from "@/lib/exports/download";
import { ExportError, fetchAllRows, handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** APPLICANTS_CSV_HEADERS と同じ並びの列の型（チェックリストの列数は CHECKLIST_ITEMS に合わせる） */
const APPLICANT_TYPES: XlsxCellType[] = [
  "text", // 氏名
  "text", // かな
  "text", // 電話
  "text", // メール
  "text", // 応募元
  "text", // 段階
  "date", // 応募日
  "date", // 面談日
  "date", // 稼働開始日
  "text", // ドライバー
  "text", // 書類（3/4）
  ...CHECKLIST_ITEMS.map((): XlsxCellType => "text"),
  "number", // やりとり件数
  "date", // 最終やりとり
  "number", // 応募からの日数
  "text", // 備考
];

/** CONTRACTS_CSV_HEADERS と同じ並びの列の型 */
const CONTRACT_TYPES: XlsxCellType[] = ["text", "text", "text", "text", "date", "date", "number", "text", "number", "text", "text", "text"];

/** ?kind=（未指定は "applicant"、不正は 400） */
function kindParam(req: NextRequest): HrCsvKind {
  const raw = req.nextUrl.searchParams.get("kind");
  if (raw == null || raw === "") return "applicant";
  const parsed = hrCsvKindSchema.safeParse(raw);
  if (!parsed.success) throw new ExportError(400, "種類は ?kind=applicant / contract で指定してください。");
  return parsed.data;
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
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
    const sheet = sheetFromRows("業務委託契約", contractsCsvRows(rows), { types: CONTRACT_TYPES });
    return xlsxResponse(xlsxFilename(hrCsvFilename(kind)), buildXlsx([sheet]));
  }

  const rows = await fetchAllRows((from, to) =>
    supabase.from("v_applicant_list").select("*").eq("company_id", company.id).order("applied_on", { ascending: false }).order("name").range(from, to),
  );
  const sheet = sheetFromRows("応募者", applicantsCsvRows(rows), { types: APPLICANT_TYPES });
  return xlsxResponse(xlsxFilename(hrCsvFilename(kind)), buildXlsx([sheet]));
});
