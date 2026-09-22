"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, type SessionContext } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { uuidSchema } from "@/lib/schemas/common";
import {
  aptitudeInputSchema,
  documentInputSchema,
  incidentInputSchema,
  instructionInputSchema,
  safetyManagerInputSchema,
  vehicleInputSchema,
  type AptitudeFormInput,
  type DocumentFormInput,
  type IncidentFormInput,
  type InstructionFormInput,
  type SafetyManagerFormInput,
  type VehicleFormInput,
} from "@/lib/schemas/fleet";

/**
 * 車両・書類・安全管理（安全管理者・指導監督・事故）の Server Actions。
 * 規約どおり requireAdminAction() → zod 検証 → DB 操作（RLS 適用）→ revalidatePath → ActionResult。
 * 権限は DB 側（RLS：書き込みは admin 以上）でも必ず拒否される（二重の守り）。
 */

/** 車両・書類の変更が影響する画面 */
const FLEET_PATHS = ["/fleet", "/dashboard", "/alerts"];
/** 安全管理の変更が影響する画面 */
const SAFETY_PATHS = ["/settings/safety", "/dashboard", "/alerts"];

function revalidateFleet(): void {
  for (const p of FLEET_PATHS) revalidatePath(p);
}

function revalidateSafety(): void {
  for (const p of SAFETY_PATHS) revalidatePath(p);
}

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
}

async function assertExists(
  ctx: SessionContext,
  table: "drivers" | "vehicles",
  ids: (string | null | undefined)[],
  message: string,
): Promise<void> {
  const list = uniqueIds(ids);
  if (list.length === 0) return;
  const res = await ctx.supabase.from(table).select("id").eq("company_id", ctx.company.id).in("id", list);
  ensureNoError(res);
  const known = new Set((res.data ?? []).map((r) => r.id));
  if (list.some((id) => !known.has(id))) throw new ActionError(message);
}

/** ドライバー・車両が自社のものか確認する（RLS により他社の行は見えない） */
async function assertRefs(ctx: SessionContext, refs: { driverIds?: (string | null)[]; vehicleIds?: (string | null)[] }): Promise<void> {
  await assertExists(ctx, "drivers", refs.driverIds ?? [], "ドライバーが見つかりません。画面を再読み込みしてください。");
  await assertExists(ctx, "vehicles", refs.vehicleIds ?? [], "車両が見つかりません。画面を再読み込みしてください。");
}

/** 参照されている件数を数える（0 件なら削除してよい） */
async function countRefs(ctx: SessionContext, table: "daily_reports" | "incidents" | "documents", column: "vehicle_id", id: string): Promise<number> {
  const res = await ctx.supabase.from(table).select("id", { count: "exact" }).eq("company_id", ctx.company.id).eq(column, id).limit(1);
  ensureNoError(res);
  return res.count ?? (res.data ?? []).length;
}

// ---------------------------------------------------------------------------
// 車両
// ---------------------------------------------------------------------------

/** 車両の登録（admin+）。車両番号は会社内で重複できない */
export async function createVehicleAction(input: VehicleFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const v = vehicleInputSchema.parse({ ...input, id: null });
    await assertRefs(ctx, { driverIds: [v.driver_id] });
    await assertPlateIsFree(ctx, v.plate, null);

    const maxRes = await supabase.from("vehicles").select("sort_order").eq("company_id", company.id).order("sort_order", { ascending: false }).limit(1);
    ensureNoError(maxRes);
    const sort_order = Number(maxRes.data?.[0]?.sort_order ?? 0) + 1;

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("vehicles")
        .insert({
          company_id: company.id,
          plate: v.plate,
          maker: v.maker,
          model: v.model,
          ownership: v.ownership,
          driver_id: v.driver_id,
          lease_monthly: v.lease_monthly,
          odometer: v.odometer,
          memo: v.memo,
          is_active: v.is_active,
          sort_order,
        })
        .select("id")
        .single(),
    );

    revalidateFleet();
    return { id: saved.id };
  }, "車両を登録しました");
}

