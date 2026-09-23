import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { getTenant } from "~/server/repo";
import { isBlankRow, readTable, TableReadError } from "~/server/tabular";
import type { CompanyBasics } from "~/server/features/onboarding/company";
import {
  draftFromCells,
  findDuplicate,
  parseDriverRows,
  rowsFromPaste,
  type DriverDraft,
  type DriverPreview,
} from "~/server/features/onboarding/drivers-parse";
import { normalizeName } from "~/server/names";
import { parseProjectRows, type ProjectDraft, type ProjectPreview, type ProjectRowInput } from "~/server/features/onboarding/projects-parse";
import { checkRule, type RuleDraft, type RuleInput } from "~/server/features/onboarding/rules";
import {
  finishRecord,
  onboardingProgress,
  reopenRecord,
  withMark,
  type OnboardingKey,
  type OnboardingProgress,
  type StepMark,
} from "~/server/features/onboarding/steps";

export * from "~/server/features/onboarding/steps";

/**
 * 最初の設定の案内：どこまで済んだか（tenants.onboarding）と、会社の基本・ドライバー・元請と案件・控除のルールの登録。
 * どの関数も (db, tenantId, …) を受け取り、会社で絞る。書いたら操作の記録（audit）に残す。
 */

// ---------------------------------------------------------------- 進み具合

export async function loadOnboarding(db: Db, tenantId: string): Promise<OnboardingProgress> {
  const tenant = await getTenant(db, tenantId);
  const [[drivers], [projects], [rules], [work], [parallel]] = await Promise.all([
    db.select({ n: count() }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db.select({ n: count() }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ n: count() }).from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
    db.select({ n: count() }).from(s.workEntries).where(eq(s.workEntries.tenantId, tenantId)),
    db.select({ n: count() }).from(s.parallelChecks).where(eq(s.parallelChecks.tenantId, tenantId)),
  ]);
  return onboardingProgress(tenant.onboarding, {
    drivers: drivers?.n ?? 0,
    projects: projects?.n ?? 0,
    rules: rules?.n ?? 0,
    workEntries: work?.n ?? 0,
    parallelChecks: parallel?.n ?? 0,
  });
}

/** 手順の印を付ける（done・skipped）。null で印を外す（まだに戻す） */
export async function setOnboardingStep(db: Db, tenantId: string, key: OnboardingKey, mark: StepMark | null, userId?: string | null): Promise<void> {
  const tenant = await getTenant(db, tenantId);
  const next = withMark(tenant.onboarding, key, mark);
  // 印を外したら「案内を終えた」印も外す（ホームの案内がまた出るように）
  if (mark === null) delete next.finished;
  await db.update(s.tenants).set({ onboarding: next }).where(eq(s.tenants.id, tenantId));
  await audit(db, { tenantId, userId, action: "onboarding.step", entity: "tenant", entityId: tenantId, detail: { step: key, mark } });
}

/** 「案内を終える」：まだの手順をとばした扱いにする（あとで案内からいつでも戻れる） */
export async function finishOnboarding(db: Db, tenantId: string, userId?: string | null): Promise<void> {
  const tenant = await getTenant(db, tenantId);
  await db.update(s.tenants).set({ onboarding: finishRecord(tenant.onboarding) }).where(eq(s.tenants.id, tenantId));
  await audit(db, { tenantId, userId, action: "onboarding.finish", entity: "tenant", entityId: tenantId });
}

/** 案内をもう一度出す（終えた印と「あとで」を外す。済んだ手順はそのまま） */
export async function reopenOnboarding(db: Db, tenantId: string, userId?: string | null): Promise<void> {
  const tenant = await getTenant(db, tenantId);
  await db.update(s.tenants).set({ onboarding: reopenRecord(tenant.onboarding) }).where(eq(s.tenants.id, tenantId));
  await audit(db, { tenantId, userId, action: "onboarding.reopen", entity: "tenant", entityId: tenantId });
}

// ---------------------------------------------------------------- ① 会社の基本

export type CompanyForm = {
  name: string;
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  transferFeeBearer: "company" | "driver" | null;
  registrationNo: string | null;
  taxMethod: string;
  paymentTermsText: string | null;
  owners: string[];
};

