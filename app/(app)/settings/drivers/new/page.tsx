import { ADMIN_ROLES, requirePageRole } from "@/lib/auth/session";
import { loadMasters } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DriverForm, type DriverFormProject } from "@/components/settings/drivers/driver-form";

export const metadata = { title: "ドライバーを追加" };

export default async function NewDriverPage() {
  const { supabase, company, access } = await requirePageRole(ADMIN_ROLES);
  const masters = await loadMasters(supabase, company.id, { activeOnly: true });
  const projects: DriverFormProject[] = masters.projects.map((p) => ({
    id: p.id,
    name: p.name,
    client_name: p.client_name,
    is_active: p.is_active,
    items: p.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, bill_rate: Number(i.bill_rate ?? 0), pay_rate: Number(i.pay_rate ?? 0), is_active: i.is_active })),
  }));

  return (
    <div>
      <PageHeader title="ドライバーを追加" description="名前は会社内で一意です。管理費の初期値は会社設定の標準管理費です。" />
      <DriverForm
        canEdit
        defaults={{
          default_royalty_rate: Number(company.default_royalty_rate ?? 0),
          default_mgmt_fee: Number(company.default_mgmt_fee ?? 0),
          rounding_mode: company.rounding_mode,
          payout_month_offset: Number(company.payout_month_offset ?? 1),
          payout_day: Number(company.payout_day ?? 0),
        }}
        driver={null}
        canSeeBank={access.bank_account}
        bankAccount={null}
        overrides={[]}
        recurring={[]}
        projects={projects}
        entryCount={0}
        monthCount={0}
      />
    </div>
  );
}
