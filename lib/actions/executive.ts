"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireOwnerAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import {
  advisorSchema,
  approvalRuleSchema,
  companyProfileSchema,
  confidentialScopeSchema,
  decisionReviewSchema,
  decisionSchema,
  delegationSchema,
  guaranteeSchema,
  insurancePolicySchema,
  officerSchema,
  shareholderSchema,
} from "@/lib/schemas/executive";
import { uuidSchema } from "@/lib/schemas/common";
import type { Json } from "@/lib/db/database.types";

/**
 * 代表（Executive）の Server Actions：会社の台帳・意思決定ログ・決裁のルールと委任・機密の見せ方。
 *
 * **すべて代表（owner）のみ**。順序は CLAUDE.md §1 のとおり
 * （requireOwnerAction → zod → supabase-js（RLS 適用）→ revalidatePath → ActionResult）。
 * DB 側も代表専用テーブルを RLS で閉じているので、ここが破られても書き込めない（§2 の二重の確認）。
 *
 * 削除の確認（「本当に消しますか」）は画面側の責任。ここでは素直に delete する。
 */

export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type OfficerInput = z.input<typeof officerSchema>;
export type ShareholderInput = z.input<typeof shareholderSchema>;
export type InsurancePolicyInput = z.input<typeof insurancePolicySchema>;
export type AdvisorInput = z.input<typeof advisorSchema>;
export type GuaranteeInput = z.input<typeof guaranteeSchema>;
export type DecisionInput = z.input<typeof decisionSchema>;
export type DecisionReviewInput = z.input<typeof decisionReviewSchema>;
export type ApprovalRuleInput = z.input<typeof approvalRuleSchema>;
export type DelegationInput = z.input<typeof delegationSchema>;
export type ConfidentialScopeFormInput = z.input<typeof confidentialScopeSchema>;

/** 代表の画面（/executive 以下）をまとめて作り直す */
function revalidateExecutive(): void {
  revalidatePath("/executive", "layout");
}

// ---------------------------------------------------------------------------
// 会社の台帳（登記・役員・株主・保険・顧問・個人保証）
// ---------------------------------------------------------------------------

/** 会社の基本情報（company_profile は会社 1 件なので upsert） */
export async function saveCompanyProfileAction(input: CompanyProfileInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const v = companyProfileSchema.parse(input);

    ensureNoError(
      await supabase.from("company_profile").upsert(
        {
          company_id: company.id,
          corporate_number: v.corporate_number,
          established_on: v.established_on,
          capital: v.capital,
          registered_address: v.registered_address,
          representative_name: v.representative_name,
          business_purpose: v.business_purpose,
          transport_office: v.transport_office,
          transport_number: v.transport_number,
          transport_notified_on: v.transport_notified_on,
          labor_insurance_number: v.labor_insurance_number,
          social_insurance_number: v.social_insurance_number,
          memo: v.memo,
          updated_by: user.id,
        },
        { onConflict: "company_id" },
      ),
    );

    revalidateExecutive();
    return null;
  }, "会社の基本情報を保存しました");
}

/** 役員の登録・更新 */
export async function saveOfficerAction(input: OfficerInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = officerSchema.parse(input);
    const row = {
      name: v.name,
      title: v.title,
      appointed_on: v.appointed_on,
      term_end_on: v.term_end_on,
      is_active: v.is_active,
      memo: v.memo,
      sort_order: v.sort_order,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("officers").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の役員が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("officers").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateExecutive();
    return { id: saved.id };
  }, "役員を保存しました");
}

/** 役員の削除 */
export async function deleteOfficerAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const officerId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("officers").delete().eq("id", officerId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: officerId };
  }, "役員を削除しました");
}

/** 株主の登録・更新 */
export async function saveShareholderAction(input: ShareholderInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = shareholderSchema.parse(input);
    const row = { name: v.name, shares: v.shares, memo: v.memo, sort_order: v.sort_order };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("shareholders").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の株主が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("shareholders").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateExecutive();
    return { id: saved.id };
  }, "株主を保存しました");
}

/** 株主の削除 */
export async function deleteShareholderAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const shareholderId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("shareholders").delete().eq("id", shareholderId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: shareholderId };
  }, "株主を削除しました");
}

/** 保険の登録・更新 */
export async function saveInsurancePolicyAction(input: InsurancePolicyInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = insurancePolicySchema.parse(input);
    const row = {
      kind: v.kind,
      insurer: v.insurer,
      policy_no: v.policy_no,
      starts_on: v.starts_on,
      expires_on: v.expires_on,
      premium: v.premium,
      covers: v.covers,
      memo: v.memo,
      is_active: v.is_active,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("insurance_policies").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の保険が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("insurance_policies").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateExecutive();
    return { id: saved.id };
  }, "保険を保存しました");
}

/** 保険の削除 */
export async function deleteInsurancePolicyAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const policyId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("insurance_policies").delete().eq("id", policyId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: policyId };
  }, "保険を削除しました");
}

/** 顧問（税理士・社労士など）の登録・更新 */
export async function saveAdvisorAction(input: AdvisorInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = advisorSchema.parse(input);
    const row = { kind: v.kind, name: v.name, contact: v.contact, fee: v.fee, memo: v.memo, is_active: v.is_active, sort_order: v.sort_order };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("advisors").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の顧問が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("advisors").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateExecutive();
    return { id: saved.id };
  }, "顧問を保存しました");
}

