import { notFound } from "next/navigation";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadMasters } from "@/lib/db/queries";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { DriverForm, type DriverFormProject } from "@/components/settings/drivers/driver-form";
import { canSeeBankAccount, type DriverBankFormInput } from "@/lib/schemas/drivers";

export const metadata = { title: "ドライバーの編集" };

export default async function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, profile, company } = await requireStaff();

  const [driverRes, masters, recurringRes, entriesRes, monthsRes] = await Promise.all([
    supabase.from("drivers").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    loadMasters(supabase, company.id),
    supabase.from("driver_recurring_adjustments").select("*").eq("driver_id", id).order("sort_order").order("created_at"),
    supabase.from("work_entries").select("id", { count: "exact" }).eq("driver_id", id).limit(1),
    supabase.from("driver_months").select("id", { count: "exact" }).eq("driver_id", id).limit(1),
  ]);
  if (driverRes.error) throw driverRes.error;
  if (!driverRes.data) notFound();
  if (recurringRes.error) throw recurringRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (monthsRes.error) throw monthsRes.error;
  const driver = driverRes.data;

  // 振込先口座（0020 で driver_bank_accounts に分離）。見てよい権限のときだけ読む
  const canSeeBank = canSeeBankAccount(company.confidential_scope, profile.role);
  let bankAccount: DriverBankFormInput | null = null;
  if (canSeeBank) {
    const bankRes = await supabase
      .from("v_driver_bank")
      .select("bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana")
      .eq("company_id", company.id)
      .eq("driver_id", id)
      .maybeSingle();
    if (bankRes.error) throw bankRes.error;
    const b = bankRes.data;
    if (b) {
      bankAccount = {
        bank_code: b.bank_code ?? "",
        bank_name: b.bank_name ?? "",
        branch_code: b.branch_code ?? "",
        branch_name: b.branch_name ?? "",
        account_type: b.account_type ?? "",
        account_number: b.account_number ?? "",
        account_holder_kana: b.account_holder_kana ?? "",
      };
    }
  }

  // null（標準）は null のまま渡す（0 に潰さない）
  const overrides = masters.overrides
    .filter((o) => o.driver_id === id)
    .map((o) => ({
      project_item_id: o.project_item_id,
      bill_rate: o.bill_rate == null ? null : Number(o.bill_rate),
      pay_rate: o.pay_rate == null ? null : Number(o.pay_rate),
    }));
  const overrideIds = new Set(overrides.map((o) => o.project_item_id));
  // 有効な案件内容 ＋ 既に個別単価がある内容（停止中でも解除できるように表示）
  const projects: DriverFormProject[] = masters.projects
    .map((p) => ({
      id: p.id,
      name: p.name,
      client_name: p.client_name,
      is_active: p.is_active,
      items: p.items
        .filter((i) => (p.is_active && i.is_active) || overrideIds.has(i.id))
        .map((i) => ({ id: i.id, name: i.name, unit: i.unit, bill_rate: Number(i.bill_rate ?? 0), pay_rate: Number(i.pay_rate ?? 0), is_active: p.is_active && i.is_active })),
    }))
    .filter((p) => p.items.length > 0);

  const entryCount = entriesRes.count ?? entriesRes.data?.length ?? 0;
  const monthCount = monthsRes.count ?? monthsRes.data?.length ?? 0;

  return (
    <div>
      <PageHeader
        title={driver.name}
        description={driver.kana || undefined}
        actions={driver.is_active ? <Badge variant="success">稼働中</Badge> : <Badge variant="secondary">停止中</Badge>}
      />
      <DriverForm
        canEdit={canEdit(profile.role)}
        defaults={{
          default_royalty_rate: Number(company.default_royalty_rate ?? 0),
          default_mgmt_fee: Number(company.default_mgmt_fee ?? 0),
          rounding_mode: company.rounding_mode,
          payout_month_offset: Number(company.payout_month_offset ?? 1),
          payout_day: Number(company.payout_day ?? 0),
        }}
        driver={driver}
        canSeeBank={canSeeBank}
        bankAccount={bankAccount}
        overrides={overrides}
        recurring={recurringRes.data ?? []}
        projects={projects}
        entryCount={entryCount}
        monthCount={monthCount}
      />
    </div>
  );
}
