"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** ブラウザ用（必要な場合のみ。通常は Server Action 経由で操作する） */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
  }
  return browserClient;
}