export async function loadCompanyForm(db: Db, tenantId: string): Promise<CompanyForm> {
  const t = await getTenant(db, tenantId);
  const owners = await db
    .select({ name: s.users.name })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  return {
    name: t.name,
    closingDay: t.closingDay,
    payMonthOffset: t.payMonthOffset,
    payDay: t.payDay,
    transferFeeBearer: t.settings?.transferFeeBearer ?? null,
    registrationNo: t.registrationNo,
    taxMethod: t.taxMethod,
    paymentTermsText: t.settings?.paymentTermsText ?? null,
    owners: owners.map((o) => o.name),
  };
}

/** 会社の基本を保存する（オーナーだけが呼ぶ。役割は Server Action で確かめる）。設定のほかの項目は変えない */
export async function saveCompanyBasics(db: Db, tenantId: string, input: CompanyBasics, userId?: string | null): Promise<void> {
  const t = await getTenant(db, tenantId);
  const settings: s.TenantSettings = { ...(t.settings ?? {}), transferFeeBearer: input.transferFeeBearer };
  if (input.paymentTermsText) settings.paymentTermsText = input.paymentTermsText;
  else delete settings.paymentTermsText;
  const before = {
    closingDay: t.closingDay,
    payMonthOffset: t.payMonthOffset,
    payDay: t.payDay,
    registrationNo: t.registrationNo,
    taxMethod: t.taxMethod,
    transferFeeBearer: t.settings?.transferFeeBearer ?? null,
    paymentTermsText: t.settings?.paymentTermsText ?? null,
  };
  await db
    .update(s.tenants)
    .set({
      closingDay: input.closingDay,
      payMonthOffset: input.payMonthOffset,
      payDay: input.payDay,
      registrationNo: input.registrationNo,
      taxMethod: input.taxMethod,
      settings,
      onboarding: withMark(t.onboarding, "company", "done"),
    })
    .where(eq(s.tenants.id, tenantId));
  await audit(db, { tenantId, userId, action: "onboarding.company", entity: "tenant", entityId: tenantId, detail: { before, after: input } });
}

// ---------------------------------------------------------------- ② ドライバー

export const MAX_DRIVER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DRIVER_ROWS = 500;

async function existingDrivers(db: Db, tenantId: string) {
  return db
    .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code, aliases: s.drivers.aliases })
    .from(s.drivers)
    .where(eq(s.drivers.tenantId, tenantId));
}

/** 空でない行の数（Excel は書式だけの空の行を何千行も持つことがあるので、空の行は数えない） */
function filledRows(rows: string[][]): number {
  return rows.filter((r) => !isBlankRow(r)).length;
}

function assertRowLimit(rows: string[][]): void {
  if (filledRows(rows) > MAX_DRIVER_ROWS + 10) throw new UserError(`一度に読み込めるのは ${MAX_DRIVER_ROWS}人までです。分けて読み込んでください`);
}

/** 表（貼り付け・ファイル）から、登録の前の確かめを作る */
export async function previewDriverRows(db: Db, tenantId: string, rows: string[][]): Promise<DriverPreview> {
  assertRowLimit(rows);
  return parseDriverRows(rows, await existingDrivers(db, tenantId));
}

export async function previewDriverPaste(db: Db, tenantId: string, text: string): Promise<DriverPreview> {
  if (!text.trim()) throw new UserError("Excel の名簿をコピーして、ここに貼り付けてください");
  return previewDriverRows(db, tenantId, rowsFromPaste(text));
}