/** 顧問の削除 */
export async function deleteAdvisorAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const advisorId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("advisors").delete().eq("id", advisorId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: advisorId };
  }, "顧問を削除しました");
}

/** 個人保証の登録・更新 */
export async function saveGuaranteeAction(input: GuaranteeInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = guaranteeSchema.parse(input);
    const row = {
      lender: v.lender,
      kind: v.kind,
      amount: v.amount,
      loan_id: v.loan_id,
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      is_active: v.is_active,
      memo: v.memo,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("guarantees").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の保証が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("guarantees").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateExecutive();
    return { id: saved.id };
  }, "個人保証を保存しました");
}

/** 個人保証の削除 */
export async function deleteGuaranteeAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const guaranteeId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("guarantees").delete().eq("id", guaranteeId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: guaranteeId };
  }, "個人保証を削除しました");
}

// ---------------------------------------------------------------------------
// 意思決定ログ
// ---------------------------------------------------------------------------

/** 意思決定ログの作成・更新 */
export async function saveDecisionAction(input: DecisionInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const v = decisionSchema.parse(input);
    const row = {
      title: v.title,
      context: v.context,
      decision: v.decision,
      reason: v.reason,
      expected_effect: v.expected_effect,
      amount: v.amount,
      decided_on: v.decided_on,
      review_on: v.review_on,
      approval_id: v.approval_id,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("decisions").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の意思決定ログが見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(
          await supabase.from("decisions").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single(),
        );

    revalidateExecutive();
    return { id: saved.id };
  }, "意思決定ログを保存しました");
}

/** 振り返り（結果を書いて状態を変える） */
export async function reviewDecisionAction(input: DecisionReviewInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = decisionReviewSchema.parse(input);

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("decisions")
        .update({ outcome: v.outcome, outcome_on: v.outcome_on, status: v.status })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の意思決定ログが見つかりません（既に削除された可能性があります）。",
    );

    revalidateExecutive();
    return { id: saved.id };
  }, "振り返りを保存しました");
}

/** 意思決定ログの削除 */
export async function deleteDecisionAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const decisionId = uuidSchema.parse(id);
    ensureNoError(await supabase.from("decisions").delete().eq("id", decisionId).eq("company_id", company.id));
    revalidateExecutive();
    return { id: decisionId };
  }, "意思決定ログを削除しました");
}

// ---------------------------------------------------------------------------
// 決裁のルール（種別ごとのしきい値）
// ---------------------------------------------------------------------------

/**
 * 決裁のルールの更新。
 * 種別は会社を作ったときに DB が入れる（default_approval_rules）ので、ここでは追加・削除をしない。
 */
export async function saveApprovalRuleAction(input: ApprovalRuleInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = approvalRuleSchema.parse(input);

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("approval_rules")
        .update({
          threshold_amount: v.threshold_amount,
          is_enabled: v.is_enabled,
          due_days: v.due_days,
          label: v.label,
          note: v.note,
        })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象のルールが見つかりません。",
    );

    revalidateExecutive();
    return { id: saved.id };
  }, "決裁のルールを保存しました");
}

// ---------------------------------------------------------------------------
// 決裁の委任（期間・上限金額・種別つき）
// ---------------------------------------------------------------------------

/** 委任の作成・更新。委任先が自社のスタッフかは DB のトリガーが確認する */
export async function saveDelegationAction(input: DelegationInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireOwnerAction();
    const v = delegationSchema.parse(input);
    const row = {
      to_profile_id: v.to_profile_id,
      from_on: v.from_on,
      to_on: v.to_on,
      max_amount: v.max_amount,
      // kinds は approval_kind[]（Postgres の配列）。空配列は「種別を問わない」
      kinds: v.kinds,
      is_active: v.is_active,
      memo: v.memo,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("approval_delegations").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の委任が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(
          await supabase
            .from("approval_delegations")
            .insert({ ...row, company_id: company.id, created_by: user.id })
            .select("id")
            .single(),
        );

    revalidateExecutive();
    return { id: saved.id };
  }, "決裁の委任を保存しました");
}

/** 委任を停止する（記録は残す） */
export async function stopDelegationAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const delegationId = uuidSchema.parse(id);

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("approval_delegations")
        .update({ is_active: false })
        .eq("id", delegationId)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の委任が見つかりません。",
    );

    revalidateExecutive();
    return { id: saved.id };
  }, "決裁の委任を停止しました");
}

// ---------------------------------------------------------------------------
// 機密の見せ方（companies.confidential_scope）
// ---------------------------------------------------------------------------

/**
 * 借入と納税・現金と資金繰り・ドライバーの振込口座を、誰まで見せるか。
 * DB の can_see_confidential が RLS でこの値を使うので、画面の出し分けだけでなく読み書きごと変わる。
 */
export async function updateConfidentialScopeAction(input: ConfidentialScopeFormInput): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const v = confidentialScopeSchema.parse(input);

    const scope: Json = { loans: v.loans, cash: v.cash, bank_account: v.bank_account };
    const res = await supabase.from("companies").update({ confidential_scope: scope }).eq("id", company.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("機密の見せ方を更新できませんでした（権限を確認してください）。");

    // 見える範囲が変わるので、シェルごと作り直す（借入・資金繰り・支払の画面に効く）
    revalidatePath("/", "layout");
    return null;
  }, "機密の見せ方を保存しました");
}
