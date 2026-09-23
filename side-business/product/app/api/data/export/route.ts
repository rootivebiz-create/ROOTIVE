import { getDb } from "~/db/client";
import { AuthError, requireUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { auditTenantExport, buildTenantExport } from "~/server/features/export-all";

export const dynamic = "force-dynamic";

/**
 * GET /api/data/export → 会社の全データ（ZIP：表ごとの CSV・manifest.json・明細の全部の版・README.txt）。
 * オーナーだけ。書き出したことを操作の記録に残す。
 */
export async function GET(): Promise<Response> {
  let user;
  try {
    user = await requireUser("owner", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(`${error.message}（全データの書き出しはオーナーだけができます）`, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
  const db = await getDb();
  try {
    const ex = await buildTenantExport(db, user.tenantId, { exportedBy: user.name });
    await auditTenantExport(db, user.tenantId, user.id, ex);
    return fileResponse(ex.bytes, ex.fileName, "application/zip");
  } catch (error) {
    console.error("export failed", error instanceof Error ? error.message : error);
    return new Response("書き出せませんでした。時間をおいてもう一度お試しください。", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
