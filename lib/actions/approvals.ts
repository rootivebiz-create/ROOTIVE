"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireAdminAction, requireStaffAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, type ActionResult } from "@/lib/actions/result";
import {
  approvalKindSchema,
  decideApprovalSchema,
  requestApprovalSchema,
  withdrawApprovalSchema,
} from "@/lib/schemas/executive";
import { optionalMoneySchema } from "@/lib/schemas/finance";
import { checkApprovalRequired } from "@/lib/executive/queries";
import type { Approval, ApprovalKind } from "@/lib/db/types";

/**
 * 決裁（代表への申請 → 決裁 → 取り下げ）の Server Actions。
 *
 * 順序は CLAUDE.md §1 のとおり：ロール確認 → zod 検証 → supabase-js（RPC）→ revalidatePath → ActionResult。
 *
 * 権限は DB に任せる（CLAUDE.md §2 の二重の確認のうち DB 側が本体）：
 * - 申請は `request_approval`（admin 以上）
 * - 決裁は `decide_approval`。**代表でなくても有効な委任があれば決裁できる**ので、
 *   アプリ側で owner に固定しない（`can_decide_approval` が判定する）
 * - 取り下げは `withdraw_approval`（申請した本人か代表。トリガーでも確認する）
 * 失敗時の日本語メッセージは DB の raise exception がそのまま出る（hint = 'FORBIDDEN' は translateError が変換）。
 */

export type RequestApprovalInput = z.input<typeof requestApprovalSchema>;
export type DecideApprovalInput = z.input<typeof decideApprovalSchema>;
export type WithdrawApprovalInput = z.input<typeof withdrawApprovalSchema>;

/** 決裁が影響する画面（代表ホーム・決裁の一覧とナビのバッジ） */
function revalidateApprovals(): void {
  revalidatePath("/executive");
  revalidatePath("/executive/approvals");
  revalidatePath("/dashboard");
  // 決裁待ちの件数はシェル（ナビ）に出るのでレイアウトごと作り直す
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// 申請（管理者 → 代表）
// ---------------------------------------------------------------------------

/** 代表に決裁をお願いする（admin 以上）。本処理はここでは実行しない */
export async function requestApprovalAction(input: RequestApprovalInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = requestApprovalSchema.parse(input);

    const res = await supabase.rpc("request_approval", {
      p_kind: v.kind,
      p_title: v.title,
      p_detail: v.detail,
      p_amount: v.amount ?? undefined,
      p_ref_table: v.ref_table,
      p_ref_id: v.ref_id,
      p_href: v.href,
      p_due_on: v.due_on ?? undefined,
    });
    ensureNoError(res);
    const id = typeof res.data === "string" ? res.data : null;
    if (!id) throw new ActionError("申請を作成できませんでした。");

    revalidateApprovals();
    return { id };
  }, "代表に決裁をお願いしました");
}

// ---------------------------------------------------------------------------
// 決裁（代表、または有効な委任を持つ管理者）
// ---------------------------------------------------------------------------

export interface DecideApprovalResult {
  id: string;
  status: Approval["status"];
  /** as_decision で作った意思決定ログの id（作らなかったときは null） */
  decision_id: string | null;
}

/**
 * 申請を承認・却下する。
 * 決裁してよいかは DB の `can_decide_approval`（代表 or 有効な委任）が決めるので、ここでは staff まで通す。
 */
export async function decideApprovalAction(input: DecideApprovalInput): Promise<ActionResult<DecideApprovalResult>> {
  return runAction(async () => {
    const { supabase, profile } = await requireStaffAction();
    const v = decideApprovalSchema.parse(input);

    const res = await supabase.rpc("decide_approval", { p_id: v.id, p_approve: v.approve, p_note: v.note });
    ensureNoError(res);
    const row = res.data as Approval | null;
    if (!row?.id) throw new ActionError("決裁できる申請が見つかりません。");

    // 承認と同時に意思決定ログの下書きを作る。
    // decision_from_approval は代表だけが呼べるので、代理で決裁した管理者のときは作らない
    // （決裁そのものは成立しているため、ここで失敗させない）。
    let decisionId: string | null = null;
    if (v.as_decision && v.approve && profile.role === "owner") {
      const made = await supabase.rpc("decision_from_approval", { p_approval_id: v.id });
      ensureNoError(made);
      decisionId = typeof made.data === "string" ? made.data : null;
      revalidatePath("/executive/decisions");
    }

    revalidateApprovals();
    return { id: row.id, status: row.status, decision_id: decisionId };
  }, "決裁しました");
}

// ---------------------------------------------------------------------------
// 取り下げ（申請した本人か代表）
// ---------------------------------------------------------------------------

/** 申請を取り下げる（admin 以上。本人以外は代表だけ＝ DB のトリガーが確認する） */
export async function withdrawApprovalAction(input: WithdrawApprovalInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const v = withdrawApprovalSchema.parse(input);

    const res = await supabase.rpc("withdraw_approval", { p_id: v.id, p_note: v.note });
    ensureNoError(res);
    const row = res.data as Approval | null;
    if (!row?.id) throw new ActionError("取り下げできる申請が見つかりません。");

    revalidateApprovals();
    return { id: row.id };
  }, "申請を取り下げました");
}

// ---------------------------------------------------------------------------
// 申請が要るかの確認（画面の金額に合わせて確かめる）
// ---------------------------------------------------------------------------

export interface ApprovalRequirement {
  required: boolean;
  due_on: string | null;
  label: string;
}

/**
 * その種別・金額で代表の決裁が要るか（しきい値は DB の approval_rules）。
 * 画面で金額のしきい値を手書きしないために、入力のたびにここで確かめる。
 */
export async function checkApprovalRequiredAction(kind: ApprovalKind, amount: unknown): Promise<ActionResult<ApprovalRequirement>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const k = approvalKindSchema.parse(kind);
    const a = optionalMoneySchema.parse(amount);
    return await checkApprovalRequired(supabase, k, a);
  });
}
