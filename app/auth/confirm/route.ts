import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** メール内リンク（token_hash 方式）。別端末で開いても検証できる */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "リンクの有効期限が切れているか、無効です。もう一度ログインをお試しください。");
    return NextResponse.redirect(login);
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("error", "リンクが不正です。");
  return NextResponse.redirect(login);
}
