import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { AuthError, requireUser } from "~/server/auth";
import { fileResponse, utf8WithBom } from "~/server/download";
import { auditTransferDownload, buildTransferCsv, buildTransferFile } from "~/server/features/transfer";

export const dynamic = "force-dynamic";

/** 作れなかったときは、理由と戻り先だけの小さな画面を返す（ファイルの代わりに） */
function problemPage(message: string, status: number, month?: string): Response {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const back = month ? `/transfer?m=${month.slice(0, 7)}` : "/transfer";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>振込データを出せませんでした</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">
<h1 style="font-size:1.25rem">振込データを出せませんでした</h1>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p><a href="${esc(back)}" style="display:inline-block;min-height:44px;line-height:44px">振込データの画面へ戻る</a></p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * GET /api/transfer/<振込データの id>          → 全銀の振込データ（.txt・Shift_JIS）
 * GET /api/transfer/<振込データの id>?format=csv → 振込の一覧（CSV・UTF-8 BOM 付き）
 */
export async function GET(request: Request, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  let user;
  try {
    user = await requireUser("staff");
  } catch (error) {
    if (error instanceof AuthError) return problemPage(error.message, 403);
    throw error;
  }
  const { batchId } = await params;
  const sp = new URL(request.url).searchParams;
  const format = sp.get("format") === "csv" ? "csv" : "zengin";
  // 戻り先の月（画面のリンクに付けてある）
  const m = sp.get("m");
  const backMonth = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? `${m}-01` : undefined;
  const db = await getDb();
  try {
    if (format === "csv") {
      const { fileName, text, batch } = await buildTransferCsv(db, user.tenantId, batchId);
      await auditTransferDownload(db, user.tenantId, user.id, batch, "csv");
      return fileResponse(utf8WithBom(text), fileName, "text/csv; charset=utf-8");
    }
    // 全銀のデータは半角だけ（英数字・半角カナ）なので、Shift_JIS の 1 バイトのまま出す
    const file = await buildTransferFile(db, user.tenantId, batchId);
    await auditTransferDownload(db, user.tenantId, user.id, file.batch, "zengin");
    return fileResponse(file.bytes, file.fileName, "text/plain; charset=Shift_JIS");
  } catch (error) {
    if (error instanceof UserError) {
      const notFound = error.message.includes("見つかりません");
      return problemPage(error.message, notFound ? 404 : 409, backMonth);
    }
    console.error("transfer download failed", error instanceof Error ? error.message : error);
    return problemPage("振込データを作れませんでした。時間をおいてもう一度お試しください。", 500, backMonth);
  }
}
