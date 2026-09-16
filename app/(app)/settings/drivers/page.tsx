import { Plus } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { DriversTable, type DriverListRow } from "@/components/settings/drivers/drivers-table";

export const metadata = { title: "ドライバー" };

export default async function DriversSettingsPage() {
  const { supabase, profile, company } = await requireStaff();
  const [driversRes, overridesRes, recurringRes] = await Promise.all([
    supabase.from("drivers").select("*").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("driver_pay_overrides").select("driver_id").eq("company_id", company.id),
    supabase.from("driver_recurring_adjustments").select("driver_id, is_active").eq("company_id", company.id),
  ]);
  if (driversRes.error) throw driversRes.error;
  if (overridesRes.error) throw overridesRes.error;
  if (recurringRes.error) throw recurringRes.error;

  const overrideCounts = new Map<string, number>();
  for (const o of overridesRes.data ?? []) overrideCounts.set(o.driver_id, (overrideCounts.get(o.driver_id) ?? 0) + 1);
  const recurringCounts = new Map<string, number>();
  for (const r of recurringRes.data ?? []) {
    if (r.is_active) recurringCounts.set(r.driver_id, (recurringCounts.get(r.driver_id) ?? 0) + 1);
  }

  const rows: DriverListRow[] = (driversRes.data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    kana: d.kana,
    is_active: d.is_active,
    royalty_rate: d.royalty_rate == null ? null : Number(d.royalty_rate),
    mgmt_fee: Number(d.mgmt_fee ?? 0),
    rounding_mode: d.rounding_mode,
    memo: d.memo,
    overrideCount: overrideCounts.get(d.id) ?? 0,
    recurringCount: recurringCounts.get(d.id) ?? 0,
  }));
  const editable = canEdit(profile.role);
  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div>
      <PageHeader
        title="ドライバー"
        description={`稼働中 ${activeCount} 名／全 ${rows.length} 名。ロイヤリティ率・管理費・端数処理の「会社設定」は会社設定画面の既定値を使います。`}
        actions={
          editable ? (
            <MonthLink href="/settings/drivers/new" className={buttonVariants()}>
              <Plus /> ドライバーを追加
            </MonthLink>
          ) : undefined
        }
      />
      <DriversTable
        rows={rows}
        defaults={{
          default_royalty_rate: Number(company.default_royalty_rate ?? 0),
          default_mgmt_fee: Number(company.default_mgmt_fee ?? 0),
          rounding_mode: company.rounding_mode,
        }}
        canEdit={editable}
      />
    </div>
  );
}
