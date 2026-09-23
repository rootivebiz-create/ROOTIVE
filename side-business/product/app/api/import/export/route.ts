import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { buildWorkExport } from "~/server/features/import/export";
import { monthFromParam, monthLabelJa } from "~/server/month";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 出せなかったときは、理由と戻り先だけの小さな画面を返す（ファイルの代わりに） */
function problemPage(message: string, status: number, m?: string): Response {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const back = m ? `/work?m=${m}` : "/work";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Excel に戻せませんでした</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">
<h1 style="font-size:1.25rem">Excel に戻せませんでした</h1>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p><a href="${esc(back)}" style="display:inline-block;min-height:44px;line-height:44px">稼働と調整の画面へ戻る</a></p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * GET /api/import/export?m=YYYY-MM
 * その月の稼働を、取り込んだときと同じ列の並びの Excel（.xlsx）にする（取り込みが無ければ、ふつうの形）。閲覧の役割でも出せる。
 */
export async function GET(req: Request): Promise<Response> {
  let user: SessionUser;
  try {
    user = await requireUser("viewer", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return problemPage(error.message, 403);
    throw error;
  }
  const month = monthFromParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const m = month.slice(0, 7);
  const db = await getDb();
  try {
    const file = await buildWorkExport(db, user.tenantId, month);
    if (file.entries === 0) return problemPage(`${monthLabelJa(month)}の稼働はまだありません。取り込みか手入力で稼働を入れてから出してください。`, 404, m);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "import.export",
      entity: "month",
      entityId: month,
      detail: { fileName: file.fileName, rows: file.rows, entries: file.entries, layout: file.layout.source, from: file.layout.fileName },
    });
    return fileResponse(file.bytes, file.fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) {
    console.error("work export failed", error instanceof Error ? error.message : error);
    return problemPage("ファイルを作れませんでした。時間をおいてもう一度お試しください。", 500, m);
  }
}
