import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadClients } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { ClientsTable } from "@/components/settings/clients/clients-table";

export const metadata = { title: "取引先" };

export default async function ClientsSettingsPage() {
  const { supabase, profile, company } = await requireStaff();
  const clients = await loadClients(supabase, company.id);
  const activeCount = clients.filter((c) => c.is_active).length;

  return (
    <div>
      <PageHeader title="取引先" description={`有効 ${activeCount} 件／全 ${clients.length} 件。案件に取引先を設定すると、請求書（月次）を作成できます。`} />
      <ClientsTable rows={clients} canEdit={canEdit(profile.role)} />
    </div>
  );
}
