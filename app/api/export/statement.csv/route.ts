/**
 * GET /api/export/statement.csv?m=YYYY-MM&driver=<uuid> — 個人明細 CSV（§8.1）
 * スタッフは任意、driver は自分の締め済み月のみ。会社売上・利益は含めない
 */
import type { NextRequest } from "next/server";
import { statementToCsv } from "@/lib/exports/statement-csv";
import { csvResponse, safeFilePart } from "@/lib/exports/download";
import { handleExport } from "../_lib/guard";
import { loadStatementForExport } from "../_lib/statement";

export const dynamic = "force-dynamic";

export const GET = handleExport(async (req: NextRequest) => {
  const { data, showRoyaltyRate } = await loadStatementForExport(req);
  return csvResponse(`支払明細_${data.month}_${safeFilePart(data.driverName)}.csv`, statementToCsv(data, { showRoyaltyRate }));
});
