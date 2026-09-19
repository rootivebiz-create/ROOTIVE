"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, type SessionContext } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import {
  addApplicantEventSchema,
  contractInputSchema,
  convertApplicantSchema,
  createApplicantSchema,
  endContractSchema,
  moveApplicantStageSchema,
  toggleChecklistSchema,
  updateApplicantSchema,
  type ApplicantFormInput,
  type ContractFormInput,
  type ConvertApplicantInput,
} from "@/lib/schemas/hr";
import { todayJST, type ChecklistKey } from "@/lib/hr/helpers";
import type { ApplicantStage } from "@/lib/db/types";
import type { Json } from "@/lib/db/database.types";

/**
 * 採用（応募者）と業務委託契約の Server Actions。
 * すべて admin 以上（DB の RLS でも admin のみ書き込み可）。
 * 段階の変更は applicants.stage を更新するだけでよい（applicant_events への履歴は DB のトリガーが残す）。
 */

/** 採用・契約の変更が影響する画面 */
function revalidateHr(): void {
  revalidatePath("/hr");
  revalidatePath("/dashboard");
}

/** ドライバーを増やしたときに影響する画面 */
function revalidateDrivers(): void {
  revalidatePath("/settings/drivers", "layout");
  revalidatePath("/entries");
  revalidatePath("/payouts", "layout");
}

/** 応募者のうち、操作に必要な列だけ */
interface ApplicantRef {
  id: string;
  stage: ApplicantStage;
  driver_id: string | null;
  started_on: string | null;
  checklist: Json;
}

/** 応募者が自社のものか確認して返す */
async function loadApplicant(ctx: SessionContext, id: string): Promise<ApplicantRef> {
  const res = await ctx.supabase.from("applicants").select("id, stage, driver_id, started_on, checklist").eq("id", id).eq("company_id", ctx.company.id).maybeSingle();
  return unwrap<ApplicantRef>(res, "対象の応募者が見つかりません（既に削除された可能性があります）。");
}

/** ドライバーが自社のものか確認する */
async function assertDriver(ctx: SessionContext, driverId: string): Promise<void> {
  const res = await ctx.supabase.from("drivers").select("id").eq("id", driverId).eq("company_id", ctx.company.id).maybeSingle();
  ensureNoError(res);
  if (!res.data) throw new ActionError("ドライバーが見つかりません。画面を再読み込みしてください。", { driver_id: ["ドライバーを選択してください"] });
}

// ---------------------------------------------------------------------------
// 応募者
// ---------------------------------------------------------------------------

/** 応募者の追加（admin+） */
export async function createApplicantAction(input: ApplicantFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = createApplicantSchema.parse(input);
    const row = unwrap<{ id: string }>(
      await supabase
        .from("applicants")
        .insert({
          company_id: company.id,
          name: v.name,
          kana: v.kana,
          phone: v.phone,
          email: v.email,
          source: v.source,
          stage: v.stage,
          applied_on: v.applied_on,
          interview_on: v.interview_on,
          memo: v.memo,
          created_by: user.id,
        })
        .select("id")
        .single(),
    );
    revalidateHr();
    return { id: row.id };
  }, "応募者を追加しました");
}

/** 応募者の更新（連絡先・応募日など。段階は moveApplicantStageAction で変える） */
export async function updateApplicantAction(input: ApplicantFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = updateApplicantSchema.parse(input);
    const row = unwrap<{ id: string }>(
      await supabase
        .from("applicants")
        .update({
          name: v.name,
          kana: v.kana,
          phone: v.phone,
          email: v.email,
          source: v.source,
          applied_on: v.applied_on,
          interview_on: v.interview_on,
          memo: v.memo,
        })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の応募者が見つかりません（既に削除された可能性があります）。",
    );
    revalidateHr();
    return { id: row.id };
  }, "応募者を保存しました");
}

/**
 * 段階を進める／戻す（admin+）
 * note があれば、やりとりとしても記録する（段階の変更自体は DB のトリガーが履歴に残す）。
 */
export async function moveApplicantStageAction(id: string, stage: ApplicantStage, note?: string): Promise<ActionResult<{ id: string; stage: ApplicantStage }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = moveApplicantStageSchema.parse({ id, stage, note: note ?? "" });
    const current = await loadApplicant(ctx, v.id);
    const today = todayJST();

    // 「稼働開始」へ進めたときは稼働開始日も埋める（未入力のときだけ）
    const startedOn = v.stage === "started" ? (current.started_on ?? today) : current.started_on;
    const row = unwrap<{ id: string; stage: ApplicantStage }>(
      await supabase.from("applicants").update({ stage: v.stage, started_on: startedOn }).eq("id", v.id).eq("company_id", company.id).select("id, stage").maybeSingle(),
      "対象の応募者が見つかりません（既に削除された可能性があります）。",
    );

    if (v.note !== "") {
      ensureNoError(
        await supabase.from("applicant_events").insert({
          company_id: company.id,
          applicant_id: v.id,
          happened_on: today,
          stage: v.stage,
          note: v.note,
          created_by: user.id,
        }),
      );
    }

    revalidateHr();
    return { id: row.id, stage: row.stage };
  }, "段階を変更しました");
}

