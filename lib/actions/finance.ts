"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import {
  deleteLoanSchema,
  deleteTaxTaskSchema,
  ensureTaxTasksSchema,
  loanInputSchema,
  saveYearTargetsSchema,
  setLoanPaymentPaidSchema,
  setTaxTaskStatusSchema,
  taxTaskInputSchema,
  type LoanFormInput,
  type SaveYearTargetsInput,
  type TaxTaskFormInput,
} from "@/lib/schemas/finance";
import { uuidSchema } from "@/lib/schemas/common";
import { monthToDate } from "@/lib/month";
import { todayJST } from "@/lib/finance/date";
import type { TaxTaskStatus } from "@/lib/db/types";

/**
 * 財務（年間予算・借入金・税務カレンダー）の Server Actions。
 * すべて admin 以上（DB の RLS でも admin のみ書き込み可）。
 *
 * 順序は CLAUDE.md §1 のとおり：ロール確認 → zod 検証 → supabase-js → revalidatePath → ActionResult。
 * 返済予定は必ず RPC generate_loan_schedule に作らせる（アプリ側で元利均等の表を書かない）。
 */

/** 予算の変更が影響する画面（ダッシュボードの進捗バー・年次レポート） */
function revalidateBudget(): void {
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

/** 借入の変更が影響する画面（資金繰りに返済が載る） */
function revalidateLoans(): void {
  revalidatePath("/finance");
  revalidatePath("/cashflow");
  revalidatePath("/dashboard");
}

/** 税務の期限の変更が影響する画面（期限はアラートにも出る） */
function revalidateTax(): void {
  revalidatePath("/finance");
  revalidatePath("/alerts");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// 年間予算（month_targets）
// ---------------------------------------------------------------------------

/** 12 か月ぶんの目標をまとめて保存（admin+）。締め済み月の目標も編集できる */
export async function saveYearTargetsAction(input: SaveYearTargetsInput): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = saveYearTargetsSchema.parse(input);
    const rows = v.rows.map((r) => ({
      company_id: company.id,
      month: monthToDate(r.month),
      bill_target: r.bill_target,
      profit_target: r.profit_target,
      expense_target: r.expense_target,
      driver_target: r.driver_target,
    }));
    // memo は含めない（単月の目標ダイアログで入れたメモを消さないため）
    ensureNoError(await supabase.from("month_targets").upsert(rows, { onConflict: "company_id,month" }));
    revalidateBudget();
    return { count: rows.length };
  }, "年間予算を保存しました");
}

// ---------------------------------------------------------------------------
// 借入金
// ---------------------------------------------------------------------------

/** 借入の登録・更新（admin+）。保存後に返済予定を作り直す */
export async function saveLoanAction(input: LoanFormInput): Promise<ActionResult<{ id: string; payments: number }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = loanInputSchema.parse(input);

    const row = {
      name: v.name,
      lender: v.lender,
      principal: v.principal,
      annual_rate: v.annual_rate,
      start_on: v.start_on,
      months: v.months,
      payment_day: v.payment_day,
      monthly_payment: v.monthly_payment,
      status: v.status,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("loans").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の借入が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("loans").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    // 返済予定は DB の RPC に作らせる（元利均等。返済済みの回は残る）
    const generated = await supabase.rpc("generate_loan_schedule", { p_loan_id: saved.id });
    ensureNoError(generated);

    revalidateLoans();
    return { id: saved.id, payments: typeof generated.data === "number" ? generated.data : 0 };
  }, "借入を保存しました");
}

/** 返済予定の作り直し（admin+）。返済済みの回はそのまま残る */
export async function regenerateLoanScheduleAction(loanId: string): Promise<ActionResult<{ payments: number }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const id = uuidSchema.parse(loanId);
    const res = await supabase.rpc("generate_loan_schedule", { p_loan_id: id });
    ensureNoError(res);
    revalidateLoans();
    return { payments: typeof res.data === "number" ? res.data : 0 };
  }, "返済予定を作り直しました");
}

/** 借入の削除（admin+）。返済済みの回があるときは削除できない */
export async function deleteLoanAction(loanId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteLoanSchema.parse({ id: loanId });

    const payments = await supabase.from("loan_payments").select("id, paid_on").eq("company_id", company.id).eq("loan_id", v.id).limit(1000);
    ensureNoError(payments);
    if ((payments.data ?? []).some((p) => p.paid_on != null)) {
      throw new ActionError("返済済みの回があるため削除できません。記録を残す場合は状態を「完済」にしてください。");
    }

    const row = unwrap<{ id: string }>(
      await supabase.from("loans").delete().eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の借入が見つかりません（既に削除された可能性があります）。",
    );
    revalidateLoans();
    return { id: row.id };
  }, "借入を削除しました");
}

/** 返済予定の 1 回を「返済済み」にする／戻す（admin+）。paidOn が null なら未返済に戻す */
export async function setLoanPaymentPaidAction(paymentId: string, paidOn: string | null): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = setLoanPaymentPaidSchema.parse({ id: paymentId, paid_on: paidOn });
    const row = unwrap<{ id: string }>(
      await supabase.from("loan_payments").update({ paid_on: v.paid_on }).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の返済予定が見つかりません（既に削除された可能性があります）。",
    );
    revalidateLoans();
    return { id: row.id };
  }, "返済の記録を更新しました");
}

// ---------------------------------------------------------------------------
// 決算・税務の期限
// ---------------------------------------------------------------------------

/** 期限の登録・更新（admin+）。自分で足したものは is_generated = false */
export async function saveTaxTaskAction(input: TaxTaskFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = taxTaskInputSchema.parse(input);
    const today = todayJST();

    const row = {
      title: v.title,
      detail: v.detail,
      due_on: v.due_on,
      status: v.status,
      done_on: v.status === "todo" ? null : today,
      amount: v.amount,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("tax_tasks").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の期限が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(
          await supabase
            .from("tax_tasks")
            .insert({ ...row, company_id: company.id, kind: `custom_${Date.now()}`, is_generated: false, created_by: user.id })
            .select("id")
            .single(),
        );

    revalidateTax();
    return { id: saved.id };
  }, "期限を保存しました");
}

/** 期限の状態を変える（admin+）。対応済みにすると done_on に今日が入る */
export async function setTaxTaskStatusAction(taskId: string, status: TaxTaskStatus): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = setTaxTaskStatusSchema.parse({ id: taskId, status });
    const row = unwrap<{ id: string }>(
      await supabase
        .from("tax_tasks")
        .update({ status: v.status, done_on: v.status === "todo" ? null : todayJST() })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の期限が見つかりません（既に削除された可能性があります）。",
    );
    revalidateTax();
    return { id: row.id };
  }, "期限の状態を変更しました");
}

/** 期限の削除（admin+） */
export async function deleteTaxTaskAction(taskId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteTaxTaskSchema.parse({ id: taskId });
    const row = unwrap<{ id: string }>(
      await supabase.from("tax_tasks").delete().eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の期限が見つかりません（既に削除された可能性があります）。",
    );
    revalidateTax();
    return { id: row.id };
  }, "期限を削除しました");
}

/** その年の期限をまとめて作る（admin+）。会社設定の決算月から組み立てる（二重に作らない） */
export async function ensureTaxTasksAction(year: number | string): Promise<ActionResult<{ created: number }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = ensureTaxTasksSchema.parse({ year });
    const res = await supabase.rpc("ensure_tax_tasks", { p_year: v.year });
    ensureNoError(res);
    revalidateTax();
    return { created: typeof res.data === "number" ? res.data : 0 };
  }, "この年の期限を作りました");
}
