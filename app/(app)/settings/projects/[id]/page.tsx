import { notFound } from "next/navigation";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { loadClients } from "@/lib/db/queries";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { ProjectForm } from "@/components/settings/projects/project-form";

export const metadata = { title: "案件の編集" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, profile, company } = await requireStaff();

  const [projectRes, itemsRes] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.from("project_items").select("*").eq("project_id", id).order("sort_order").order("name"),
  ]);
  if (projectRes.error) throw projectRes.error;
  if (!projectRes.data) notFound();
  if (itemsRes.error) throw itemsRes.error;
  const project = projectRes.data;
  const items = itemsRes.data ?? [];

  // 取引先の候補：有効な取引先 ＋ 現在設定中の取引先（停止中でも選択を保てるように）
  const allClients = await loadClients(supabase, company.id);
  const clients = allClients.filter((c) => c.is_active || c.id === project.client_id);

  // 内容ごとの稼働行件数（削除可否の判定に使う）
  const counts = await Promise.all(items.map((it) => supabase.from("work_entries").select("id", { count: "exact" }).eq("project_item_id", it.id).limit(1)));
  const entryCounts: Record<string, number> = {};
  items.forEach((it, i) => {
    const res = counts[i];
    if (res.error) throw res.error;
    entryCounts[it.id] = res.count ?? res.data?.length ?? 0;
  });

  return (
    <div>
      <PageHeader
        title={project.name}
        description={project.client_name || undefined}
        actions={
          <>
            {project.is_active ? <Badge variant="success">稼働中</Badge> : <Badge variant="secondary">停止中</Badge>}
            <MonthLink href={items[0] ? `/settings/rates?item=${items[0].id}` : "/settings/rates"} className={buttonVariants({ variant: "outline", size: "sm" })}>
              ドライバー別単価
            </MonthLink>
          </>
        }
      />
      <ProjectForm canEdit={canEdit(profile.role)} project={project} items={items} entryCounts={entryCounts} clients={clients} />
    </div>
  );
}
