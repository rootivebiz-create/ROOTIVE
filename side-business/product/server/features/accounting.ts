import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { csvText, encodeSjis, utf8WithBom } from "~/server/download";
import { loadMonthDrafts } from "~/server/features/profit";
import { getTenant } from "~/server/repo";
import { statementsStatus } from "~/server/statements-core";
import { deductibleRateForExempt, monthEnd } from "@/lib/payroll/tax";
import {
  ACCOUNT_FIELDS,
  PAYABLE_SUB_KEY,
  SOFTWARE,
  accountFieldsFor,
  accountTotals,
  buildSlips,
  exportFileName,
  journalRecords,
  JournalMismatchError,
  labelProblem,
  paymentRecords,
  ratePercent,
  sortByDriverCode,
  resolveMapping,
  taxFieldsFor,
  taxKeyLabel,
  taxStoreKey,
  type AccountKey,
  type ExportKind,
  type RawAccounting,
  type Slip,
  type SoftwareInfo,
  type SoftwareKey,
} from "~/server/features/accounting/journal";

export * from "~/server/features/accounting/journal";

/**
 * 会計ソフトへの出力（仕訳・支払一覧）と、勘定科目・税区分の対応の保存。
 * - 数字は明細だけから作る（締めた月は明細の写し、開いている月は今の計算。利益の画面と同じ読み方）
 * - 対応は tenants.settings.accounting にだけ書く（ほかの設定には触らない）
 * どの関数も (db, tenantId, …) を受け取り、会社で絞って読む。
 */

export type FieldView = {
  key: string;
  label: string;
  help: string;
  value: string;
  defaultValue: string;
  /** 会社が保存した値か（false なら既定の値＝要確認） */
  saved: boolean;
  rare?: boolean;
};

export type AccountingView = {
  software: SoftwareKey;
  savedSoftware: SoftwareKey | null;
  info: SoftwareInfo;
  month: string;
  closed: boolean;
  source: "snapshot" | "calc";
  snapshotMissing: boolean;
  /** この月の、登録の無い方の経過措置の割合（0.7 など） */
  deductibleRate: number;
  accountFields: FieldView[];
  taxFields: FieldView[];
  payableSubByDriver: boolean;
  /** 一度も保存していない（既定の値のまま） */
  neverSaved: boolean;
  slips: Slip[];
  check: { slips: number; drivers: number; debit: number; credit: number; payableNet: number; transferTotal: number; ok: boolean };
  totals: { account: string; debit: number; credit: number }[];
  /** Shift_JIS にできない文字（弥生会計の形式のとき） */
  unmappable: string[];
  /** 税額の欄を空けて出す人（インボイスの登録が無い方。税込の額で出すソフトのとき） */
  blankTaxDrivers: string[];
  /**
   * まだ締めていない月で、保存した明細（ドライバーに送った明細）と今の計算が違う人。
   * 仕訳は今の計算から作るので、送った明細と合わなくなる（明細を作り直してから出すよう案内する）
   */
  statementGap: string[];
  error: string | null;
};

function rawAccounting(settings: s.TenantSettings | null | undefined): RawAccounting {
  return (settings?.accounting ?? {}) as RawAccounting;
}

