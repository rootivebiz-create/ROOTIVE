import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrlFromRequest } from "@/lib/request-url";
import { recordLoginEvent } from "@/lib/auth/login-events";

/** ログアウト（POST のみ）。他サイトからの自動送信（CSRF）を防ぐため Origin / Referer が自サイトであることを確認する */
export async function POST(request: NextRequest) {
  const self = absoluteUrlFromRequest(request, "/").host;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const sourceHost = origin ? safeHost(origin) : referer ? safeHost(referer) : null;
  if (sourceHost && sourceHost !== self) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = await createClient();
  // ログアウトの記録（0019）。サインアウトすると誰だったか分からなくなるので、先に記録する
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await recordLoginEvent(user?.id, "logout", request);
  await supabase.auth.signOut();
  return NextResponse.redirect(absoluteUrlFromRequest(request, "/login"), { status: 303 });
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
