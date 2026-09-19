/**
 * GET /api/contract-file?id=<contract_id> — 締結済みの契約書ファイルを開く
 *
 * - スタッフ（owner/admin/viewer）は自社の契約、ドライバーは自分の契約だけ（contracts の RLS で絞る）
 * - Storage（非公開バケット contracts）の署名付き URL（60 秒）を作って 302 リダイレクトする
 * - 手入力の「保管場所メモ」（Storage のパスではない file_path）は 404 にする
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/schemas/common";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTRACT_BUCKET = "contracts";
/** 署名付き URL の有効時間（秒） */
const SIGNED_URL_TTL = 60;

export async function GET(req: NextRequest) {
  const parsed = uuidSchema.safeParse(req.nextUrl.searchParams.get("id") ?? "");
  if (!parsed.success) return new NextResponse("契約は ?id=<ID> で指定してください。", { status: 400 });

  const session = await getSessionContext();
  if (!session) return new NextResponse("ログインが必要です。", { status: 401 });

  // RLS で自社（ドライバーは自分）の契約だけが見える
  const { data, error } = await session.supabase.from("contracts").select("id, company_id, file_path").eq("id", parsed.data).maybeSingle();
  if (error) {
    console.error("[api/contract-file]", error);
    return new NextResponse("契約書を読み出せませんでした。", { status: 500 });
  }
  if (!data) return new NextResponse("契約が見つかりません。", { status: 404 });

  const path = data.file_path ?? "";
  // 自社フォルダ配下に保管したファイルだけを配信する（手入力の保管場所メモは対象外）
  if (!path || !path.startsWith(`${data.company_id}/`) || path.includes("..")) {
    return new NextResponse("契約書ファイルは登録されていません。", { status: 404 });
  }

  const admin = createAdminClient();
  const signed = await admin.storage.from(CONTRACT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signed.error || !signed.data?.signedUrl) return new NextResponse("契約書ファイルを読み出せませんでした。", { status: 404 });

  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
