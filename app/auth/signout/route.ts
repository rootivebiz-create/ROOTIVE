import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrlFromRequest } from "@/lib/request-url";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(absoluteUrlFromRequest(request, "/login"), { status: 303 });
}
