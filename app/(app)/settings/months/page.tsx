import { requireStaff, canEdit, canManage, canSeeManagement, isOwner } from "@/lib/auth/session";
import { loadMonthList } from "@/lib/db/queries";
import { currentMonthJST, dateToMonth, formatMonthJa, isPastMonth } from "@/lib/month";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { MonthsTable, type MonthRow } from "@/components/settings/months/months-table";

export const metadata = { title: "月締め" };

export default async function MonthsSettingsPage() {
  const { supabase, profile, company } = await requireStaff();
  const list = await loadMonthList(supabase, company.id);
  const currentMonth = currentMonthJST();

  const rows: MonthRow[] = list
    .filter((m) => m.month)
    .map((m) => ({
      month: dateToMonth(m.month ?? ""),
      entryCount: Number(m.entry_count ?? 0),
      driverCount: Number(m.driver_count ?? 0),
      bill: Number(m.bill ?? 0),
      profit: Number(m.profit ?? 0),
      payout: Number(m.payout ?? 0),
      profitRate: Number(m.profit_rate ?? 0),
      status: m.status === "closed" ? "closed" : "open",
      closedAt: m.closed_at ?? null,
      closingNote: m.closing_note ?? "",
      backupPath: m.backup_path ?? null,
    }));

  const openPast = rows.filter((r) => r.status === "open" && isPastMonth(r.month));
  const closedCount = rows.filter((r) => r.status === "closed").length;
  const editable = canEdit(profile.role);

  return (
    <div>
      <PageHeader
        title="月締め"
        description={`データがある月の一覧（締め済み ${closedCount} か月／全 ${rows.length} か月）。締めると稼働・管理費・調整をロックし、集計スナップショットとバックアップ JSON を保存します。`}
      />
      {editable && openPast.length > 0 && (
        <Alert variant="warning" className="mb-4">
          過去の月で未締めのものがあります：{openPast.map((r) => formatMonthJa(r.month)).join("、")}。支払が確定したら締めてください。
        </Alert>
      )}
      {!editable && <p className="mb-4 text-sm text-muted-foreground">閲覧者は月締めの操作はできません。</p>}
      <MonthsTable rows={rows} currentMonth={currentMonth} canClose={editable} canReopen={isOwner(profile.role)} showProfit={canSeeManagement(profile.role)} canDownloadBackup={canManage(profile.role)} />
    </div>
  );
}
