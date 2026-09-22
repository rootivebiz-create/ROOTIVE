/**
 * GET /api/version — いまサーバーが配っている版を返す。
 *
 * 画面側がこれを定期的に見て、自分が読み込んだ版と違えば
 * 「新しい版があります」を出す（Service Worker が古い中身を握っていても気づける）。
 * ログイン不要（版の文字列だけで、会社の情報は含まない）。
 */
import { NextResponse } from "next/server";
import { buildId } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ build: buildId() }, { headers: { "Cache-Control": "no-store" } });
}
