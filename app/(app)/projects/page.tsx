import { Download, FileSpreadsheet, Receipt } from "lucide-react";
import { requireManagementPage } from "@/lib/auth/session";
import { monthFromParam, monthToDate, formatMonthJa } from "@/lib/month";
import { loadMasters, loadProjectPl, loadProjectPlRange } from "@/lib/db/queries";
import { sumMoney } from "@/lib/calc";
import type { ProjectSummary } from "@/lib/db/types";
import { exportUrls } from "@/lib/exports/urls";
import { projectTabFromParam, type ProjectTab } from "@/lib/schemas/quote";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { MonthLink } from "@/components/layout/month-link";
import { ProjectSummaryTable, type ProjectRow } from "@/components/projects/project-summary-table";
import { ProjectPlTable } from "@/components/projects/project-pl-table";
import { QuotePanel, type QuoteItemOption } from "@/components/projects/quote-panel";
import { toProjectRow, trendMonths } from "@/components/projects/helpers";
import { cn } from "@/lib/utils";

export const metadata = { title: "案件別" };

const tabBase = "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-all";
const tabActive = "bg-card text-foreground shadow";

/** 画面上部のタブ（採算 ／ 単価シミュレーター）。?m= は MonthLink が引き継ぐ */
function TabNav({ tab }: { tab: ProjectTab }) {
  return (
    <div className="mb-4 inline-flex h-10 items-center rounded-md bg-muted p-1 text-muted-foreground" role="tablist" aria-label="表示">
      <MonthLink href="/projects" role="tab" aria-selected={tab === "pl"} className={cn(tabBase, tab === "pl" && tabActive)}>
        案件の採算
      </MonthLink>
      <MonthLink href="/projects?tab=quote" role="tab" aria-selected={tab === "quote"} className={cn(tabBase, tab === "quote" && tabActive)}>
        単価シミュレーター
      </MonthLink>
    </div>
  );
}

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
  const { supabase, company } = await requireManagementPage();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const tab = projectTabFromParam(sp.tab);
  const scope: "month" | "all" = sp.scope === "all" ? "all" : "month";
  const months = trendMonths(month);

  // 単価シミュレーター：受注前の案件でも試算できるよう、マスタ（案件内容の単価と会社の既定）だけを読む
  if (tab === "quote") {
    const masters = await loadMasters(supabase, company.id, { activeOnly: true });
    const items: QuoteItemOption[] = masters.projects.flatMap((p) =>
      p.items.map((i) => ({
        id: i.id,
        projectName: p.name,
        itemName: i.name,
        unit: i.unit,
        billRate: Number(i.bill_rate ?? 0),
        payRate: Number(i.pay_rate ?? 0),
        targetMargin: p.target_margin == null ? null : Number(p.target_margin),
      })),
    );
    return (
      <div>
        <PageHeader title="案件別" description="元請から提示された単価で利益が出るか、目標の利益率を出すにはいくらで受けるべきかを試算します（税抜）。" />
        <TabNav tab="quote" />
        <QuotePanel
          items={items}
          defaults={{
            royaltyRate: Number(company.default_royalty_rate ?? 0),
            mgmtFee: Number(company.default_mgmt_fee ?? 0),
            roundingMode: company.rounding_mode,
          }}
        />
      </div>
    );
  }

  let query = supabase.from("v_project_summary").select("*").eq("company_id", company.id);
  if (scope === "month") query = query.eq("month", monthToDate(month));

  const [summaryRes, plRows, rangeRows] = await Promise.all([
    query.order("project_name").order("item_name").order("month"),
    loadProjectPl(supabase, company.id, month),
    loadProjectPlRange(supabase, company.id, months[0], month),
  ]);
  if (summaryRes.error) throw summaryRes.error;

  const rows: ProjectRow[] = scope === "month" ? (summaryRes.data ?? []).map(toRow) : aggregateAll(summaryRes.data ?? []);

  const csvLink = cn(buttonVariants({ variant: "outline", size: "sm" }));

  return (
    <div>
      <PageHeader
        title="案件別"
        description={`${formatMonthJa(month)} の案件ごとの採算（案件に紐づけた経費を引いた実利益）と、案件（内容）ごとの集計`}
        actions={
          <>
            <a href={exportUrls.projectsCsv(month)} download className={csvLink}>
              <Download className="h-4 w-4" />
              CSV（当月）
            </a>
            <a href={exportUrls.projectsCsv("all")} download className={csvLink}>
              <Download className="h-4 w-4" />
              CSV（全期間）
            </a>
            <a href={exportUrls.projectsXlsx(month)} download className={csvLink}>
              <FileSpreadsheet className="h-4 w-4" />
              Excel（当月）
            </a>
          </>
        }
      />
      <TabNav tab="pl" />

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold">案件ごとの採算（{formatMonthJa(month)}）</h2>
        <ProjectPlTable month={month} rows={plRows.map(toProjectRow)} trendRows={rangeRows.map(toProjectRow)} trendMonths={months} />
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p>※ 案件利益 ＝ 稼働の利益（単価差額利益 ＋ ロイヤリティ）− 直課経費。利益率 ＝ 案件利益 ÷ 売上。</p>
          <p>※ 管理費・調整はドライバー単位のため、案件には配賦していません。</p>
          <p>
            ※ 目標利益率は
            <MonthLink href="/settings/projects" className="underline">
              設定 → 案件・単価
            </MonthLink>
            で案件ごとに設定します（空欄なら判定しません）。
          </p>
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">経費を案件に紐づけると、その案件の実利益に反映されます（経費の入力画面で案件を選べます）。</p>
          <MonthLink href="/expenses" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            <Receipt className="h-4 w-4" />
            経費へ
          </MonthLink>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">案件（内容）ごとの集計</h2>
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
      </section>
    </div>
  );
}
