import type { ServerSupabase } from "@/lib/supabase/server";
import { monthToDate } from "@/lib/month";
import { parseOfficeDesk, type OfficeDesk } from "./desk";

/**
 * 事務（/office）の読み取り（サーバー専用）。
 *
 * RPC `office_desk` の 1 往復だけ。security invoker なので RLS はそのまま効き、入口で admin 以上に限っている。
 * 月を省くと、DB が「締めていない一番古い過去の月、無ければ今月」を選ぶ（戻り値の month で分かる）。
 */
export async function loadOfficeDesk(supabase: ServerSupabase, opts: { month?: string | null; today: string }): Promise<OfficeDesk> {
  const { data, error } = await supabase.rpc("office_desk", {
    p_month: opts.month ? monthToDate(opts.month) : undefined,
    p_today: opts.today,
  });
  if (error) throw error;
  return parseOfficeDesk(data);
}
