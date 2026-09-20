/**
 * GET /api/export/statement.xlsx?m=YYYY-MM&driver=<uuid> — 個人明細 Excel
 * スタッフは任意、driver は自分の締め済み月のみ（statement.csv と同じ制限）。会社売上・利益は含めない。
 * 「明細」シート（statement.csv と同じ行）と「集計」シート（内訳とお支払額）の 2 シート。
 */
import type { NextRequest } from "next/server";
import type { StatementData } from "@/lib/statement";
import { statementToCsvRows } from "@/lib/exports/statement-csv";
import { buildXlsx, sheetFromRows, type XlsxCell, type XlsxCellType, type XlsxSheet } from "@/lib/exports/xlsx";
import { safeFilePart, xlsxResponse } from "@/lib/exports/download";
import { handleExport } from "../_lib/guard";
import { loadStatementForExport } from "../_lib/statement";
import { getSessionContext } from "@/lib/auth/session";
import { recordExport } from "@/lib/exports/record";

export const dynamic = "force-dynamic";

/** STATEMENT_CSV_HEADERS と同じ並びの列の型 */
const TYPES: XlsxCellType[] = ["text", "text", "text", "qty", "money", "money", "text"];

/** 集計シート：稼働 → ロイヤリティ → 管理費 → 小計（税抜）→ 消費税 → 調整 → お支払額 の順（CSV と同じ符号） */
function summarySheet(s: StatementData): XlsxSheet {
  const taxable = s.taxMode === "taxable";
  const money = (v: number, bold = false): XlsxCell => ({ v, t: "money", bold });
  const rows: XlsxCell[][] = [["項目", "金額"]];
  rows.push(["稼働（ドライバー売上）", money(s.pay)]);
  rows.push(["ロイヤリティ", money(-s.royalty)]);
  if (s.mgmtFee !== 0) rows.push(["管理費", money(-s.mgmtFee)]);
  rows.push(["小計（税抜）", money(s.taxBase, true)]);
  if (taxable) rows.push([`消費税（${s.taxRateLabel}）`, money(s.tax)]);
  for (const a of s.adjustments) rows.push([`調整：${a.label}`, money(a.amount)]);
  rows.push([taxable ? "お支払額（税込）" : "お支払額", money(s.payoutIncl, true)]);
  rows.push(["振込予定日", { v: s.payoutDate, t: "date" }]);
  return { name: "集計", rows, columns: [{ width: 24 }, { width: 16 }], freezeHeader: true };
}

export const GET = handleExport(async (req: NextRequest) => {
  const { data, showRoyaltyRate } = await loadStatementForExport(req);

  const detail = sheetFromRows("明細", statementToCsvRows(data, { showRoyaltyRate }), { types: TYPES, autoFilter: false });
  const filename = `支払明細_${data.month}_${safeFilePart(data.driverName)}.xlsx`;
  // 持ち出しの記録（0020）。getSessionContext は同一リクエスト内でキャッシュされる
  const ctx = await getSessionContext();
  await recordExport({ profileId: ctx?.profile.id, kind: "statement", label: "支払明細 Excel", month: data.month, rows: 1, req });
  return xlsxResponse(filename, buildXlsx([detail, summarySheet(data)]));
});
