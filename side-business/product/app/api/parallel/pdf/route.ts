import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { loadParallelReport } from "~/server/features/parallel";
import { monthFromParam, monthLabelJa } from "~/server/month";
import { renderParallelPdf } from "~/server/pdf/parallel-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 作れなかったときは、理由と戻り先だけの小さな画面を返す */
function problemPage(message: string, status: number, m?: string): Response {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const back = m ? `/parallel?m=${m}` : "/parallel";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>並行運用レポートを出せませんでした</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">
<h1 style="font-size:1.25rem">並行運用レポートを出せませんでした</h1>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p><a href="${esc(back)}" style="display:inline-block;min-height:44px;line-height:44px">Excel と比べる画面へ戻る</a></p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** GET /api/parallel/pdf?m=YYYY-MM → 並行運用レポート（A4・1 ページ）。見るだけの人も受け取れる */
export async function GET(req: Request): Promise<Response> {
  let user: SessionUser;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) return problemPage(error.message, 403);
    throw error;
  }
  const month = monthFromParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const m = month.slice(0, 7);
  const db = await getDb();
  try {
    const report = await loadParallelReport(db, user.tenantId, month);
    if (report.view.summary.compared === 0) {
      return problemPage(`${monthLabelJa(month)}分は、まだ Excel の振込額が入っていません。「Excel と比べる」の画面で入れると、並行運用レポートを出せます。`, 404, m);
    }
    const bytes = await renderParallelPdf(report);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "export.parallel_pdf",
      entity: "month",
      entityId: month,
      detail: { compared: report.view.summary.compared, matched: report.view.summary.matched, diffTotal: report.view.summary.diffTotal, ready: report.gate.ready },
    });
    return fileResponse(bytes, `並行運用レポート_${monthLabelJa(month)}.pdf`, "application/pdf");
  } catch (error) {
    if (error instanceof UserError) return problemPage(error.message, 400, m);
    console.error("parallel pdf failed", error instanceof Error ? error.message : error);
    return problemPage("PDF を作れませんでした。時間をおいてもう一度お試しください。", 500, m);
  }
}
