import { notFound } from "next/navigation";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
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
        actions={project.is_active ? <Badge variant="success">稼働中</Badge> : <Badge variant="secondary">停止中</Badge>}
      />
      <ProjectForm canEdit={canEdit(profile.role)} project={project} items={items} entryCounts={entryCounts} />
    </div>
  );
}
