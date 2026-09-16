/** 環境変数（サーバー・クライアント共通で参照できるものだけ NEXT_PUBLIC_） */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, ""),
};

export function assertPublicEnv() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません（.env.local を確認してください）");
  }
}

/** サーバー側で使う公開 URL（未設定なら VERCEL_URL → localhost） */
export function appUrl(): string {
  if (env.appUrl) return env.appUrl;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