/** ファイル（CSV・Excel）から。シートが何枚かあれば、氏名の列がある最初のシートを使う */
export async function previewDriverFile(db: Db, tenantId: string, fileName: string, bytes: Uint8Array): Promise<DriverPreview & { sheetName: string }> {
  if (bytes.byteLength > MAX_DRIVER_FILE_BYTES) throw new UserError("ファイルが大きすぎます（5MB まで）");
  let sheets;
  try {
    ({ sheets } = await readTable(fileName, bytes));
  } catch (error) {
    if (error instanceof TableReadError) throw new UserError(error.message);
    throw error;
  }
  const existing = await existingDrivers(db, tenantId);
  let first: (DriverPreview & { sheetName: string }) | null = null;
  for (const sheet of sheets) {
    assertRowLimit(sheet.rows);
    const p = { ...parseDriverRows(sheet.rows, existing), sheetName: sheet.name };
    if (!p.problem) return p;
    first ??= p;
  }
  return first ?? { headerRow: null, columns: [], rows: [], counts: { new: 0, duplicate: 0, error: 0 }, problem: "読み込める表がありませんでした", sheetName: "" };
}

/** 画面から来た値を文字として読む（文字でなければ空） */
function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

export type CreateDriversResult = { created: number; skipped: string[]; rejected: string[] };

/**
 * まとめて登録する。画面から来た中身を信じず、1 人ずつもう一度確かめる（形・重なり）。
 * すでにいる人（名前・番号が同じ）は登録しない。
 */
export async function createDrivers(db: Db, tenantId: string, drafts: unknown[], userId?: string | null): Promise<CreateDriversResult> {
  if (drafts.length === 0) throw new UserError("登録する人がいません。読み込み直してください");
  if (drafts.length > MAX_DRIVER_ROWS) throw new UserError(`一度に登録できるのは ${MAX_DRIVER_ROWS}人までです`);
  await getTenant(db, tenantId);
  const known = await existingDrivers(db, tenantId);
  const rows: (typeof s.drivers.$inferInsert)[] = [];
  const skipped: string[] = [];
  const rejected: string[] = [];
  for (const raw of drafts) {
    const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DriverDraft>;
    // 画面から来た値を、名簿の 1 行として確かめ直す（同じ部品を通す）
    const b = (d.bank && typeof d.bank === "object" ? d.bank : {}) as Partial<Record<string, unknown>>;
    const { draft, errors } = draftFromCells({
      name: str(d.name),
      kana: str(d.kana),
      code: str(d.code),
      registrationNo: str(d.registrationNo),
      bankCode: str(b.bankCode),
      bankName: str(b.bankNameKana),
      branchCode: str(b.branchCode),
      branchName: str(b.branchNameKana),
      accountType: b.accountType === "checking" ? "当座" : "普通",
      accountNumber: str(b.accountNumber),
      holderKana: str(b.holderKana),
      email: str(d.email),
      phone: str(d.phone),
      startedOn: str(d.startedOn),
    });
    if (!draft) {
      rejected.push(`${str(d.name) || "（名前なし）"}：${errors.join("・")}`);
      continue;
    }
    // 口座は、確かめ直して形が正しいときだけ入れる
    const bank = draft.bank;
    if (findDuplicate(draft, known)) {
      skipped.push(draft.name);
      continue;
    }
    known.push({ id: `new:${rows.length}`, name: draft.name, code: draft.code, aliases: [] });
    rows.push({
      tenantId,
      name: draft.name,
      kana: draft.kana,
      code: draft.code,
      invoiceRegistered: draft.invoiceRegistered,
      registrationNo: draft.registrationNo,
      email: draft.email,
      phone: draft.phone,
      startedOn: draft.startedOn,
      bankCode: bank?.bankCode ?? null,
      bankNameKana: bank?.bankNameKana ?? null,
      branchCode: bank?.branchCode ?? null,
      branchNameKana: bank?.branchNameKana ?? null,
      accountType: bank?.accountType ?? "ordinary",
      accountNumber: bank?.accountNumber ?? null,
      holderKana: bank?.holderKana ?? null,
    });
  }
  let created: { id: string; name: string }[] = [];
  if (rows.length) {
    created = await db.insert(s.drivers).values(rows).returning({ id: s.drivers.id, name: s.drivers.name });
    const t = await getTenant(db, tenantId);
    await db.update(s.tenants).set({ onboarding: withMark(t.onboarding, "drivers", "done") }).where(eq(s.tenants.id, tenantId));
  }
  await audit(db, {
    tenantId,
    userId,
    action: "driver.bulk_create",
    entity: "driver",
    detail: { created: created.length, names: created.map((c) => c.name), skipped, rejected },
  });
  return { created: created.length, skipped, rejected };
}