/** 会計ソフトへの出力の画面の中身 */
export async function loadAccountingView(db: Db, tenantId: string, month: string, software?: SoftwareKey | null): Promise<AccountingView> {
  const tenant = await getTenant(db, tenantId);
  const raw = rawAccounting(tenant.settings);
  const soft: SoftwareKey = software ?? raw.software ?? "yayoi";
  const info = SOFTWARE[soft];
  const md = await loadMonthDrafts(db, tenantId, month);
  const deductibleRate = md.drafts[0]?.deductibleRate ?? deductibleRateForExempt(monthEnd(month.slice(0, 7)));
  const mapping = resolveMapping(raw, info.format);

  const savedAccounts = raw.accounts ?? {};
  const savedTax = raw.taxLabels ?? {};
  const accountFields: FieldView[] = accountFieldsFor(info.format).map((f) => ({
    key: f.key,
    label: f.label,
    help: f.help,
    value: mapping.accounts[f.key],
    defaultValue: f.default,
    saved: savedAccounts[f.key] !== undefined,
    rare: f.rare,
  }));
  const taxFields: FieldView[] = taxFieldsFor(info.format, deductibleRate).map((f) => ({
    key: f.key,
    label: f.label,
    help: f.help,
    value: mapping.tax(f.key),
    defaultValue: f.default,
    saved: savedTax[taxStoreKey(info.format, f.key)] !== undefined,
  }));

  let slips: Slip[] = [];
  let error: string | null = null;
  try {
    slips = buildSlips(md.drafts, mapping, info.taxMode);
  } catch (e) {
    if (!(e instanceof JournalMismatchError)) throw e;
    error = e.message;
  }
  const debit = slips.reduce((a, x) => a + x.debitTotal, 0);
  const credit = slips.reduce((a, x) => a + x.creditTotal, 0);
  const payableNet = slips.reduce((a, x) => a + x.payableNet, 0);
  const transferTotal = md.drafts.reduce((a, d) => a + d.total, 0);

  let unmappable: string[] = [];
  if (info.encoding === "sjis" && slips.length > 0) {
    // 使っている文字だけを 1 回ずつ確かめる
    const chars = [...new Set(csvText(journalRecords(slips, soft)))].join("");
    unmappable = encodeSjis(chars).unmappable;
  }

  // 送った明細と今の計算が違う人（締めた月は写しから作るので見ない）
  const statementGap: string[] = [];
  if (!md.closed && md.drafts.length > 0) {
    const st = await statementsStatus(db, tenantId, month);
    if (st.saved > 0 && !st.upToDate) {
      const nameOf = new Map(md.drafts.map((d) => [d.driverId, d.driver.name]));
      for (const id of [...st.stale, ...st.missing, ...st.orphan]) statementGap.push(nameOf.get(id) ?? "稼働が無くなった方");
    }
  }

  return {
    software: soft,
    savedSoftware: raw.software ?? null,
    info,
    month,
    closed: md.closed,
    source: md.source,
    snapshotMissing: md.snapshotMissing,
    deductibleRate,
    accountFields,
    taxFields,
    payableSubByDriver: mapping.payableSubByDriver,
    neverSaved: !raw.accounts && !raw.taxLabels,
    slips,
    check: { slips: slips.length, drivers: md.drafts.length, debit, credit, payableNet, transferTotal, ok: !error && debit === credit && payableNet === transferTotal },
    totals: accountTotals(slips),
    unmappable,
    blankTaxDrivers:
      info.taxMode === "inclusive" && ratePercent(deductibleRate) < 100
        ? sortByDriverCode(md.drafts.filter((d) => !d.driver.invoiceRegistered && d.subtotal > 0)).map((d) => d.driver.name)
        : [],
    statementGap,
    error,
  };
}

// ---------------------------------------------------------------- 保存

export type SaveAccountingInput = {
  software: SoftwareKey;
  /** 勘定科目（鍵は ACCOUNT_FIELDS の key。空なら既定に戻す） */
  accounts: Record<string, string>;
  /** 税区分（鍵は taxFieldsFor の key。空の文字もそのまま保存する＝空欄で出す） */
  taxLabels: Record<string, string>;
  payableSubByDriver: boolean;
};

const ACCOUNT_KEY_SET = new Set<string>(ACCOUNT_FIELDS.map((f) => f.key));
const TAX_KEY_RE = /^(purchase|sales|none|invoice|exempt\d{1,3}|invoiceExempt\d{1,3})$/;

