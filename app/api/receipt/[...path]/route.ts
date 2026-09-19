/**
 * GET /api/receipt/<company_id>/<…> — レシート画像（スタッフのみ）
 * Storage（非公開バケット receipts）の署名付き URL からサーバー内で読み出して返す。
 * 他社のパス・ドライバーからの参照は 403。署名付き URL はブラウザには渡さない。
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { isOwnedReceiptPath } from "@/lib/intake/helpers";
import { downloadReceipt } from "@/lib/intake/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = (path ?? []).join("/");
  if (!key) return new NextResponse("画像のパスが不正です。", { status: 400 });

  const session = await getSessionContext();
  if (!session) return new NextResponse("ログインが必要です。", { status: 401 });
  if (session.profile.role === "driver") return new NextResponse("この画像を表示する権限がありません。", { status: 403 });
  if (!isOwnedReceiptPath(session.company.id, key)) return new NextResponse("この画像を表示する権限がありません。", { status: 403 });

  const file = await downloadReceipt(key);
  if (!file) return new NextResponse("画像が見つかりません。", { status: 404 });

  const body = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(body).set(file.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      ETag: `"${key}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
