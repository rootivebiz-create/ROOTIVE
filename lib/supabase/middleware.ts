import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/database.types";

// /api/cron は Vercel Cron（Cookie なし）から呼ばれるため公開扱い。認可は Route Handler 側の CRON_SECRET で行う
const PUBLIC_PREFIXES = ["/login", "/invite", "/auth", "/api/cron", "/manifest.webmanifest", "/icons", "/sw.js", "/offline"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

/** セッション Cookie の更新と未ログイン時のリダイレクト */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // ここでやることは 2 つだけ：
  //   1. 期限が近いアクセストークンを更新して Cookie に書き戻す
  //   2. 未ログインならログイン画面へ寄せる（体感のため。本当の可否判定ではない）
  //
  // 以前は毎回 auth.getUser() を呼んでいたが、これは **Auth サーバーへの往復**で、
  // 画面を開くたびに直列の待ち時間が増えていた（0021 で見直し）。
  // getSession() はトークンが生きていればローカルで読むだけ、
  // 期限切れのときだけ更新の通信をする。
  //
  // **認可は必ず後段で行う**：ページ・Server Action は getSessionContext()（RPC `me()`）を通り、
  // PostgREST が JWT を検証し、さらに DB の RLS が効く。
  // ここを通り抜けても、偽のトークンでは 1 行も読めない。
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;
  if (!session && !isPublicPath(pathname) && pathname !== "/") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const next = pathname + (request.nextUrl.search || "");
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }
  // ログイン済みユーザーが /login を開いた場合の振り分けは、ログインページ側（プロフィールの有効性を確認）で行う
  return response;
}