/** 勘定科目と税区分の対応を保存する（settings.accounting だけを書き換える。ほかの設定はそのまま） */
export async function saveAccountingSettings(db: Db, tenantId: string, input: SaveAccountingInput, userId?: string | null): Promise<void> {
  if (!SOFTWARE[input.software]) throw new UserError("会計ソフトを選んでください");
  const format = SOFTWARE[input.software].format;
  const problems: string[] = [];

  await db.transaction(async (tx) => {
    const tenant = await getTenant(tx as unknown as Db, tenantId);
    const raw = rawAccounting(tenant.settings);
    const accounts: Record<string, string> = { ...(raw.accounts ?? {}) };
    const taxLabels: Record<string, string> = { ...(raw.taxLabels ?? {}) };

    for (const [key, value] of Object.entries(input.accounts)) {
      if (!ACCOUNT_KEY_SET.has(key)) continue;
      const v = value.trim();
      const problem = labelProblem(v);
      const label = ACCOUNT_FIELDS.find((f) => f.key === key)!.label;
      if (problem) problems.push(`「${label}」：${problem}`);
      // 空は既定の科目に戻す（保存したことにはする）
      accounts[key as AccountKey] = v || ACCOUNT_FIELDS.find((f) => f.key === key)!.default;
    }
    for (const [key, value] of Object.entries(input.taxLabels)) {
      if (!TAX_KEY_RE.test(key)) continue;
      const v = value.trim();
      const problem = labelProblem(v);
      if (problem) problems.push(`税区分「${taxKeyLabel(key)}」：${problem}`);
      taxLabels[taxStoreKey(format, key)] = v;
    }
    accounts[PAYABLE_SUB_KEY] = input.payableSubByDriver ? "driver" : "";
    if (problems.length > 0) throw new UserError(`保存できませんでした。${problems.join("／")}`);

    const next: RawAccounting = { software: input.software, accounts, taxLabels };
    // accounting の鍵だけを入れ替える（振込依頼人などのほかの設定は、そのまま残す）
    await tx
      .update(s.tenants)
      .set({ settings: sql`jsonb_set(coalesce(${s.tenants.settings}, '{}'::jsonb), '{accounting}', ${JSON.stringify(next)}::jsonb, true)` })
      .where(eq(s.tenants.id, tenantId));
  });

  await audit(db, {
    tenantId,
    userId,
    action: "accounting.settings",
    entity: "tenant",
    entityId: tenantId,
    detail: { software: input.software, accounts: Object.keys(input.accounts).length, taxLabels: Object.keys(input.taxLabels).length },
  });
}

// ---------------------------------------------------------------- ファイル

export type AccountingFile = {
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
  rows: number;
  slips: number;
  unmappable: string[];
};

/** 仕訳（ソフトごとの形）か支払一覧のファイルを作る */
export async function buildAccountingFile(db: Db, tenantId: string, month: string, kind: ExportKind): Promise<AccountingFile> {
  const md = await loadMonthDrafts(db, tenantId, month);
  if (md.drafts.length === 0) throw new UserError("この月の明細がまだありません。稼働を取り込んでから出してください");
  const fileName = exportFileName(kind, month);

  if (kind === "payments") {
    const records = paymentRecords(md.drafts);
    return { fileName, bytes: utf8WithBom(csvText(records)), contentType: "text/csv; charset=utf-8", rows: records.length - 1, slips: 0, unmappable: [] };
  }

  const tenant = await getTenant(db, tenantId);
  const info = SOFTWARE[kind];
  const mapping = resolveMapping(rawAccounting(tenant.settings), info.format);
  let slips: Slip[];
  try {
    slips = buildSlips(md.drafts, mapping, info.taxMode);
  } catch (e) {
    if (e instanceof JournalMismatchError) throw new UserError(`${e.message}。明細を作り直してから、もう一度お試しください`);
    throw e;
  }
  const records = journalRecords(slips, kind);
  const text = csvText(records);
  const dataRows = info.format === "yayoi" ? records.length : records.length - 1;
  if (info.encoding === "sjis") {
    const { bytes, unmappable } = encodeSjis(text);
    return { fileName, bytes, contentType: "text/csv; charset=Shift_JIS", rows: dataRows, slips: slips.length, unmappable };
  }
  return { fileName, bytes: utf8WithBom(text), contentType: "text/csv; charset=utf-8", rows: dataRows, slips: slips.length, unmappable: [] };
}
