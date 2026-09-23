import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { monthPdfSources } from "~/server/features/statements";
import { jpMonthLabel } from "~/server/features/statements/view";
import { monthFromParam } from "~/server/month";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 1 か月分の明細を 1 つの PDF に（1 人ずつ改ページ） */
export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) return text(error.message, 403);
    throw error;
  }
  const month = monthFromParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const db = await getDb();
  const sources = await monthPdfSources(db, user.tenantId, month);
  if (sources.length === 0) return text(`${jpMonthLabel(month)}の明細はまだありません。先に「支払明細」の画面で明細を作ってください`, 404);
  const bytes = await renderStatementsPdf(sources);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.statements_pdf",
    entity: "month",
    entityId: month,
    detail: { count: sources.length },
  });
  return fileResponse(bytes, `支払明細_${jpMonthLabel(month)}_全員分.pdf`, "application/pdf");
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
