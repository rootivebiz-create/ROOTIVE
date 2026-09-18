/**
 * GET /api/export/invoice.pdf?id=<uuid> — 請求書 PDF（A4 縦）。スタッフ（owner/admin/viewer）
 * ロゴ・認印は支払明細 PDF と同じ loadStatementAssets を使う
 */
import type { NextRequest } from "next/server";
import { STAFF_ROLES } from "@/lib/auth/session";
import { loadStatementAssets } from "@/lib/company-assets";
import { loadInvoiceData, invoicePdfFilename } from "@/lib/invoice";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { pdfResponse, safeFilePart } from "@/lib/exports/download";
import { uuidSchema } from "@/lib/schemas/common";
import { ExportError, handleExport, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company } = await requireExportRole(STAFF_ROLES);
  const parsed = uuidSchema.safeParse(req.nextUrl.searchParams.get("id") ?? "");
  if (!parsed.success) throw new ExportError(400, "請求書は ?id=<ID> で指定してください。");

  const data = await loadInvoiceData(supabase, company.id, parsed.data);
  if (!data) throw new ExportError(404, "請求書が見つかりません。");

  const assets = await loadStatementAssets(company);
  const pdf = await renderInvoicePdf(data, { assets });
  return pdfResponse(invoicePdfFilename({ month: data.month, client: { name: safeFilePart(data.client.name) } }), pdf);
});
