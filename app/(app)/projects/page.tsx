import { requireStaff } from "@/lib/auth/session";
import { monthFromParam, monthToDate, formatMonthJa } from "@/lib/month";
import { sumMoney } from "@/lib/calc";
import type { ProjectSummary } from "@/lib/db/types";
import { PageHeader } from "@/components/ui/page-header";
import { MonthLink } from "@/components/layout/month-link";
import { ProjectSummaryTable, type ProjectRow } from "@/components/projects/project-summary-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "案件別" };

function toRow(r: ProjectSummary): ProjectRow {
  return {
    key: r.project_item_id ?? `${r.project_id}-${r.item_name}`,
    projectName: r.project_name ?? "",
    clientName: r.client_name ?? "",
    itemName: r.item_name ?? "",
    unit: r.unit ?? "day",
    entryCount: Number(r.entry_count ?? 0),
    driverCount: Number(r.driver_count ?? 0),
    qtyTotal: Number(r.qty_total ?? 0),
    bill: Number(r.bill ?? 0),
    pay: Number(r.pay ?? 0),
    margin: Number(r.margin ?? 0),
    royalty: Number(r.royalty ?? 0),
    entryProfit: Number(r.entry_profit ?? 0),
    profitRate: Number(r.profit_rate ?? 0),
  };
}

/** 全期間：案件内容ごとに月をまたいで合算（ドライバー数は月ごとの distinct のため合算せず null） */
function aggregateAll(rows: ProjectSummary[]): ProjectRow[] {
  const groups = new Map<string, ProjectSummary[]>();
  for (const r of rows) {
    const key = r.project_item_id ?? `${r.project_id}-${r.item_name}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: ProjectRow[] = [];
  for (const [key, g] of groups) {
    const first = g[0];
    const bill = sumMoney(g.map((r) => Number(r.bill ?? 0)));
    const entryProfit = sumMoney(g.map((r) => Number(r.entry_profit ?? 0)));
    out.push({
      key,
      projectName: first.project_name ?? "",
      clientName: first.client_name ?? "",
      itemName: first.item_name ?? "",
      unit: first.unit ?? "day",
      entryCount: g.reduce((a, r) => a + Number(r.entry_count ?? 0), 0),
      driverCount: null,
      qtyTotal: sumMoney(g.map((r) => Number(r.qty_total ?? 0))),
      bill,
      pay: sumMoney(g.map((r) => Number(r.pay ?? 0))),
      margin: sumMoney(g.map((r) => Number(r.margin ?? 0))),
      royalty: sumMoney(g.map((r) => Number(r.royalty ?? 0))),
      entryProfit,
      profitRate: bill !== 0 ? entryProfit / bill : 0,
    });
  }
  return out;
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const scope: "month" | "all" = sp.scope === "all" ? "all" : "month";

  let query = supabase.from("v_project_summary").select("*").eq("company_id", company.id);
  if (scope === "month") query = query.eq("month", monthToDate(month));
  const { data, error } = await query.order("project_name").order("item_name").order("month");
  if (error) throw error;

  const rows: ProjectRow[] = scope === "month" ? (data ?? []).map(toRow) : aggregateAll(data ?? []);

  const tabBase = "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-all";
  const tabActive = "bg-card text-foreground shadow";

  return (
    <div>
      <PageHeader title="案件別" description={scope === "month" ? `${formatMonthJa(month)} の案件（内容）ごとの集計` : "全期間の案件（内容）ごとの集計"} />
      <div className="mb-4 inline-flex h-10 items-center rounded-md bg-muted p-1 text-muted-foreground" role="tablist" aria-label="集計範囲">
        <MonthLink href="/projects" role="tab" aria-selected={scope === "month"} className={cn(tabBase, scope === "month" && tabActive)}>
          当月
        </MonthLink>
        <MonthLink href="/projects?scope=all" role="tab" aria-selected={scope === "all"} className={cn(tabBase, scope === "all" && tabActive)}>
          全期間
        </MonthLink>
      </div>
      <ProjectSummaryTable rows={rows} emptyDescription={scope === "month" ? `${formatMonthJa(month)} の稼働行がありません。` : "稼働行がまだ登録されていません。"} />
      <p className="mt-3 text-xs text-muted-foreground">
        ※ 管理費・調整はドライバー単位のため含めません。利益（行）＝単価差額利益＋ロイヤリティ。
        {scope === "all" && " ドライバー数は月ごとの人数のため、全期間では表示しません。"}
      </p>
    </div>
  );
}