/** 車両の更新（admin+） */
export async function updateVehicleAction(input: VehicleFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const v = vehicleInputSchema.parse(input);
    if (!v.id) throw new ActionError("更新する車両が指定されていません。");
    await assertRefs(ctx, { driverIds: [v.driver_id] });
    await assertPlateIsFree(ctx, v.plate, v.id);

    const saved = unwrap<{ id: string }>(
      await supabase
        .from("vehicles")
        .update({
          plate: v.plate,
          maker: v.maker,
          model: v.model,
          ownership: v.ownership,
          driver_id: v.driver_id,
          lease_monthly: v.lease_monthly,
          odometer: v.odometer,
          memo: v.memo,
          is_active: v.is_active,
        })
        .eq("id", v.id)
        .eq("company_id", company.id)
        .select("id")
        .maybeSingle(),
      "対象の車両が見つかりません（既に削除された可能性があります）。",
    );

    revalidateFleet();
    return { id: saved.id };
  }, "車両を保存しました");
}

/** 車両番号の重複を先に確かめる（DB の unique(company_id, plate) より分かりやすいメッセージにする） */
async function assertPlateIsFree(ctx: SessionContext, plate: string, exceptId: string | null): Promise<void> {
  let q = ctx.supabase.from("vehicles").select("id").eq("company_id", ctx.company.id).eq("plate", plate).limit(1);
  if (exceptId) q = q.neq("id", exceptId);
  const res = await q;
  ensureNoError(res);
  if ((res.data ?? []).length > 0) {
    throw new ActionError("同じ車両番号が既に登録されています。", { plate: ["同じ車両番号が既に登録されています"] });
  }
}

/**
 * 車両の削除（admin+）
 * 日報・事故・書類から参照されている車両は削除できない（記録が消えてしまうため）。
 * その場合は「停止中にする」よう日本語で案内する。
 */
export async function deleteVehicleAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const vehicleId = uuidSchema.parse(id);

    const [reports, incidents, documents] = await Promise.all([
      countRefs(ctx, "daily_reports", "vehicle_id", vehicleId),
      countRefs(ctx, "incidents", "vehicle_id", vehicleId),
      countRefs(ctx, "documents", "vehicle_id", vehicleId),
    ]);
    if (reports > 0) throw new ActionError("この車両を使った日報があるため削除できません。車両を停止中にしてください（記録はそのまま残ります）。");
    if (incidents > 0) throw new ActionError("この車両の事故・違反の記録があるため削除できません。車両を停止中にしてください（記録はそのまま残ります）。");
    if (documents > 0) throw new ActionError("この車両の書類が登録されているため削除できません。先に書類を削除するか、車両を停止中にしてください。");

    const row = unwrap<{ id: string }>(
      await ctx.supabase.from("vehicles").delete().eq("id", vehicleId).eq("company_id", ctx.company.id).select("id").maybeSingle(),
      "対象の車両が見つかりません（既に削除された可能性があります）。",
    );

    revalidateFleet();
    return { id: row.id };
  }, "車両を削除しました");
}

// ---------------------------------------------------------------------------
// 書類と期限
// ---------------------------------------------------------------------------

/** 書類の追加・更新（admin+）。対象はドライバーか車両のどちらか一方 */
export async function saveDocumentAction(input: DocumentFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = documentInputSchema.parse(input);
    await assertRefs(ctx, { driverIds: [v.driver_id], vehicleIds: [v.vehicle_id] });

    const row = {
      kind: v.kind,
      driver_id: v.driver_id,
      vehicle_id: v.vehicle_id,
      label: v.label,
      number: v.number,
      issued_on: v.issued_on,
      expires_on: v.expires_on,
      reminder_days: v.reminder_days,
      memo: v.memo,
      is_active: v.is_active,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("documents").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の書類が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("documents").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    revalidateFleet();
    return { id: saved.id };
  }, "書類を保存しました");
}

/** 書類の削除（admin+） */
export async function deleteDocumentAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const documentId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("documents").delete().eq("id", documentId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の書類が見つかりません（既に削除された可能性があります）。",
    );
    revalidateFleet();
    return { id: row.id };
  }, "書類を削除しました");
}

// ---------------------------------------------------------------------------
// 貨物軽自動車安全管理者
// ---------------------------------------------------------------------------