// ---------------------------------------------------------------- ③ 元請と案件

async function existingClientsAndProjects(db: Db, tenantId: string) {
  const [clients, projects] = await Promise.all([
    db.select({ id: s.clients.id, name: s.clients.name, aliases: s.clients.aliases }).from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db
      .select({ id: s.projects.id, name: s.projects.name, clientId: s.projects.clientId, aliases: s.projects.aliases })
      .from(s.projects)
      .where(eq(s.projects.tenantId, tenantId)),
  ]);
  return { clients, projects };
}

export async function previewProjects(db: Db, tenantId: string, rows: ProjectRowInput[]): Promise<ProjectPreview> {
  if (rows.length > 300) throw new UserError("一度に入れられるのは 300 行までです");
  const { clients, projects } = await existingClientsAndProjects(db, tenantId);
  return parseProjectRows(rows, clients, projects);
}

export type CreateProjectsResult = { clients: number; projects: number; skipped: number; rejected: string[] };

/** 元請と案件をまとめて登録する（画面の行をもう一度確かめる。元請は名前で当ててから、無ければ作る） */
export async function createProjects(db: Db, tenantId: string, rows: ProjectRowInput[], userId?: string | null): Promise<CreateProjectsResult> {
  const preview = await previewProjects(db, tenantId, rows);
  const toCreate = preview.rows.filter((r) => r.status === "new" && r.draft).map((r) => r.draft as ProjectDraft);
  const rejected = preview.rows.filter((r) => r.status === "error").map((r) => `${r.rowNo}行目：${r.errors.join("・")}`);
  if (toCreate.length === 0) {
    if (rejected.length) throw new UserError(`登録できる行がありません。${rejected[0]}`);
    throw new UserError(preview.counts.duplicate ? "どれもすでに登録されています" : "案件を 1 行以上入れてください");
  }
  const result = await db.transaction(async (tx) => {
    // 新しい元請を作る（同じ名前は 1 つだけ）
    const clientIdByKey = new Map<string, string>();
    const newNames = [...new Set(toCreate.filter((d) => !d.clientId && d.clientName).map((d) => d.clientName!))];
    const uniqueNew = new Map<string, string>();
    for (const n of newNames) if (!uniqueNew.has(normalizeName(n))) uniqueNew.set(normalizeName(n), n);
    if (uniqueNew.size) {
      const inserted = await tx
        .insert(s.clients)
        .values([...uniqueNew.values()].map((name) => ({ tenantId, name })))
        .returning({ id: s.clients.id, name: s.clients.name });
      for (const c of inserted) clientIdByKey.set(normalizeName(c.name), c.id);
    }
    // すでにある元請の id は、この会社のものかを確かめてから使う
    const knownIds = [...new Set(toCreate.map((d) => d.clientId).filter((v): v is string => !!v))];
    if (knownIds.length) {
      const own = await tx
        .select({ id: s.clients.id })
        .from(s.clients)
        .where(and(eq(s.clients.tenantId, tenantId), inArray(s.clients.id, knownIds)));
      if (own.length !== knownIds.length) throw new UserError("元請が見つかりません。画面を読み直してください");
    }
    const values = toCreate.map((d) => ({
      tenantId,
      clientId: d.clientId ?? (d.clientName ? clientIdByKey.get(normalizeName(d.clientName)) ?? null : null),
      name: d.name,
      unit: d.unit,
      billRate: d.billRate,
      payRate: d.payRate,
    }));
    await tx.insert(s.projects).values(values);
    const [t] = await tx.select({ onboarding: s.tenants.onboarding }).from(s.tenants).where(eq(s.tenants.id, tenantId));
    await tx.update(s.tenants).set({ onboarding: withMark(t?.onboarding, "projects", "done") }).where(eq(s.tenants.id, tenantId));
    return { clients: uniqueNew.size, projects: values.length };
  });
  await audit(db, {
    tenantId,
    userId,
    action: "project.bulk_create",
    entity: "project",
    detail: { ...result, names: toCreate.map((d) => `${d.clientName ?? "（元請なし）"}／${d.name}`), rejected },
  });
  return { ...result, skipped: preview.counts.duplicate, rejected };
}

