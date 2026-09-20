import { requirePageRole } from "@/lib/auth/session";
import { loadActiveDelegations, loadApprovals } from "@/lib/executive/queries";
import type { ApprovalStatus } from "@/lib/db/types";
import { ApprovalsView } from "@/components/executive/approvals-view";

export const metadata = { title: "決裁" };

/** 一覧の読み込み上限（決裁は月に数件〜数十件） */
const LIST_LIMIT = 300;

const STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "withdrawn"];

/** URL の ?status= を読む（不正・未指定なら決裁待ち） */
function statusFromParam(param: string | string[] | undefined): ApprovalStatus {
  const v = Array.isArray(param) ? param[0] : param;
  return STATUSES.includes(v as ApprovalStatus) ? (v as ApprovalStatus) : "pending";
}

/**
 * 決裁（/executive/approvals）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。タブは ?status=pending|approved|rejected|withdrawn。
 * 並び（期限切れ → 滞留 → 待ち → 決裁済み）は loadApprovals の sortApprovals が済ませている。
 * 決裁そのものの権限は DB（can_decide_approval・トリガー・RLS）が確認する（CLAUDE.md §2）。
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = statusFromParam(sp.status);
  const { supabase, company } = await requirePageRole(["owner"]);

  const [approvals, delegations] = await Promise.all([
    loadApprovals(supabase, company.id, { limit: LIST_LIMIT }),
    loadActiveDelegations(supabase, company.id),
  ]);

  return <ApprovalsView approvals={approvals} status={status} delegations={delegations} />;
}
