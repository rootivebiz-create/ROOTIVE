"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "~/db/client";
import { runAction, UserError, type ActionResult } from "~/server/action";
import { requireUser } from "~/server/auth";
import {
  createDrivers,
  createProjects,
  createRules,
  finishOnboarding,
  isOnboardingKey,
  MAX_DRIVER_FILE_BYTES,
  previewDriverFile,
  previewDriverPaste,
  previewProjects,
  reopenOnboarding,
  saveCompanyBasics,
  setOnboardingStep,
  type CreateDriversResult,
  type CreateProjectsResult,
  type CreateRulesResult,
} from "~/server/features/onboarding";
import { checkCompanyBasics } from "~/server/features/onboarding/company";
import type { DriverPreview } from "~/server/features/onboarding/drivers-parse";
import type { ProjectPreview } from "~/server/features/onboarding/projects-parse";

/**
 * 最初の設定の案内の Server Action（薄い包み。中身は server/features/onboarding.ts）。
 * どれも：役割の確認 → 入力の確かめ → 処理（会社で絞る・記録を残す）→ 画面の読み直し。
 */

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  // 案内の進み具合はホームにも出る。ドライバー・案件・控除は、明細・見張り番にも効く
  revalidatePath("/", "layout");
}

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserError(`${what}を読めませんでした。画面を読み直して、もう一度お試しください`);
  }
}

// ---------------------------------------------------------------- 進み具合

export type MarkState = ActionResult | undefined;

/** 手順を「済み」「あとで（とばす）」「まだ」にする */
export async function markStepAction(_prev: MarkState, form: FormData): Promise<MarkState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const key = text(form, "step");
    if (!isOnboardingKey(key)) throw new UserError("手順が見つかりません。画面を読み直してください");
    const mark = text(form, "mark");
    if (mark !== "done" && mark !== "skipped" && mark !== "todo") throw new UserError("操作が正しくありません");
    const db = await getDb();
    await setOnboardingStep(db, user.tenantId, key, mark === "todo" ? null : mark, user.id);
    refresh();
    return undefined;
  }, text(form, "mark") === "skipped" ? "あとでやることにしました。案内からいつでも戻れます。" : "記録しました。");
}

/** 案内を終える（残りはあとで）→ 完了の画面へ */
export async function finishOnboardingAction(_prev: MarkState, _form: FormData): Promise<MarkState> {
  const res = await runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    await finishOnboarding(db, user.tenantId, user.id);
    refresh();
    return undefined;
  });
  if (res.ok) redirect("/onboarding/done");
  return res;
}

/** 案内をもう一度ホームに出す */
export async function reopenOnboardingAction(_prev: MarkState, _form: FormData): Promise<MarkState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    await reopenOnboarding(db, user.tenantId, user.id);
    refresh();
    return undefined;
  }, "ホームに、最初の設定の案内をまた出します。");
}

// ---------------------------------------------------------------- ① 会社の基本（オーナーだけ）

export type CompanyState = ActionResult | undefined;

/** 入力の確かめ（誤りは項目ごとに画面へ返す） */
const companySchema = z
  .object({
    closingDay: z.string(),
    payMonthOffset: z.string(),
    payDay: z.string(),
    transferFeeBearer: z.string(),
    registrationNo: z.string(),
    taxMethod: z.string(),
    paymentTermsText: z.string(),
  })
  .transform((input, ctx) => {
    const { value, fieldErrors } = checkCompanyBasics(input);
    for (const [key, message] of Object.entries(fieldErrors)) ctx.addIssue({ code: "custom", path: [key], message });
    return value ?? z.NEVER;
  });

