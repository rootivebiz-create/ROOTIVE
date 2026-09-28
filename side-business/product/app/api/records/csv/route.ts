import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { csvText, fileResponse, utf8WithBom } from "~/server/download";
import { parseRecordsQuery, recordsCsvRows, searchStatementRecords } from "~/server/features/statements/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 明細の検索の索引（CSV・UTF-8 BOM）：版ごとに 1 行。画面と同じ条件で、件数の上限なし */
export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireUser("viewer", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(error.message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    throw error;
  }
  const url = new URL(req.url);
  const q = parseRecordsQuery(Object.fromEntries(url.searchParams));
  const db = await getDb();
  const result = await searchStatementRecords(db, user.tenantId, q, Number.MAX_SAFE_INTEGER);
  const rows = recordsCsvRows(result);
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.records_csv",
    entity: "statement",
    detail: { statements: result.total, rows: rows.length - 1, query: url.searchParams.toString().slice(0, 300) },
  });
  return fileResponse(utf8WithBom(csvText(rows)), "明細の索引.csv", "text/csv; charset=utf-8");
}
