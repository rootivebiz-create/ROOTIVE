import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { csvText, fileResponse, utf8WithBom } from "~/server/download";
import { TERMS_CSV_HEADER, termsRecordRows } from "~/server/features/terms";
import { todayJst } from "~/server/features/terms/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 取引条件の記録の全部の版（明示した日・送付・受け取り・目印）を CSV で（見るだけの人も出せる） */
export async function GET() {
  let user: SessionUser;
  try {
    user = await requireUser("viewer", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return text(error.message, 403);
    throw error;
  }
  const db = await getDb();
  const rows = await termsRecordRows(db, user.tenantId);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.terms_csv",
    entity: "terms_record",
    detail: { rows: rows.length },
  });
  return fileResponse(utf8WithBom(csvText([TERMS_CSV_HEADER, ...rows])), `取引条件の記録_${todayJst()}.csv`, "text/csv; charset=utf-8");
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