export async function saveCompanyAction(_prev: CompanyState, form: FormData): Promise<CompanyState> {
  return runAction(async () => {
    const user = await requireUser("owner");
    const input = companySchema.parse({
      closingDay: text(form, "closingDay"),
      payMonthOffset: text(form, "payMonthOffset"),
      payDay: text(form, "payDay"),
      transferFeeBearer: text(form, "transferFeeBearer"),
      registrationNo: text(form, "registrationNo"),
      taxMethod: text(form, "taxMethod"),
      paymentTermsText: text(form, "paymentTermsText"),
    });
    const db = await getDb();
    await saveCompanyBasics(db, user.tenantId, input, user.id);
    refresh();
    return undefined;
  }, "会社の基本を保存しました。次は「ドライバー」です。");
}

// ---------------------------------------------------------------- ② ドライバー

export type DriverPreviewState = ActionResult<DriverPreview & { sheetName?: string; source: string }> | undefined;

/** 貼り付け・ファイルを読んで、登録の前の確かめを返す（まだ登録しない） */
export async function previewDriversAction(_prev: DriverPreviewState, form: FormData): Promise<DriverPreviewState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const db = await getDb();
    const file = form.get("file");
    if (file instanceof File && file.name && file.size > 0) {
      if (file.size > MAX_DRIVER_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）");
      const p = await previewDriverFile(db, user.tenantId, file.name, new Uint8Array(await file.arrayBuffer()));
      return { ...p, source: file.name };
    }
    const p = await previewDriverPaste(db, user.tenantId, text(form, "paste"));
    return { ...p, source: "貼り付け" };
  });
}

export type CreateDriversState = ActionResult<CreateDriversResult> | undefined;

export async function createDriversAction(_prev: CreateDriversState, form: FormData): Promise<CreateDriversState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const drafts = parseJson(text(form, "drafts"), "登録する人");
    if (!Array.isArray(drafts)) throw new UserError("登録する人を読めませんでした。読み込み直してください");
    const db = await getDb();
    const result = await createDrivers(db, user.tenantId, drafts, user.id);
    refresh();
    return result;
  }, "登録しました。");
}

// ---------------------------------------------------------------- ③ 元請と案件

const projectRowsSchema = z
  .array(
    z.object({
      client: z.string().max(200),
      project: z.string().max(200),
      unit: z.string().max(50),
      billRate: z.string().max(50),
      payRate: z.string().max(50),
    }),
  )
  .max(300, "一度に入れられるのは 300 行までです");

export type ProjectPreviewState = ActionResult<ProjectPreview> | undefined;

export async function previewProjectsAction(_prev: ProjectPreviewState, form: FormData): Promise<ProjectPreviewState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const rows = projectRowsSchema.parse(parseJson(text(form, "rows"), "案件の表"));
    const db = await getDb();
    return previewProjects(db, user.tenantId, rows);
  });
}

export type CreateProjectsState = ActionResult<CreateProjectsResult> | undefined;

export async function createProjectsAction(_prev: CreateProjectsState, form: FormData): Promise<CreateProjectsState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const rows = projectRowsSchema.parse(parseJson(text(form, "rows"), "案件の表"));
    const db = await getDb();
    const result = await createProjects(db, user.tenantId, rows, user.id);
    refresh();
    return result;
  }, "登録しました。");
}

// ---------------------------------------------------------------- ④ 控除のルール

const rulesSchema = z
  .array(
    z.object({
      name: z.string().max(100),
      kind: z.string().max(20),
      value: z.string().max(30),
      taxable: z.boolean(),
      onlyWhenWorked: z.boolean(),
      agreedInWriting: z.boolean(),
      agreedOn: z.string().max(20),
      basis: z.string().max(400),
    }),
  )
  .max(30, "一度に登録できるのは 30 件までです");

export type CreateRulesState = ActionResult<CreateRulesResult> | undefined;

export async function createRulesAction(_prev: CreateRulesState, form: FormData): Promise<CreateRulesState> {
  return runAction(async () => {
    const user = await requireUser("staff");
    const rules = rulesSchema.parse(parseJson(text(form, "rules"), "控除"));
    const db = await getDb();
    const result = await createRules(db, user.tenantId, rules, user.id);
    refresh();
    return result;
  }, "登録しました。");
}
