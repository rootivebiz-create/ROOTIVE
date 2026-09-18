import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadExpenseCategories, loadMasters } from "@/lib/db/queries";
import { dateToMonth } from "@/lib/month";
import { PageHeader } from "@/components/ui/page-header";
import { ExpenseCategoriesCard, type CategorySettingRow } from "@/components/settings/expenses/categories-card";
import { RecurringExpensesCard, type RecurringSettingRow } from "@/components/settings/expenses/recurring-card";
import type { TaxMode } from "@/lib/calc/types";

export const metadata = { title: "経費の設定" };

export default async function ExpenseSettingsPage() {
  const { supabase, profile, company } = await requireStaff();

  const [categories, recurringRes, usageRes, masters] = await Promise.all([
    loadExpenseCategories(supabase, company.id),
    supabase.from("v_recurring_expense_list").select("*").eq("company_id", company.id).order("sort_order").order("created_at"),
    // カテゴリごとの使用件数（月 × カテゴリの集計を合算する）
    supabase.from("v_expense_summary").select("category_id, expense_count").eq("company_id", company.id),
    loadMasters(supabase, company.id),
  ]);
  if (recurringRes.error) throw recurringRes.error;
  if (usageRes.error) throw usageRes.error;

  const recurringRows = recurringRes.data ?? [];

  const usage = new Map<string, number>();
  for (const u of usageRes.data ?? []) {
    if (!u.category_id) continue;
    usage.set(u.category_id, (usage.get(u.category_id) ?? 0) + Number(u.expense_count ?? 0));
  }
  for (const r of recurringRows) {
    if (!r.category_id) continue;
    usage.set(r.category_id, (usage.get(r.category_id) ?? 0) + 1);
  }

  const categoryRows: CategorySettingRow[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    memo: c.memo ?? "",
    is_active: c.is_active,
    usageCount: usage.get(c.id) ?? 0,
  }));

  const recurring: RecurringSettingRow[] = recurringRows.map((r) => ({
    id: r.id ?? "",
    category_id: r.category_id ?? "",
    label: r.label ?? "",
    amount: Number(r.amount ?? 0),
    tax_mode: (r.tax_mode ?? "taxable") as TaxMode,
    driver_id: r.driver_id ?? "",
    project_id: r.project_id ?? "",
    vendor: r.vendor ?? "",
    start_month: r.start_month ? dateToMonth(r.start_month) : "",
    end_month: r.end_month ? dateToMonth(r.end_month) : "",
    is_active: r.is_active ?? true,
  }));

  const editable = canEdit(profile.role);
  const activeCategories = categoryRows.filter((c) => c.is_active).length;
  const fixedCount = categoryRows.filter((c) => c.kind === "fixed").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="経費の設定"
        description={`カテゴリ ${activeCategories} 件（うち固定費 ${fixedCount} 件）／毎月かかる経費 ${recurring.length} 件。金額はすべて税抜で登録します。`}
      />
      {/* 保存後（追加・削除）は id の並びが変わるので、その時だけ作り直して未保存の状態を持ち越さない */}
      <ExpenseCategoriesCard key={categoryRows.map((c) => c.id).join(",")} rows={categoryRows} canEdit={editable} />
      <RecurringExpensesCard
        key={recurring.map((r) => r.id).join(",")}
        rows={recurring}
        categories={categoryRows.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active }))}
        drivers={masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active }))}
        projects={masters.projects.map((p) => ({ id: p.id, name: p.name, is_active: p.is_active }))}
        canEdit={editable}
      />
    </div>
  );
}
