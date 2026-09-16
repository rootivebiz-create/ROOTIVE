import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";
import { assertPublicEnv, env } from "@/lib/env";

/** Server Component / Server Action / Route Handler 用（Cookie セッション、RLS 適用） */
export async function createClient() {
  // cookies() を先に呼ぶことで、ビルド時の静的化対象から外れる（環境変数の検証はその後）
  const cookieStore = await cookies();
  assertPublicEnv();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からの呼び出しでは Cookie を書けない（middleware がセッションを更新する）
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
