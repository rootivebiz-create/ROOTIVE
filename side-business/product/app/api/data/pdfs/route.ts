import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { AuthError, requireUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { auditPdfArchive, buildPdfArchive } from "~/server/features/export-all/pdfs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 1 年ぶんの PDF を作るのに時間がかかることがあるため（Vercel の関数の長さの上限） */
export const maxDuration = 300;

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * GET /api/data/pdfs?year=2026 → その年の支払明細と取引条件の明示書の全部の版（PDF）を 1 つの ZIP に。
 * オーナーだけ。書き出したことを操作の記録に残す。
 */
export async function GET(req: Request): Promise<Response> {
  let user;
  try {
    user = await requireUser("owner", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return text(`${error.message}（PDF の書き出しはオーナーだけができます）`, 403);
    throw error;
  }
  const raw = new URL(req.url).searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(raw)) return text("年を選んでください（例：?year=2026）", 400);
  const db = await getDb();
  try {
    const archive = await buildPdfArchive(db, user.tenantId, Number(raw));
    await auditPdfArchive(db, user.tenantId, user.id, archive);
    return fileResponse(archive.bytes, archive.fileName, "application/zip");
  } catch (error) {
    if (error instanceof UserError) return text(error.message, 404);
    console.error("pdf export failed", error instanceof Error ? error.message : error);
    return text("書き出せませんでした。時間をおいてもう一度お試しください。", 500);
  }
}
