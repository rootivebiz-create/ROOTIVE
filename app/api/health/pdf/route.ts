/**
 * GET /api/health/pdf — 本番のサーバーで日本語フォント入りの PDF が描けるかを確かめる。
 *
 * - 公開の手順（.github/workflows/deploy.yml の「PDF の確認」）がデプロイの直後に呼ぶ。ログイン不要
 * - 会社・ドライバーの情報は使わない。返すのは成否・PDF の大きさ・フォントの場所と大きさ・かかった時間・失敗の理由だけ
 * - 1 つのサーバーの中では結果を覚える（うまくいったら 5 分、失敗は 30 秒。何度呼ばれても描き直すのはその間隔だけ）
 */
import { NextResponse } from "next/server";
import { runPdfCheck, type PdfCheckResult } from "@/lib/pdf/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OK_CACHE_MS = 5 * 60 * 1000;
const FAIL_CACHE_MS = 30 * 1000;
let last: { at: number; result: PdfCheckResult } | null = null;

export async function GET() {
  const ttl = last?.result.ok ? OK_CACHE_MS : FAIL_CACHE_MS;
  if (!last || Date.now() - last.at > ttl) last = { at: Date.now(), result: await runPdfCheck() };
  return NextResponse.json(last.result, { status: last.result.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
