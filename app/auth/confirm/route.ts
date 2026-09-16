import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrlFromRequest } from "@/lib/request-url";

/**
 * next パラメータの検証：サイト内の絶対パス、または同一ホストの絶対 URL（メールテンプレートの {{ .RedirectTo }}）のみ許可する。
 * それ以外（外部サイト、"//"、"\\" を含むもの）はトップへ
 */
function resolveNext(request: NextRequest, raw: string): string {
  if (/^\/(?![\/\\])[^\s]*$/.test(raw) && !raw.includes("\\")) return raw;
  try {
    const u = new URL(raw);
    const self = absoluteUrlFromRequest(request, "/").host;
    if ((u.protocol === "https:" || u.protocol === "http:") && u.host === self) return `${u.pathname}${u.search}` || "/";
  } catch {
    // 不正な URL
  }
  return "/";
}

/** メール内リンク（token_hash 方式）。別端末で開いても検証できる */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/";
  let next = resolveNext(request, nextParam);

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // ドライバー本人はスタッフ画面（/settings/account など）ではなくポータルへ
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role === "driver" && !next.startsWith("/driver")) {
          next = next.startsWith("/settings/account") ? "/driver/account" : "/driver";
        }
      }
      return NextResponse.redirect(absoluteUrlFromRequest(request, next));
    }
    const login = absoluteUrlFromRequest(request, "/login");
    login.searchParams.set("error", "expired");
    return NextResponse.redirect(login);
  }
  const login = absoluteUrlFromRequest(request, "/login");
  login.searchParams.set("error", "invalid");
  return NextResponse.redirect(login);
}
