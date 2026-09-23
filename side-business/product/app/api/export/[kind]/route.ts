import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { AuthError, requireUser, roleAtLeast, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { buildAccountingFile, parseExportKind } from "~/server/features/accounting";
import { monthFromParam } from "~/server/month";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 作れなかったときは、理由と戻り先だけの小さな画面を返す（ファイルの代わりに） */
function problemPage(message: string, status: number, m?: string): Response {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const back = m ? `/export?m=${m}` : "/export";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ファイルを出せませんでした</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">
<h1 style="font-size:1.25rem">ファイルを出せませんでした</h1>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p><a href="${esc(back)}" style="display:inline-block;min-height:44px;line-height:44px">会計ソフトへの出力の画面へ戻る</a></p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * GET /api/export/<種類>?m=YYYY-MM
 * 種類：yayoi（弥生会計）・freee（弥生会計の形式）・mf（マネーフォワード 仕訳帳）・generic（汎用 CSV）・payments（支払一覧）
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }): Promise<Response> {
  let user: SessionUser;
  try {
    // 出力は読むだけなので、保存できないデモ（DEMO_READONLY）でも出せるように、ログインを確かめてから役割を見る
    user = await requireUser("viewer");
    if (!roleAtLeast(user.role, "staff")) throw new AuthError("この操作をする権限がありません");
  } catch (error) {
    if (error instanceof AuthError) return problemPage(error.message, 403);
    throw error;
  }
  const kind = parseExportKind((await params).kind);
  const month = monthFromParam(new URL(req.url).searchParams.get("m") ?? undefined);
  const m = month.slice(0, 7);
  if (!kind) return problemPage("出力の種類が正しくありません。画面のボタンから出してください。", 404, m);
  const db = await getDb();
  try {
    const file = await buildAccountingFile(db, user.tenantId, month, kind);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: kind === "payments" ? "export.payments_csv" : "export.accounting",
      entity: "month",
      entityId: month,
      detail: { kind, fileName: file.fileName, rows: file.rows, slips: file.slips, unmappable: file.unmappable },
    });
    return fileResponse(file.bytes, file.fileName, file.contentType);
  } catch (error) {
    if (error instanceof UserError) return problemPage(error.message, error.message.includes("まだありません") ? 404 : 409, m);
    console.error("accounting export failed", error instanceof Error ? error.message : error);
    return problemPage("ファイルを作れませんでした。時間をおいてもう一度お試しください。", 500, m);
  }
}
