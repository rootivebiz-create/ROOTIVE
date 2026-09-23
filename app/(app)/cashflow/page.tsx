import { canEdit, requireManagementPage } from "@/lib/auth/session";
import { loadCashForecast, loadCashSnapshots } from "@/lib/db/queries";
import { CashflowView } from "@/components/cashflow/cashflow-view";
import { pickOpeningBalance, resolveRange, todayJST, toSnapshotRow } from "@/components/cashflow/helpers";

export const metadata = { title: "資金繰り" };

/**
 * 資金繰りカレンダー（/cashflow）
 * 期間は ?from=YYYY-MM-DD&to=YYYY-MM-DD（既定は日本時間の今日から 90 日後まで）。
 * 起点残高は期間開始日以前で一番新しい cash_snapshots。
 */
export default async function CashflowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile, company } = await requireManagementPage();
  const today = todayJST();
  const range = resolveRange(sp.from, sp.to);

  const [events, snapshots] = await Promise.all([loadCashForecast(supabase, range.from, range.to), loadCashSnapshots(supabase, company.id)]);
  const opening = pickOpeningBalance(snapshots, range.from);

  return (
    <CashflowView
      range={range}
      today={today}
      events={events}
      opening={opening}
      snapshots={snapshots.map(toSnapshotRow)}
      editable={canEdit(profile.role)}
    />
  );
}