/** 安全管理者の追加・更新（admin+） */
export async function saveSafetyManagerAction(input: SafetyManagerFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company } = ctx;
    const v = safetyManagerInputSchema.parse(input);
    await assertRefs(ctx, { driverIds: [v.driver_id] });

    const row = {
      name: v.name,
      office: v.office,
      driver_id: v.driver_id,
      appointed_on: v.appointed_on,
      training_on: v.training_on,
      training_expires_on: v.training_expires_on,
      notified_on: v.notified_on,
      memo: v.memo,
      is_active: v.is_active,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("safety_managers").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の安全管理者が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("safety_managers").insert({ ...row, company_id: company.id }).select("id").single());

    revalidateSafety();
    return { id: saved.id };
  }, "安全管理者を保存しました");
}

/** 安全管理者の削除（admin+） */
export async function deleteSafetyManagerAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const managerId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("safety_managers").delete().eq("id", managerId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の安全管理者が見つかりません（既に削除された可能性があります）。",
    );
    revalidateSafety();
    return { id: row.id };
  }, "安全管理者を削除しました");
}

// ---------------------------------------------------------------------------
// 指導・監督の記録
// ---------------------------------------------------------------------------

/** 指導・監督の記録の追加・更新（admin+）。記録は 3 年間保存する */
export async function saveInstructionAction(input: InstructionFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = instructionInputSchema.parse(input);
    await assertRefs(ctx, { driverIds: [v.driver_id] });

    const row = {
      driver_id: v.driver_id,
      kind: v.kind,
      instructed_on: v.instructed_on,
      hours: v.hours,
      topics: v.topics,
      instructor: v.instructor,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("driver_instructions").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の記録が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("driver_instructions").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    revalidateSafety();
    return { id: saved.id };
  }, "指導・監督の記録を保存しました");
}

/** 適性診断の記録の追加・更新（admin+）。初任・適齢・特定・一般の受診を残す */
export async function saveAptitudeAction(input: AptitudeFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = aptitudeInputSchema.parse(input);
    await assertRefs(ctx, { driverIds: [v.driver_id] });

    const row = {
      driver_id: v.driver_id,
      kind: v.kind,
      taken_on: v.taken_on,
      institution: v.institution,
      result: v.result,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("aptitude_tests").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の記録が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("aptitude_tests").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    revalidateSafety();
    return { id: saved.id };
  }, "適性診断の記録を保存しました");
}

/** 適性診断の記録の削除（admin+） */
export async function deleteAptitudeAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const testId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("aptitude_tests").delete().eq("id", testId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の記録が見つかりません（既に削除された可能性があります）。",
    );
    revalidateSafety();
    return { id: row.id };
  }, "適性診断の記録を削除しました");
}

/** 指導・監督の記録の削除（admin+） */
export async function deleteInstructionAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const instructionId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("driver_instructions").delete().eq("id", instructionId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の記録が見つかりません（既に削除された可能性があります）。",
    );
    revalidateSafety();
    return { id: row.id };
  }, "指導・監督の記録を削除しました");
}

// ---------------------------------------------------------------------------
// 事故・違反・ヒヤリハット
// ---------------------------------------------------------------------------

/** 事故・違反・ヒヤリハットの追加・更新（admin+） */
export async function saveIncidentAction(input: IncidentFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireAdminAction();
    const { supabase, company, user } = ctx;
    const v = incidentInputSchema.parse(input);
    await assertRefs(ctx, { driverIds: [v.driver_id], vehicleIds: [v.vehicle_id] });

    const row = {
      driver_id: v.driver_id,
      vehicle_id: v.vehicle_id,
      occurred_at: v.occurred_at,
      kind: v.kind,
      place: v.place,
      description: v.description,
      cause: v.cause,
      prevention: v.prevention,
      reported: v.reported,
      cost: v.cost,
      memo: v.memo,
    };

    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("incidents").update(row).eq("id", v.id).eq("company_id", company.id).select("id").maybeSingle(),
          "対象の記録が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(await supabase.from("incidents").insert({ ...row, company_id: company.id, created_by: user.id }).select("id").single());

    revalidateSafety();
    return { id: saved.id };
  }, "事故の記録を保存しました");
}

/** 事故・違反・ヒヤリハットの削除（admin+） */
export async function deleteIncidentAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const incidentId = uuidSchema.parse(id);
    const row = unwrap<{ id: string }>(
      await supabase.from("incidents").delete().eq("id", incidentId).eq("company_id", company.id).select("id").maybeSingle(),
      "対象の記録が見つかりません（既に削除された可能性があります）。",
    );
    revalidateSafety();
    return { id: row.id };
  }, "事故の記録を削除しました");
}
