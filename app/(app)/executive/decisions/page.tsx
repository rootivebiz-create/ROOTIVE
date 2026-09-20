import { requirePageRole } from "@/lib/auth/session";
import { loadDecisions } from "@/lib/executive/queries";
import { todayJST } from "@/lib/finance/date";
import { DecisionsView } from "@/components/executive/decisions-view";

export const metadata = { title: "意思決定ログ" };

/**
 * 意思決定ログ（/executive/decisions）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。見直し日が来たもの（status='open' かつ review_on <= 今日）を
 * 最上段に出し、以下は決めた日の新しい順（loadDecisions の並び）。
 */
export default async function DecisionsPage() {
  const { supabase, company } = await requirePageRole(["owner"]);
  const decisions = await loadDecisions(supabase, company.id);

  return <DecisionsView decisions={decisions} today={todayJST()} />;
}
