import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrlFromRequest } from "@/lib/request-url";

/** PKCE フロー（code パラメータ） */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = /^\/(?![\/\\])[^\s]*$/.test(nextParam) && !nextParam.includes("\\") ? nextParam : "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(absoluteUrlFromRequest(request, next));
  }
  const login = absoluteUrlFromRequest(request, "/login");
  login.searchParams.set("error", "failed");
  return NextResponse.redirect(login);
}
