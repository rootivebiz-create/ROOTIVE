/**
 * GET /api/export/records.csv — 書類の索引簿 CSV（電子帳簿保存法の検索要件）。スタッフ（owner/admin/viewer）
 * クエリ：from / to（取引年月日）、min / max（取引金額）、q（取引先・件名）、kinds（カンマ区切り）、missing=1
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { handleExport, requireExportRole } from "../_lib/guard";
import { recordExport } from "@/lib/exports/record";
import { csvResponse } from "@/lib/exports/download";
import { recordsCsvFilename, recordsToCsv } from "@/lib/exports/records-csv";
import { loadRecordDocs } from "@/lib/records/load";
import { filterRecords, RECORD_KINDS, type RecordFilter, type RecordKind } from "@/lib/records";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function numberParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function kindsParam(raw: string | null): RecordKind[] {
  if (!raw) return [];
  const want = new Set(raw.split(",").map((s) => s.trim()));
  return RECORD_KINDS.filter((k) => want.has(k));
}

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(STAFF_ROLES);
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const filter: RecordFilter = {
    from: from && DATE_RE.test(from) ? from : undefined,
    to: to && DATE_RE.test(to) ? to : undefined,
    minAmount: numberParam(sp.get("min")),
    maxAmount: numberParam(sp.get("max")),
    q: (sp.get("q") ?? "").slice(0, 100) || undefined,
    kinds: kindsParam(sp.get("kinds")),
    missingFileOnly: sp.get("missing") === "1",
  };

  const docs = filterRecords(await loadRecordDocs(supabase, company.id), filter);
  await recordExport({ profileId: profile.id, kind: "records", label: "書類の索引簿 CSV", rows: docs.length, req });
  return csvResponse(recordsCsvFilename(filter.from, filter.to), recordsToCsv(docs));
});
