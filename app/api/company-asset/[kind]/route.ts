/**
 * GET /api/company-asset/logo | seal — 会社のロゴ・認印の画像（ログイン中のユーザーの会社のもの。全ロール）
 * Storage（非公開バケット）からサービスロールで読み出して返す。未設定なら 404
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { companyAssetPathOf, downloadCompanyAsset, isCompanyAssetKind, isOwnedAssetPath } from "@/lib/company-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!isCompanyAssetKind(kind)) return new NextResponse("画像の種類が不正です。", { status: 400 });
  const session = await getSessionContext();
  if (!session) return new NextResponse("ログインが必要です。", { status: 401 });
  const path = companyAssetPathOf(session.company, kind);
  if (!path || !isOwnedAssetPath(session.company.id, path)) return new NextResponse("画像は登録されていません。", { status: 404 });
  const file = await downloadCompanyAsset(path);
  if (!file) return new NextResponse("画像を読み出せませんでした。", { status: 404 });
  const body = new ArrayBuffer(file.bytes.byteLength);
  new Uint8Array(body).set(file.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      ETag: `"${path}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
