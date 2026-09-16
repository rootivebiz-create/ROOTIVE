import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** PKCE フロー（code パラメータ） */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("error", "ログインに失敗しました。もう一度お試しください。");
  return NextResponse.redirect(login);
}