/** 応募者の削除（admin+。やりとりの履歴も一緒に消える） */
export async function deleteApplicantAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const applicantId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("applicants").delete().eq("id", applicantId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の応募者が見つかりません（既に削除された可能性があります）。",
    );
    revalidateHr();
    return { id: row.id };
  }, "応募者を削除しました");
}

/** やりとりの記録を追加（admin+） */
export async function addApplicantEventAction(applicantId: string, happenedOn: string, note: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = addApplicantEventSchema.parse({ applicant_id: applicantId, happened_on: happenedOn, note });
    const applicant = await loadApplicant(ctx, v.applicant_id);
    const row = unwrap<{ id: string }>(
      await supabase
        .from("applicant_events")
        .insert({
          company_id: company.id,
          applicant_id: applicant.id,
          happened_on: v.happened_on,
          stage: applicant.stage,
          note: v.note,
          created_by: user.id,
        })
        .select("id")
        .single(),
    );
    revalidateHr();
    return { id: row.id };
  }, "やりとりを記録しました");
}

/** 必要書類のチェック（admin+）。既存の内容は残したまま 1 項目だけ書き換える */
export async function toggleChecklistAction(id: string, key: ChecklistKey, value: boolean): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const v = toggleChecklistSchema.parse({ id, key, value });
    const applicant = await loadApplicant(ctx, v.id);
    // 既にある内容（将来項目が増えても消さない）に 1 項目だけ足す
    const current = typeof applicant.checklist === "object" && applicant.checklist !== null && !Array.isArray(applicant.checklist) ? applicant.checklist : {};
    const row = unwrap<{ id: string }>(
      await supabase
        .from("applicants")
        .update({ checklist: { ...current, [v.key]: v.value } })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の応募者が見つかりません（既に削除された可能性があります）。",
    );
    revalidateHr();
    return { id: row.id };
  }, "書類の状況を更新しました");
}

/**
 * 応募者をドライバーとして登録する（admin+）
 * - 既に driver_id があれば作り直さず、そのドライバーに紐づけたままにする
 * - 同じ名前のドライバーが既にいる場合はエラーで止める（取り違えを防ぐため）
 * - 応募者は driver_id / started_on を埋めて段階を「稼働開始」にする
 */
export async function convertApplicantToDriverAction(id: string, input: ConvertApplicantInput): Promise<ActionResult<{ driverId: string; created: boolean }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const v = convertApplicantSchema.parse({ id, ...input });
    const applicant = await loadApplicant(ctx, v.id);

    let driverId = applicant.driver_id;
    const created = driverId == null;
    if (driverId == null) {
      const dup = await supabase.from("drivers").select("id").eq("company_id", company.id).eq("name", v.name).limit(1);
      ensureNoError(dup);
      if ((dup.data ?? []).length > 0) {
        throw new ActionError("同じ名前のドライバーが既に登録されています。名前を変えるか、既存のドライバーを確認してください。", {
          name: ["同じ名前のドライバーが既に登録されています"],
        });
      }
      const maxRes = await supabase.from("drivers").select("sort_order").eq("company_id", company.id).order("sort_order", { ascending: false }).limit(1);
      ensureNoError(maxRes);
      const sort_order = Number(maxRes.data?.[0]?.sort_order ?? 0) + 1;
      const driver = unwrap<{ id: string }>(
        await supabase
          .from("drivers")
          .insert({ company_id: company.id, name: v.name, kana: v.kana, phone: v.phone, email: v.email, sort_order })
          .select("id")
          .single(),
      );
      driverId = driver.id;
    }

    ensureNoError(
      await supabase
        .from("applicants")
        .update({ driver_id: driverId, started_on: v.started_on, stage: "started" })
        .eq("id", v.id)
        .eq("company_id", company.id),
    );

    revalidateHr();
    revalidateDrivers();
    return { driverId, created };
  }, "ドライバーとして登録しました");
}

// ---------------------------------------------------------------------------
// 業務委託契約
// ---------------------------------------------------------------------------

/** 契約の追加・更新（admin+） */
export async function saveContractAction(input: ContractFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = contractInputSchema.parse(input);
    await assertDriver(ctx, v.driver_id);

    const row = {
      driver_id: v.driver_id,
      title: v.title,
      status: v.status,
      start_on: v.start_on,
      end_on: v.end_on,
      auto_renew: v.auto_renew,
      notice_days: v.notice_days,
      file_path: v.file_path,
      agreed_at: v.agreed_on == null ? null : `${v.agreed_on}T00:00:00+09:00`,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("contracts").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の契約が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("contracts").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    revalidateHr();
    return { id: saved.id };
  }, "契約を保存しました");
}

/** 契約を終了にする（admin+） */
export async function endContractAction(id: string, endOn: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = endContractSchema.parse({ id, end_on: endOn });
    const row = unwrap<{ id: string }>(
      await supabase.from("contracts").update({ status: "ended", end_on: v.end_on }).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の契約が見つかりません（既に削除された可能性があります）。",
    );
    revalidateHr();
    return { id: row.id };
  }, "契約を終了にしました");
}

/** 契約の削除（admin+） */
export async function deleteContractAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const contractId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("contracts").delete().eq("id", contractId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の契約が見つかりません（既に削除された可能性があります）。",
    );
    revalidateHr();
    return { id: row.id };
  }, "契約を削除しました");
}
