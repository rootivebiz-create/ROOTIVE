import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { termsPdfFileName, termsPdfSource } from "~/server/features/terms";
import { renderTermsPdf } from "~/server/pdf/terms-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 明示書 1 通（1 つの版）の PDF（会社の画面から。見るだけの人も出せる） */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireUser("viewer", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return text(error.message, 403);
    throw error;
  }
  const { id } = await params;
  const db = await getDb();
  const source = await termsPdfSource(db, user.tenantId, id);
  if (!source) return text("明示書が見つかりません。一覧から開き直してください", 404);
  const bytes = await renderTermsPdf([source]);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.terms_pdf",
    entity: "terms_record",
    entityId: id,
    detail: { version: source.doc.version, hash: source.doc.hash },
  });
  return fileResponse(bytes, termsPdfFileName(source.doc), "application/pdf");
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
