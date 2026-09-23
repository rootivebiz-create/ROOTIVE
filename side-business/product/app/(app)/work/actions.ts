"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, type ActionResult } from "~/server/action";
import { audit } from "~/server/audit";
import { requireUser } from "~/server/auth";
import { adjustmentSchema, idSchema, monthSchema, workEntrySchema } from "~/server/features/import/schemas";
import { addAdjustment, addWorkEntry, bulkAddAdjustments, deleteAdjustment, deleteWorkEntry, updateAdjustment, updateWorkEntry } from "~/server/features/import/work";
import { monthParam } from "~/server/month";

/**
 * 稼働と調整の Server Action。役割の確認 → 入力の確かめ → server/features/import/work → 記録 → 読み直し。
 * 締めた月は work.ts と DB の引き金の両方で止まる。
 */

type State = ActionResult<unknown> | undefined;

const AFTER = "明細を作り直すと、金額に反映されます";

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

function entryInput(form: FormData) {
  return workEntrySchema.parse({
    driverId: text(form, "driverId"),
    projectId: text(form, "projectId"),
    qty: text(form, "qty"),
    workDate: text(form, "workDate"),
    note: text(form, "note"),
  });
}

function adjustmentInput(form: FormData) {
  return adjustmentSchema.parse({
    driverId: text(form, "driverId"),
    label: text(form, "label"),
    direction: text(form, "direction"),
    amount: text(form, "amount"),
    taxable: text(form, "taxable"),
    agreedInWriting: text(form, "agreedInWriting"),
    basis: text(form, "basis"),
  });
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function addEntryAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const month = monthSchema.parse(text(form, "month"));
    const input = entryInput(form);
    const db = await getDb();
    const { row, driver, project } = await addWorkEntry(db, user.tenantId, month, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "work.add",
      entity: "work_entry",
      entityId: row.id,
      detail: { month, driver: driver.name, project: project.name, qty: input.qty, workDate: input.workDate },
    });
    refresh();
  }, `稼働を足しました。${AFTER}`);
}

export async function updateEntryAction(_prev: State, form: FormData): Promise<State> {
  let back = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema("その稼働は見つかりません").parse(text(form, "id"));
    const input = entryInput(form);
    const db = await getDb();
    const { before, after } = await updateWorkEntry(db, user.tenantId, id, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "work.update",
      entity: "work_entry",
      entityId: id,
      detail: {
        before: {
          driverId: before.driverId,
          projectId: before.projectId,
          qty: before.qty,
          workDate: before.workDate,
          note: before.note,
          importBatchId: before.importBatchId,
        },
        after: { driverId: after.driverId, projectId: after.projectId, qty: after.qty, workDate: after.workDate, note: after.note },
      },
    });
    refresh();
    back = `/work?m=${monthParam(before.month)}&saved=entry`;
  });
  if (res.ok) redirect(back);
  return res;
}

export async function deleteEntryAction(_prev: State, form: FormData): Promise<State> {
  let back = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema("その稼働は見つかりません").parse(text(form, "id"));
    const db = await getDb();
    const before = await deleteWorkEntry(db, user.tenantId, id);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "work.delete",
      entity: "work_entry",
      entityId: id,
      detail: {
        month: before.month,
        driverId: before.driverId,
        projectId: before.projectId,
        qty: before.qty,
        workDate: before.workDate,
        importBatchId: before.importBatchId,
      },
    });
    refresh();
    back = `/work?m=${monthParam(before.month)}&saved=deleted`;
  });
  if (res.ok) redirect(back);
  return res;
}

export async function addAdjustmentAction(_prev: State, form: FormData): Promise<State> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const month = monthSchema.parse(text(form, "month"));
    const input = adjustmentInput(form);
    const db = await getDb();
    const { row, driver } = await addAdjustment(db, user.tenantId, month, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "adjustment.add",
      entity: "adjustment",
      entityId: row.id,
      detail: { month, driver: driver.name, ...input },
    });
    refresh();
  }, `調整を足しました。${AFTER}`);
}

