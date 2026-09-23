import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "~/db/client";
import { clientIpHash, createSession } from "~/server/auth";
import { isDemoMode, startDemoTenant } from "~/server/demo";
import { tooMany } from "~/server/rate-limit";

export const dynamic = "force-dynamic";

/** デモの入口：来た人ごとに架空の会社を作り、そのオーナーとして入る（ログインなし） */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (!isDemoMode()) {
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const ip = (await clientIpHash()) ?? "unknown";
  if (tooMany(`demo:${ip}`, 10, 10 * 60 * 1000)) {
    return new NextResponse("デモの作成が続いています。少し時間をおいてから開き直してください。", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const db = await getDb();
  const { tenantId, userId } = await startDemoTenant(db);
  await createSession({ id: userId, tenantId });
  const next = request.nextUrl.searchParams.get("next");
  url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  url.search = "";
  return NextResponse.redirect(url);
}
