import { canEdit, canSeeManagement, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadMasters, loadRateDiffs } from "@/lib/db/queries";
import { monthFromParam, monthToDate } from "@/lib/month";
import { EntriesView } from "@/components/entries/entries-view";
import { filterActiveMasters, markMasterDiffs, toEntryRow } from "@/components/entries/helpers";

export const metadata = { title: "稼働入力" };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function EntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const { supabase, profile, company } = await requireStaff();

  const [entriesRes, closed] = await Promise.all([
    supabase
      .from("v_work_entry_calc")
      .select("*")
      .eq("company_id", company.id)
      .eq("month", monthToDate(month))
      .order("driver_sort_order")
      .order("driver_name")
      .order("created_at"),
    isMonthClosed(supabase, company.id, month),
  ]);
  if (entriesRes.error) throw entriesRes.error;

  const editable = canEdit(profile.role) && !closed;
  // ダイアログの選択肢は編集できるときだけ読み込む（編集時は停止中のマスタも表示するため全件）
  // 現在のマスタと異なる稼働行（締め済み月は空。閲覧者にも表示するが、更新ボタンは editable のときだけ）
  const [allMasters, diffs] = await Promise.all([editable ? loadMasters(supabase, company.id) : null, loadRateDiffs(supabase, month, { closed })]);
  const masters = allMasters ? filterActiveMasters(allMasters) : null;

  return (
    <EntriesView
      month={month}
      rows={markMasterDiffs((entriesRes.data ?? []).map(toEntryRow), diffs)}
      diffs={diffs}
      editable={editable}
      closed={closed}
      masters={masters}
      allMasters={allMasters}
      initialDriver={str(sp.driver)}
      initialQuery={str(sp.q)}
      initialVoice={str(sp.voice) === "1"}
      showProfit={canSeeManagement(profile.role)}
    />
  );
}