export async function updateAdjustmentAction(_prev: State, form: FormData): Promise<State> {
  let back = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema("その調整は見つかりません").parse(text(form, "id"));
    const input = adjustmentInput(form);
    const db = await getDb();
    const { before, after } = await updateAdjustment(db, user.tenantId, id, input);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "adjustment.update",
      entity: "adjustment",
      entityId: id,
      detail: {
        before: {
          driverId: before.driverId,
          label: before.label,
          amount: before.amount,
          taxable: before.taxable,
          agreedInWriting: before.agreedInWriting,
          basis: before.basis,
        },
        after: {
          driverId: after.driverId,
          label: after.label,
          amount: after.amount,
          taxable: after.taxable,
          agreedInWriting: after.agreedInWriting,
          basis: after.basis,
        },
      },
    });
    refresh();
    back = `/work?m=${monthParam(before.month)}&saved=adjustment#adjustments`;
  });
  if (res.ok) redirect(back);
  return res;
}

export async function deleteAdjustmentAction(_prev: State, form: FormData): Promise<State> {
  let back = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const id = idSchema("その調整は見つかりません").parse(text(form, "id"));
    const db = await getDb();
    const before = await deleteAdjustment(db, user.tenantId, id);
    await audit(db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "adjustment.delete",
      entity: "adjustment",
      entityId: id,
      detail: { month: before.month, driverId: before.driverId, label: before.label, amount: before.amount },
    });
    refresh();
    back = `/work?m=${monthParam(before.month)}&saved=deleted#adjustments`;
  });
  if (res.ok) redirect(back);
  return res;
}

const bulkSchema = z.object({
  month: monthSchema,
  text: z.string().trim().min(1, "Excel の「名前・内容・金額」の列を貼り付けてください").max(50_000, "一度に貼り付けられる量を超えています。分けて入れてください"),
  defaultLabel: z
    .string()
    .trim()
    .max(60, "内容は 60 文字までにしてください")
    .transform((v) => v || null),
  sign: z.enum(["asIs", "minus", "plus"], { error: "金額の向きを選んでください" }),
  taxable: z.string().transform((v) => v === "on"),
  agreedInWriting: z.string().transform((v) => v === "on"),
  basis: z
    .string()
    .trim()
    .max(200, "根拠は 200 文字までにしてください")
    .transform((v) => v || null),
});

/** 調整をまとめて入れる（Excel から貼り付け）。1 行でも読めない行があれば、何も入れない */
export async function bulkAdjustmentAction(_prev: State, form: FormData): Promise<State> {
  let message = "";
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const input = bulkSchema.parse({
      month: text(form, "month"),
      text: text(form, "text"),
      defaultLabel: text(form, "defaultLabel"),
      sign: text(form, "sign") || "asIs",
      taxable: text(form, "taxable"),
      agreedInWriting: text(form, "agreedInWriting"),
      basis: text(form, "basis"),
    });
    const db = await getDb();
    const { rows, skipped } = await bulkAddAdjustments(db, user.tenantId, input.month, input);
    for (const r of rows) {
      await audit(db, {
        tenantId: user.tenantId,
        userId: user.id,
        action: "adjustment.add",
        entity: "adjustment",
        entityId: r.id,
        detail: {
          month: input.month,
          driver: r.driverName,
          driverId: r.driverId,
          label: r.label,
          amount: r.amount,
          taxable: input.taxable,
          agreedInWriting: input.agreedInWriting,
          basis: input.basis,
          source: "paste",
        },
      });
    }
    const total = rows.reduce((a, r) => a + r.amount, 0);
    message = `調整を ${rows.length} 件入れました（合計 ${total.toLocaleString("ja-JP")}円${skipped ? `・0 円と見出しの ${skipped} 行は飛ばしました` : ""}）。${AFTER}`;
    refresh();
  });
  return res.ok ? { ...res, message } : res;
}
