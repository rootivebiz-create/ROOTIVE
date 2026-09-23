import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { csvText, fileResponse, utf8WithBom } from "~/server/download";
import { confirmationRecordRows } from "~/server/features/statements";
import { jpMonthLabel } from "~/server/features/statements/view";
import { monthFromParam } from "~/server/month";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 確認の記録（CSV・UTF-8 BOM）：月・ドライバー・版・ハッシュ・振込額・送付・開いた日時（今の中身を初めて）・確認 */
export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    throw error;
  }
  const month = monthFromParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const db = await getDb();
  const rows = await confirmationRecordRows(db, user.tenantId, month);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.statement_confirmations",
    entity: "month",
    entityId: month,
    detail: { rows: rows.length - 1 },
  });
  return fileResponse(utf8WithBom(csvText(rows)), `確認の記録_${jpMonthLabel(month)}.csv`, "text/csv; charset=utf-8");
}
