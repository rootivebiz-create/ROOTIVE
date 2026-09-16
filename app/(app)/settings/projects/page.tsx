import { Plus } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadMasters } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { ProjectsTable, type ProjectListRow } from "@/components/settings/projects/projects-table";

export const metadata = { title: "案件・単価" };

export default async function ProjectsSettingsPage() {
  const { supabase, profile, company } = await requireStaff();
  const masters = await loadMasters(supabase, company.id);
  const rows: ProjectListRow[] = masters.projects.map((p) => ({
    id: p.id,
    name: p.name,
    client_name: p.client_name,
    is_active: p.is_active,
    memo: p.memo,
    items: p.items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      bill_rate: Number(i.bill_rate ?? 0),
      pay_rate: Number(i.pay_rate ?? 0),
      is_active: i.is_active,
    })),
  }));
  const editable = canEdit(profile.role);
  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div>
      <PageHeader
        title="案件・単価"
        description={`稼働中 ${activeCount} 件／全 ${rows.length} 件。差額 ＝ 受注単価 − 支払単価（マイナスは赤字）。`}
        actions={
          editable ? (
            <MonthLink href="/settings/projects/new" className={buttonVariants()}>
              <Plus /> 案件を追加
            </MonthLink>
          ) : undefined
        }
      />
      <ProjectsTable rows={rows} canEdit={editable} />
    </div>
  );
}
