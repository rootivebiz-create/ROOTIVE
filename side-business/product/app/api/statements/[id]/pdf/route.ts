import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { statementPdfSource } from "~/server/features/statements";
import { jpMonthLabel } from "~/server/features/statements/view";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 1 人の明細の PDF（会社の画面から。見るだけの人も出せる） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) return text(error.message, 403);
    throw error;
  }
  const { id } = await params;
  const db = await getDb();
  const source = await statementPdfSource(db, user.tenantId, id);
  if (!source) return text("明細が見つかりません。一覧から開き直してください", 404);
  const bytes = await renderStatementsPdf([source]);
  const v = source.view;
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.statement_pdf",
    entity: "statement",
    entityId: id,
    detail: { month: v.month, version: v.version },
  });
  return fileResponse(bytes, `支払明細_${jpMonthLabel(v.month)}_${v.driver.name}_版${v.version}.pdf`, "application/pdf");
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
