import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { AuthError, requireUser, type SessionUser } from "~/server/auth";
import { fileResponse } from "~/server/download";
import { loadLetterSource } from "~/server/features/reconcile";
import { letterDocument, pickLetterItems } from "~/server/features/reconcile/letter";
import { letterPdfFileName, renderLetterPdf } from "~/server/pdf/reconcile-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 作れなかったときは、理由と戻り先だけの小さな画面を返す */
function problemPage(message: string, status: number, back: string): Response {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>問い合わせ文の PDF を作れませんでした</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.7">
<h1 style="font-size:1.25rem">問い合わせ文の PDF を作れませんでした</h1>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p><a href="${esc(back)}" style="display:inline-block;min-height:44px;line-height:44px">戻る</a></p>
</body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** 文字の欄（長すぎるものは切る） */
function textField(form: URLSearchParams | FormData, name: string, max: number): string | null {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : null;
}

/** ほかのサイトから送られたフォームは受けない（ブラウザが Origin を付けたときだけ確かめる） */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    const own = [new URL(req.url).host, req.headers.get("host"), req.headers.get("x-forwarded-host")].filter(Boolean);
    return own.includes(host);
  } catch {
    return false;
  }
}

/**
 * 問い合わせ文の PDF。画面と同じ文面（選んだ差・宛名・差出人・日ごとの記録の一文）に、差の一覧の表と合計を付ける。
 * GET ?items=<id>&items=<id>&contact=&sender=&offer=1。画面で文面を直したときは POST（body に直した文面）
 */
async function handle(req: Request, noticeId: string, form: URLSearchParams | FormData, allowBody: boolean): Promise<Response> {
  const back = UUID.test(noticeId) ? `/reconcile/${noticeId}/letter` : "/reconcile";
  let user: SessionUser;
  try {
    user = await requireUser("staff", { readOnly: true });
  } catch (error) {
    if (error instanceof AuthError) return problemPage(error.message, 403, back);
    throw error;
  }
  if (!UUID.test(noticeId)) return problemPage("お支払通知が見つかりません。突合の一覧から開き直してください。", 404, back);
  const db = await getDb();
  let source;
  try {
    source = await loadLetterSource(db, user.tenantId, noticeId);
  } catch (error) {
    if (error instanceof UserError) return problemPage(error.message, 404, "/reconcile");
    throw error;
  }
  const wanted = form.getAll("items").filter((v): v is string => typeof v === "string" && v.length > 0);
  const chosen = pickLetterItems(source.items, wanted);
  if (chosen.length === 0) {
    return problemPage(
      source.items.length === 0 ? "問い合わせる差がありません（未対応・問い合わせ済みの差がありません）。" : "選んだ差が見つかりません。突き合わせ直したため変わったかもしれません。問い合わせ文の画面を開き直してください。",
      400,
      back,
    );
  }
  const sender = textField(form, "sender", 60);
  const doc = letterDocument(
    {
      clientName: source.clientName,
      contactName: textField(form, "contact", 100) ?? "ご担当者様",
      companyName: source.view.tenantName,
      senderName: sender ?? user.name,
      month: source.view.notice.month,
      items: chosen,
      offerRecords: form.get("offer") !== "0",
      period: source.period,
    },
    { body: allowBody ? textField(form, "body", 20000) : null },
  );
  try {
    const bytes = await renderLetterPdf(doc);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "export.reconcile_letter",
      entity: "payment_notice",
      entityId: noticeId,
      detail: { items: chosen.map((i) => i.id), total: doc.total, edited: doc.edited },
    });
    return fileResponse(bytes, letterPdfFileName(doc), "application/pdf");
  } catch (error) {
    console.error("reconcile letter pdf failed", error instanceof Error ? error.message : error);
    return problemPage("PDF を作れませんでした。時間をおいてもう一度お試しください。文面は画面の「コピー」でも使えます。", 500, back);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ noticeId: string }> }): Promise<Response> {
  const { noticeId } = await params;
  return handle(req, noticeId, new URL(req.url).searchParams, false);
}

/** 画面で直した文面で作るとき（文面が長いので POST で受ける） */
export async function POST(req: Request, { params }: { params: Promise<{ noticeId: string }> }): Promise<Response> {
  const { noticeId } = await params;
  if (!sameOrigin(req)) return problemPage("この画面からは作れません。問い合わせ文の画面から作り直してください。", 403, "/reconcile");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return problemPage("送られた内容を読めませんでした。問い合わせ文の画面から作り直してください。", 400, `/reconcile/${noticeId}/letter`);
  }
  return handle(req, noticeId, form, true);
}
