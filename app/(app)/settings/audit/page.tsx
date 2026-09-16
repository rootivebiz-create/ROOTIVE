import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePageRole } from "@/lib/auth/session";
import { isMonthKey } from "@/lib/month";
import { AUDIT_PAGE_SIZE, parseAuditQuery, type AuditQuery } from "@/lib/schemas/data";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AuditFilters } from "@/components/settings/audit/audit-filters";
import { AuditLogList, type AuditRowView } from "@/components/settings/audit/audit-log-list";
import { describeChanges, describeTarget, emptyNameMaps, prettyJson, type AuditNameMaps } from "@/components/settings/audit/diff";
import { actionLabel, tableLabel } from "@/components/settings/audit/labels";

export const metadata = { title: "監査ログ" };

function auditHref(q: AuditQuery, month: string | undefined, page: number): string {
  const sp = new URLSearchParams();
  if (month) sp.set("m", month);
  if (q.table) sp.set("table", q.table);
  if (q.action) sp.set("action", q.action);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/settings/audit?${qs}` : "/settings/audit";
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requirePageRole(["owner", "admin"]);
  const sp = await searchParams;
  const rawMonth = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const month = isMonthKey(rawMonth) ? rawMonth : undefined;
  const q = parseAuditQuery(sp);

  const from = (q.page - 1) * AUDIT_PAGE_SIZE;
  const to = from + AUDIT_PAGE_SIZE - 1;
  let query = supabase.from("audit_logs").select("*", { count: "exact" }).eq("company_id", company.id);
  if (q.table) query = query.eq("table_name", q.table);
  if (q.action) query = query.eq("action", q.action);
  const logsRes = await query.order("created_at", { ascending: false }).range(from, to);
  if (logsRes.error) throw logsRes.error;
  const logs = logsRes.data ?? [];
  const total = logsRes.count ?? logs.length;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  // 操作者・参照名は別クエリで解決する（埋め込みリソースは使わない）
  const names: AuditNameMaps = emptyNameMaps();
  if (logs.length > 0) {
    const actorIds = [...new Set(logs.map((l) => l.actor_id).filter((id): id is string => Boolean(id)))];
    const [profilesRes, driversRes, projectsRes, itemsRes] = await Promise.all([
      actorIds.length > 0 ? supabase.from("profiles").select("id, display_name, email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
      supabase.from("drivers").select("id, name").eq("company_id", company.id),
      supabase.from("projects").select("id, name").eq("company_id", company.id),
      supabase.from("project_items").select("id, name, project_id").eq("company_id", company.id),
    ]);
    // 参照名は補助情報のため、取得に失敗しても一覧は表示する
    for (const p of profilesRes.data ?? []) names.profiles.set(p.id, p.display_name?.trim() || p.email);
    for (const d of driversRes.data ?? []) names.drivers.set(d.id, d.name);
    for (const p of projectsRes.data ?? []) names.projects.set(p.id, p.name);
    for (const i of itemsRes.data ?? []) {
      const project = names.projects.get(i.project_id);
      names.items.set(i.id, project ? `${project} / ${i.name}` : i.name);
    }
  }

  const rows: AuditRowView[] = logs.map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    actorName: l.actor_id ? (names.profiles.get(l.actor_id) ?? "不明なユーザー") : "システム",
    action: l.action,
    actionLabel: actionLabel(l.action),
    tableLabel: tableLabel(l.table_name),
    target: describeTarget(l, names),
    lines: describeChanges(l, names),
    beforeJson: prettyJson(l.before),
    afterJson: prettyJson(l.after),
  }));

  const rangeText = total === 0 ? "0 件" : `${from + 1}〜${Math.min(to + 1, total)} 件 / 全 ${total} 件`;

  const pager = (
    <nav className="flex items-center justify-between gap-2 text-sm" aria-label="ページ送り">
      <Link
        href={auditHref(q, month, q.page - 1)}
        aria-disabled={q.page <= 1}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), q.page <= 1 && "pointer-events-none opacity-50")}
      >
        <ChevronLeft /> 前へ
      </Link>
      <span className="num text-muted-foreground">
        {q.page} / {pageCount} ページ
      </span>
      <Link
        href={auditHref(q, month, q.page + 1)}
        aria-disabled={q.page >= pageCount}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), q.page >= pageCount && "pointer-events-none opacity-50")}
      >
        次へ <ChevronRight />
      </Link>
    </nav>
  );

  return (
    <div>
      <PageHeader title="監査ログ" description={`誰が・いつ・何を変更したか（${rangeText}、${AUDIT_PAGE_SIZE} 件ずつ）。主要テーブルの変更は DB が自動記録します。`} />
      <Suspense fallback={<div className="mb-4 h-16" />}>
        <AuditFilters table={q.table} action={q.action} />
      </Suspense>
      {q.page > pageCount && total > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          このページにはデータがありません。
          <Link href={auditHref(q, month, 1)} className="ml-1 text-primary underline">
            1 ページ目へ
          </Link>
        </p>
      )}
      <AuditLogList rows={rows} />
      {total > AUDIT_PAGE_SIZE && <div className="mt-4">{pager}</div>}
    </div>
  );
}
