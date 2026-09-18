import { canEdit, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadExpenseCategories, loadExpenseSummary, loadExpenses, loadMasters } from "@/lib/db/queries";
import { monthFromParam } from "@/lib/month";
import { ExpensesView } from "@/components/expenses/expenses-view";
import type { ExpenseChoices } from "@/components/expenses/expense-dialog";
import { toCategoryTotal, toExpenseRow } from "@/components/expenses/helpers";

export const metadata = { title: "経費" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const { supabase, profile, company } = await requireStaff();

  const [expenses, summary, closed] = await Promise.all([
    loadExpenses(supabase, company.id, month),
    loadExpenseSummary(supabase, company.id, month),
    isMonthClosed(supabase, company.id, month),
  ]);

  const editable = canEdit(profile.role) && !closed;
  // ダイアログの選択肢は編集できるときだけ読み込む（停止中も含めて読み、選択肢は画面側で絞る）
  const [categories, masters] = await Promise.all([
    editable ? loadExpenseCategories(supabase, company.id) : null,
    editable ? loadMasters(supabase, company.id) : null,
  ]);
  const choices: ExpenseChoices | null =
    categories && masters
      ? {
          categories: categories.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active })),
          drivers: masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active })),
          projects: masters.projects.map((p) => ({ id: p.id, name: p.name, is_active: p.is_active })),
        }
      : null;

  return (
    <ExpensesView
      month={month}
      rows={expenses.map(toExpenseRow)}
      categories={summary.map(toCategoryTotal)}
      editable={editable}
      closed={closed}
      choices={choices}
    />
  );
}