// ---------------------------------------------------------------- ④ 控除のルール

export type CreateRulesResult = { created: number; skipped: string[]; notAgreed: string[] };

/** 控除のルール（全員に当てるもの）をまとめて登録する。同じ名前の全員向けのルールがあれば登録しない */
export async function createRules(db: Db, tenantId: string, inputs: RuleInput[], userId?: string | null): Promise<CreateRulesResult> {
  if (inputs.length === 0) throw new UserError("使う控除に印を付けてください");
  if (inputs.length > 30) throw new UserError("一度に登録できるのは 30 件までです");
  const drafts: RuleDraft[] = [];
  for (const input of inputs) {
    const { draft, errors } = checkRule(input);
    if (!draft) throw new UserError(errors[0]);
    drafts.push(draft);
  }
  const existing = await db
    .select({ name: s.deductionRules.name, driverId: s.deductionRules.driverId, sort: s.deductionRules.sort })
    .from(s.deductionRules)
    .where(eq(s.deductionRules.tenantId, tenantId));
  const taken = new Set(existing.filter((r) => r.driverId === null).map((r) => normalizeName(r.name)));
  let sort = existing.reduce((m, r) => Math.max(m, r.sort), 0);
  const skipped: string[] = [];
  const values: (typeof s.deductionRules.$inferInsert)[] = [];
  for (const d of drafts) {
    const key = normalizeName(d.name);
    if (taken.has(key)) {
      skipped.push(d.name);
      continue;
    }
    taken.add(key);
    values.push({
      tenantId,
      driverId: null,
      name: d.name,
      kind: d.kind,
      rate: d.rate,
      amount: d.amount,
      taxable: d.taxable,
      onlyWhenWorked: d.onlyWhenWorked,
      agreedInWriting: d.agreedInWriting,
      agreedOn: d.agreedOn,
      basis: d.basis,
      sort: ++sort,
    });
  }
  if (values.length) {
    await db.insert(s.deductionRules).values(values);
    const t = await getTenant(db, tenantId);
    await db.update(s.tenants).set({ onboarding: withMark(t.onboarding, "rules", "done") }).where(eq(s.tenants.id, tenantId));
  }
  const notAgreed = values.filter((v) => !v.agreedInWriting).map((v) => v.name);
  await audit(db, { tenantId, userId, action: "rule.bulk_create", entity: "deduction_rule", detail: { created: values.map((v) => v.name), skipped, notAgreed } });
  return { created: values.length, skipped, notAgreed };
}

/** 登録済みの控除（画面に出す。全員向けと、人ごとの数） */
export async function listRuleNames(db: Db, tenantId: string): Promise<{ name: string; kind: string; rate: number | null; amount: number | null; forAll: boolean; agreedInWriting: boolean }[]> {
  const rows = await db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId));
  return rows
    .filter((r) => r.active)
    .sort((a, b) => a.sort - b.sort)
    .map((r) => ({ name: r.name, kind: r.kind, rate: r.rate, amount: r.amount, forAll: r.driverId === null, agreedInWriting: r.agreedInWriting }));
}

/** 完了の画面に出す数 */
export async function onboardingCounts(db: Db, tenantId: string): Promise<{ drivers: number; withBank: number; registered: number; clients: number; projects: number; rules: number }> {
  const [drivers, [clients], [projects], [rules]] = await Promise.all([
    db
      .select({ accountNumber: s.drivers.accountNumber, invoiceRegistered: s.drivers.invoiceRegistered })
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.active, true))),
    db.select({ n: count() }).from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select({ n: count() }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ n: count() }).from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
  ]);
  return {
    drivers: drivers.length,
    withBank: drivers.filter((d) => d.accountNumber).length,
    registered: drivers.filter((d) => d.invoiceRegistered).length,
    clients: clients?.n ?? 0,
    projects: projects?.n ?? 0,
    rules: rules?.n ?? 0,
  };
}
