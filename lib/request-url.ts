import type { NextRequest } from "next/server";

/**
 * リダイレクト先の絶対 URL を「実際にアクセスされたホスト」から組み立てる。
 * next start や逆プロキシ配下では request.url のホストが localhost になることがあり、
 * その場合 Cookie のドメインと食い違ってセッションが無効になるため、Host / X-Forwarded-* ヘッダを優先する。
 */
export function absoluteUrlFromRequest(request: NextRequest, path: string): URL {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
  return new URL(path, `${proto}://${host}`);
}
