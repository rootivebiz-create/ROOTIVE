/**
 * GET /api/export/statement.pdf?m=YYYY-MM&driver=<uuid> — PDF 支払明細（§8.3、A4 縦）
 * スタッフは任意、driver は自分の締め済み月のみ。会社利益は載せない
 */
import type { NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { loadStatementAssets } from "@/lib/company-assets";
import { renderStatementPdf, statementPdfFilename } from "@/lib/pdf/statement";
import { pdfResponse, safeFilePart } from "@/lib/exports/download";
import { handleExport } from "../_lib/guard";
import { loadStatementForExport } from "../_lib/statement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleExport(async (req: NextRequest) => {
  const { data, showRoyaltyRate } = await loadStatementForExport(req);
  // ロゴ・認印（getSessionContext は同一リクエスト内でキャッシュされるので二重の認証コストは無い）
  const ctx = await getSessionContext();
  const assets = ctx ? await loadStatementAssets(ctx.company) : {};
  const pdf = await renderStatementPdf(data, { showRoyaltyRate, assets });
  return pdfResponse(statementPdfFilename({ month: data.month, driverName: safeFilePart(data.driverName) }), pdf);
});
