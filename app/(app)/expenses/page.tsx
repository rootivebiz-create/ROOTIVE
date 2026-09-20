import { canEdit, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadExpenseCategories, loadExpenseSummary, loadExpenses, loadMasters } from "@/lib/db/queries";
import { monthFromParam } from "@/lib/month";
import { ExpensesView } from "@/components/expenses/expenses-view";
import type { ExpenseChoices } from "@/components/expenses/expense-dialog";
import { toCategoryTotal, toExpenseRow } from "@/components/expenses/helpers";
import { ReceiptUpload } from "@/components/intake/receipt-upload";
import { isAiInsightsEnabled } from "@/lib/ai/config";
import { checkApprovalRequired } from "@/lib/executive/queries";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";

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

  // 代表の決裁が要るか（しきい値は DB の approval_rules。画面に金額を書かない）。
  // 申請できるのは admin 以上なので、編集できる人にだけ入口を出す
  const approval = editable ? await checkApprovalRequired(supabase, "expense", null) : null;

  return (
    <div className="space-y-4">
      {approval && (
        <RequestApprovalDialog
          kind="expense"
          notice={{ required: approval.required, label: approval.label, dueOn: approval.due_on }}
          description="金額の大きい経費は、先に代表へ申請してください。代表の承認後にこの画面から登録できます。"
          defaultTitle="経費の登録"
          withAmount
          refTable="expenses"
          href={`/expenses?m=${month}`}
        />
      )}
      <ExpensesView
        month={month}
        rows={expenses.map(toExpenseRow)}
        categories={summary.map(toCategoryTotal)}
        editable={editable}
        closed={closed}
        choices={choices}
      />
      {/* レシートを撮って経費にする（AI が金額・日付・支払先・カテゴリを読み取る） */}
      <ReceiptUpload categories={categories ?? []} month={month} canEdit={editable} aiEnabled={isAiInsightsEnabled()} />
    </div>
  );
}
