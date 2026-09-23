import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { latestTermsPdfSources } from "~/server/features/terms";
import { todayJst } from "~/server/features/terms/links";
import { renderTermsPdf } from "~/server/pdf/terms-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 有効なドライバー全員の、最新の版の明示書を 1 つの PDF に（1 人ずつ改ページ。見るだけの人も出せる） */
export async function GET() {
  let user: SessionUser;
  try {
    user = await requireUser("viewer", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return text(error.message, 403);
    throw error;
  }
  const db = await getDb();
  const sources = await latestTermsPdfSources(db, user.tenantId);
  if (sources.length === 0) return text("明示書がまだありません。取引条件の明示の画面で作ってください", 404);
  const bytes = await renderTermsPdf(sources);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.terms_pdf_all",
    entity: "terms_record",
    detail: { count: sources.length, records: sources.map((x) => ({ id: x.doc.recordId, version: x.doc.version })) },
  });
  return fileResponse(bytes, `取引条件の明示書_全員_${todayJst()}.pdf`, "application/pdf");
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
