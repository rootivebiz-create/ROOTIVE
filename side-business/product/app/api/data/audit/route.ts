import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser } from "~/server/auth";
import { csvText, fileResponse, utf8WithBom } from "~/server/download";
import { auditCsvRows, type AuditScope } from "~/server/features/close";
import { monthFromParam, monthLabelJa } from "~/server/month";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/audit?m=YYYY-MM[&scope=period][&kind=…][&who=…]
 * → 操作の記録（CSV・UTF-8 BOM 付き）。事務・オーナーだけ。出したことも記録に残す。
 */
export async function GET(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireUser("staff", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return new Response(error.message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    throw error;
  }
  const sp = new URL(request.url).searchParams;
  const m = sp.get("m") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
    return new Response("月の指定が正しくありません（例：?m=2026-10）", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const month = monthFromParam(m);
  const scope: AuditScope = sp.get("scope") === "period" ? "period" : "month";
  const kind = (sp.get("kind") ?? "").slice(0, 40) || null;
  const who = (sp.get("who") ?? "").slice(0, 60) || null;
  const db = await getDb();
  const rows = await auditCsvRows(db, user.tenantId, { month, scope, kind, who });
  await audit(db, {
    tenantId: user.tenantId,
    userId: user.id,
    action: "export.audit_csv",
    entity: "month",
    entityId: month,
    detail: { month, scope, kind, who, rows: rows.length - 1 },
  });
  const suffix = scope === "period" ? "中の操作" : "分";
  return fileResponse(utf8WithBom(csvText(rows)), `操作の記録_${monthLabelJa(month)}${suffix}.csv`, "text/csv; charset=utf-8");
}
