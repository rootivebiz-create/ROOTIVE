import { ADMIN_ROLES, requirePageRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectForm } from "@/components/settings/projects/project-form";

export const metadata = { title: "案件を追加" };

export default async function NewProjectPage() {
  await requirePageRole(ADMIN_ROLES);
  return (
    <div>
      <PageHeader title="案件を追加" description="案件名は会社内で一意です。内容は 1 つ以上登録してください（内容名が空欄なら「標準」）。" />
      <ProjectForm canEdit project={null} items={[]} entryCounts={{}} />
    </div>
  );
}
