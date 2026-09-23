import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { getTenant } from "~/server/repo";
import { changes } from "./common";
import { isStandardNote } from "./format";
import type { CompanyInput } from "./schemas";

/**
 * 会社の設定（オーナーだけが変える）。tenants の列と settings（jsonb）の両方を書く。
 * settings の中の、この画面で扱わないもの（AI の同意・会計ソフト・デモの印など）はそのまま残す。
 */

export type CompanyView = Awaited<ReturnType<typeof getTenant>>;

export async function loadCompany(db: Db, tenantId: string): Promise<CompanyView> {
  return getTenant(db, tenantId);
}

/**
 * 明細の注記：空か、日数だけ違う決まった文なら保存しない（明細の計算が「確認とみなすまでの日数」から決まった文を作る。
 * こうすると、日数を変えたときに注記の日数もいっしょに変わる）。独自の文だけを保存する。
 */
export function resolveStatementNote(note: string | null): string | undefined {
  const t = (note ?? "").trim();
  if (!t || isStandardNote(t)) return undefined;
  return t;
}

const COLUMN_KEYS = ["name", "registrationNo", "taxMethod", "payTaxToExempt", "taxRounding", "amountRounding", "closingDay", "payMonthOffset", "payDay"] as const;
const SETTING_KEYS = ["paymentTermsText", "transferFeeBearer", "capitalYen", "employees", "deemedConfirmDays", "statementNote", "requester"] as const;

export async function updateCompany(db: Db, tenantId: string, input: CompanyInput) {
  const before = await getTenant(db, tenantId);
  const settings: s.TenantSettings = { ...(before.settings ?? {}) };
  const put = <K extends keyof s.TenantSettings>(key: K, value: s.TenantSettings[K] | null | undefined) => {
    if (value === null || value === undefined || value === "") delete settings[key];
    else settings[key] = value;
  };
  put("paymentTermsText", input.paymentTermsText);
  put("transferFeeBearer", input.transferFeeBearer);
  put("capitalYen", input.capitalYen);
  put("employees", input.employees);
  put("deemedConfirmDays", input.deemedConfirmDays);
  put("statementNote", resolveStatementNote(input.statementNote));
  put(
    "requester",
    input.requesterCode
      ? {
          code: input.requesterCode,
          nameKana: input.requesterName ?? "",
          bankCode: input.requesterBankCode,
          bankNameKana: input.requesterBankName ?? "",
          branchCode: input.requesterBranchCode,
          branchNameKana: input.requesterBranchName ?? "",
          accountType: input.requesterAccountType,
          accountNumber: input.requesterAccountNumber.padStart(7, "0"),
        }
      : null,
  );

  const columns = {
    name: input.name,
    registrationNo: input.registrationNo,
    taxMethod: input.taxMethod,
    payTaxToExempt: input.payTaxToExempt,
    taxRounding: input.taxRounding,
    amountRounding: input.amountRounding,
    closingDay: input.closingDay,
    payMonthOffset: input.payMonthOffset,
    payDay: input.payDay,
  };
  const [after] = await db
    .update(s.tenants)
    .set({ ...columns, settings })
    .where(eq(s.tenants.id, tenantId))
    .returning();
  if (!after) throw new Error("会社が見つかりません");
  const changed = {
    ...changes(before, columns, COLUMN_KEYS),
    ...changes((before.settings ?? {}) as Record<string, unknown>, settings as Record<string, unknown>, SETTING_KEYS),
  };
  // 消した項目（settings から外したもの）も記録に残す
  for (const key of SETTING_KEYS) {
    if (key in (before.settings ?? {}) && !(key in settings)) changed[key] = { from: (before.settings as Record<string, unknown>)[key], to: null };
  }
  return { before, after, changed };
}

/** AI の読み取りを使ってよいか（お客様の同意）。変えたら前後を返す */
export async function setAiConsent(db: Db, tenantId: string, on: boolean): Promise<{ before: boolean; after: boolean }> {
  const t = await getTenant(db, tenantId);
  const before = t.settings?.aiAssistConsent === true;
  const settings: s.TenantSettings = { ...(t.settings ?? {}), aiAssistConsent: on };
  await db.update(s.tenants).set({ settings }).where(eq(s.tenants.id, tenantId));
  return { before, after: on };
}

export type ConsentEvent = { at: Date; on: boolean; by: string | null };

/** AI の同意を変えた記録（新しい順・最大 20 件）。操作の記録（audit_log）から読む */
export async function aiConsentHistory(db: Db, tenantId: string): Promise<ConsentEvent[]> {
  const rows = await db
    .select({ at: s.auditLog.createdAt, detail: s.auditLog.detail, by: s.users.name })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, AI_CONSENT_ACTION)))
    .orderBy(desc(s.auditLog.id))
    .limit(20);
  return rows.map((r) => ({ at: r.at, on: (r.detail as { on?: unknown })?.on === true, by: r.by ?? null }));
}

/** 操作の記録に残す名前（同意の記録を読み出すときにも使う） */
export const AI_CONSENT_ACTION = "settings.ai_consent";
