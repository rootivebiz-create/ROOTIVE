/**
 * 年次レポートの出力（CSV・Excel）の対象の範囲（0030）。
 * ?fy=YYYY は期（決算の年）、?y=YYYY は暦年。どちらも無ければ日本時間の今月が入る期
 */
import "server-only";
import type { NextRequest } from "next/server";
import type { Company } from "@/lib/db/types";
import { currentMonthJST } from "@/lib/month";
import { fiscalSettingsOf, parsePeriodYear } from "@/lib/fiscal";
import { parseYear, resolveReportRange, type ReportRange } from "@/components/reports/helpers";
import { ExportError } from "./guard";

export function reportRangeParam(req: NextRequest, company: Company): ReportRange {
  const fy = req.nextUrl.searchParams.get("fy");
  const y = req.nextUrl.searchParams.get("y");
  if (fy != null && fy !== "" && parsePeriodYear(fy) == null) throw new ExportError(400, "期は ?fy=YYYY（決算の年・西暦 4 桁）で指定してください。");
  if (y != null && y !== "" && parseYear(y) == null) throw new ExportError(400, "年は ?y=YYYY（西暦 4 桁）で指定してください。");
  return resolveReportRange({ fy: fy ?? undefined, y: y ?? undefined }, currentMonthJST(), fiscalSettingsOf(company));
}

/** ファイル名に入れる呼び方（期は「第3期」「2026年9月期」、暦年は「2026」） */
export function reportRangeFilePart(r: ReportRange): string {
  return r.view === "fiscal" ? r.label : String(r.year);
}
