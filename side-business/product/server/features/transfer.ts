import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { payDateFor } from "~/server/calc/statement";
import { monthLabelJa } from "~/server/month";
import { getTenant, isMonthClosed } from "~/server/repo";
import { readSnapshot, statementsStatus } from "~/server/statements-core";
import { csvText } from "~/server/download";
import type { AccountType } from "@/lib/payroll/types";
import { buildZenginRecords, toZenginKana, validateTransfers, zenginBytes, type Requester, type Transfer } from "@/lib/payroll/zengin";
import { adjustForBankHoliday, isBankHoliday, isDateString, shortDate } from "@/lib/tools/torihiki-joken";

/**
 * 振込データ（全銀の総合振込）を作る・記録する。
 * - 金額は保存済みの明細の振込額（statements.total）だけを使う。ここで計算し直さない
 * - 振込手数料は差し引かない（明細の振込額のまま）
 * - 同じ人に二重に振り込まないよう、前に作った振込データに入っている人を見分ける
 */

// ---------------------------------------------------------------- 形

export type BankFields = {
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: AccountType;
  accountNumber: string;
  holderKana: string;
};

export type TransferRow = {
  statementId: string;
  driverId: string;
  driverName: string;
  driverCode: string | null;
  /** 明細の振込額 */
  amount: number;
  version: number;
  bank: BankFields;
  /** 振込データに入る口座名義（半角カナ） */
  holderHalf: string;
  /** この月の振込データのうち、この人が入っているもの */
  inBatches: { id: string; fileName: string; executedOn: string | null }[];
};

export type ExcludeReason = "no_bank" | "bank_invalid" | "not_positive";

export type ExcludedRow = {
  statementId: string;
  driverId: string;
  driverName: string;
  driverCode: string | null;
  amount: number;
  reason: ExcludeReason;
  message: string;
  /** 口座の直すところ（bank_invalid のとき） */
  issues: string[];
};

export type BatchView = {
  id: string;
  month: string;
  transferDate: string;
  executedOn: string | null;
  count: number;
  total: number;
  fileName: string;
  createdAt: Date;
  createdByName: string | null;
  /** 作ったあとに明細が変わったか（変わっていたらダウンロードさせない） */
  changed: boolean;
  currentCount: number;
  currentTotal: number;
};

export type TransferPlan = {
  month: string;
  closed: boolean;
  /** 保存済みの明細の数 */
  savedStatements: number;
  /** 明細が振込データに使える状態か（未保存・作り直しが必要なら false） */
  ready: boolean;
  /** 使えないときの理由（画面にそのまま出す） */
  blockReason: string | null;
  /** 作り直しが必要な人数（未作成・変更・不要の合計。開いている月だけ） */
  staleCount: number;
  /** 明細に書いた支払日（約束した日） */
  promisedPayDate: string;
  /** 振込指定日の初期値（約束の日が銀行の休みなら前の営業日） */
  defaultTransferDate: string;
  requester: Requester | null;
  requesterProblems: string[];
  feeBearerDriver: boolean;
  included: TransferRow[];
  excluded: ExcludedRow[];
  /** 振込データに入る人の振込額の合計 */
  total: number;
  batches: BatchView[];
};

// ---------------------------------------------------------------- 小さな部品

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function bankOf(d: typeof s.drivers.$inferSelect): BankFields {
  return {
    bankCode: (d.bankCode ?? "").trim(),
    bankNameKana: (d.bankNameKana ?? "").trim(),
    branchCode: (d.branchCode ?? "").trim(),
    branchNameKana: (d.branchNameKana ?? "").trim(),
    accountType: d.accountType === "checking" ? "checking" : "ordinary",
    accountNumber: (d.accountNumber ?? "").trim(),
    holderKana: (d.holderKana ?? "").trim(),
  };
}

function hasNoBank(b: BankFields): boolean {
  return !b.bankCode && !b.branchCode && !b.accountNumber && !b.holderKana;
}

function toTransfer(b: BankFields, amount: number, customerCode?: string | null): Transfer {
  return {
    bankCode: b.bankCode,
    bankNameKana: b.bankNameKana,
    branchCode: b.branchCode,
    branchNameKana: b.branchNameKana,
    accountType: b.accountType,
    accountNumber: b.accountNumber,
    holderKana: b.holderKana,
    amount,
    // 顧客コード：ドライバーの番号（使えない文字は全銀の部品が落とす）
    customerCode: customerCode ?? undefined,
  };
}

/** 依頼人がそろっていなくても、ドライバー側の口座だけを確かめるための仮の依頼人 */
const PLACEHOLDER_REQUESTER: Requester = {
  code: "0000000000",
  nameKana: "ｲﾗｲﾆﾝ",
  bankCode: "0000",
  bankNameKana: "",
  branchCode: "000",
  branchNameKana: "",
  accountType: "ordinary",
  accountNumber: "0000000",
};

/** ドライバー 1 人の口座の直すところ（日本語） */
export function bankIssues(b: BankFields, amount: number): string[] {
  return validateTransfers(PLACEHOLDER_REQUESTER, [toTransfer(b, amount)])
    .filter((i) => i.index >= 0)
    .map((i) => i.message);
}

/** 会社の設定から振込依頼人を読む。足りないところは problems に日本語で入れる */
export function readRequester(settings: s.TenantSettings | null | undefined): { requester: Requester | null; problems: string[] } {
  const r = settings?.requester ?? {};
  const requester: Requester = {
    code: (r.code ?? "").trim(),
    nameKana: (r.nameKana ?? "").trim(),
    bankCode: (r.bankCode ?? "").trim(),
    bankNameKana: (r.bankNameKana ?? "").trim(),
    branchCode: (r.branchCode ?? "").trim(),
    branchNameKana: (r.branchNameKana ?? "").trim(),
    accountType: r.accountType === "checking" ? "checking" : "ordinary",
    accountNumber: (r.accountNumber ?? "").trim(),
  };
  const problems = validateTransfers(requester, [])
    .filter((i) => i.index === -1)
    .map((i) => i.message);
  const name = toZenginKana(requester.nameKana);
  if (!name.value) problems.push("依頼人名（カナ）がありません");
  else if (name.invalid.length) problems.push(`依頼人名に使えない文字があります：${name.invalid.join("")}`);
  return { requester: problems.length ? null : requester, problems };
}

/** 振込_2026年10月分_20261125.txt */
export function transferFileName(month: string, transferDate: string): string {
  return `振込_${monthLabelJa(month)}分_${transferDate.replace(/-/g, "")}.txt`;
}

/** 振込データの一覧（CSV）のファイル名 */
export function transferCsvName(fileName: string): string {
  return fileName.replace(/^振込_/, "振込一覧_").replace(/\.txt$/, ".csv");
}

// ---------------------------------------------------------------- 読む

/** この月の明細と口座を読み、振込データに入る人・入らない人に分ける */
export async function loadTransferPlan(db: Db, tenantId: string, month: string): Promise<TransferPlan> {
  assertMonth(month);
  const tenant = await getTenant(db, tenantId);
  const closed = await isMonthClosed(db, tenantId, month);
  const [statements, drivers, batches] = await Promise.all([
    db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    listTransferBatches(db, tenantId, month),
  ]);
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  // 明細が使える状態か
  let ready = statements.length > 0;
  let blockReason: string | null = null;
  let staleCount = 0;
  if (statements.length === 0) {
    blockReason = closed
      ? "この月は締めてありますが、保存された明細がありません。振込データは明細の振込額から作るため、作れません。"
      : "この月の明細がまだ保存されていません。先に支払明細を作ってください。";
  } else if (!closed) {
    const st = await statementsStatus(db, tenantId, month);
    staleCount = st.missing.length + st.stale.length + st.orphan.length;
    if (!st.upToDate) {
      ready = false;
      blockReason = `明細を作ったあとに稼働や設定が変わっています（${staleCount}人）。明細を作り直してから振込データを作ってください。`;
    }
  }

  const promisedPayDate = statements.length ? readSnapshot(statements[0]).payDate : payDateFor(month, tenant);
  const { requester, problems } = readRequester(tenant.settings);

  const included: TransferRow[] = [];
  const excluded: ExcludedRow[] = [];
  for (const st of statements) {
    const d = driverById.get(st.driverId);
    const snap = readSnapshot(st);
    const driverName = d?.name ?? snap.driver?.name ?? "（不明）";
    const driverCode = d?.code ?? snap.driver?.code ?? null;
    const base = { statementId: st.id, driverId: st.driverId, driverName, driverCode, amount: st.total };
    if (st.total <= 0) {
      excluded.push({ ...base, reason: "not_positive", message: "振込の対象外です（控除が委託料を上回っています。内容を確かめてください）", issues: [] });
      continue;
    }
    const bank = d ? bankOf(d) : null;
    if (!bank || hasNoBank(bank)) {
      excluded.push({ ...base, reason: "no_bank", message: "口座が未登録です。ドライバーの設定で口座を入れてください。", issues: [] });
      continue;
    }
    const issues = bankIssues(bank, st.total);
    if (issues.length) {
      excluded.push({ ...base, reason: "bank_invalid", message: "口座の情報に直すところがあります。直すまで振込データに入れません。", issues });
      continue;
    }
    included.push({
      ...base,
      version: st.version,
      bank,
      holderHalf: toZenginKana(bank.holderKana).value,
      inBatches: batches
        .filter((b) => b.statementIds.includes(st.id))
        .map((b) => ({ id: b.id, fileName: b.fileName, executedOn: b.executedOn })),
    });
  }
  const byName = (a: { driverCode: string | null; driverName: string }, b: { driverCode: string | null; driverName: string }) =>
    (a.driverCode ?? "").localeCompare(b.driverCode ?? "", "ja") || a.driverName.localeCompare(b.driverName, "ja");
  included.sort(byName);
  excluded.sort(byName);

  return {
    month,
    closed,
    savedStatements: statements.length,
    ready,
    blockReason,
    staleCount,
    promisedPayDate,
    defaultTransferDate: adjustForBankHoliday(promisedPayDate, "before"),
    requester,
    requesterProblems: problems,
    feeBearerDriver: tenant.settings?.transferFeeBearer === "driver",
    included,
    excluded,
    total: included.reduce((a, r) => a + r.amount, 0),
    batches: batches.map(({ statementIds: _ids, ...b }) => b),
  };
}

type BatchWithIds = BatchView & { statementIds: string[] };

/** この月の振込データの一覧（新しい順）。作ったあとに明細が変わったかも見る */
export async function listTransferBatches(db: Db, tenantId: string, month: string): Promise<BatchWithIds[]> {
  const [batches, users, statements] = await Promise.all([
    db
      .select()
      .from(s.transferBatches)
      .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month)))
      .orderBy(desc(s.transferBatches.createdAt)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
    db
      .select({ id: s.statements.id, total: s.statements.total })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const totalById = new Map(statements.map((st) => [st.id, st.total]));
  return batches.map((b) => {
    const current = b.statementIds.map((id) => totalById.get(id)).filter((t): t is number => t !== undefined);
    const currentTotal = current.reduce((a, t) => a + t, 0);
    return {
      id: b.id,
      month: b.month,
      transferDate: b.transferDate,
      executedOn: b.executedOn,
      count: b.count,
      total: b.total,
      fileName: b.fileName,
      createdAt: b.createdAt,
      createdByName: b.createdBy ? userName.get(b.createdBy) ?? null : null,
      changed: current.length !== b.count || currentTotal !== b.total,
      currentCount: current.length,
      currentTotal,
      statementIds: b.statementIds,
    };
  });
}

// ---------------------------------------------------------------- 作る

export type CreateTransferInput = {
  transferDate: string;
  /** all：全員／remaining：まだ振込データに入っていない人だけ */
  scope: "all" | "remaining";
  /** 前に作った振込データを使っていないことを確かめたか（all で前のデータがあるとき必須） */
  replaceConfirmed?: boolean;
};

export type CreatedBatch = typeof s.transferBatches.$inferSelect & { excluded: ExcludedRow[] };

export async function createTransferBatch(
  db: Db,
  tenantId: string,
  month: string,
  input: CreateTransferInput,
  userId?: string | null,
): Promise<CreatedBatch> {
  const plan = await loadTransferPlan(db, tenantId, month);
  if (!plan.ready) throw new UserError(plan.blockReason ?? "明細を確かめてください");

  const date = input.transferDate.trim();
  if (!isDateString(date)) throw new UserError("振込指定日を正しい日付で入れてください（例：2026-11-25）");
  if (isBankHoliday(date)) {
    throw new UserError(`${shortDate(date)} は銀行の休みの日です。前の営業日の ${shortDate(adjustForBankHoliday(date, "before"))} などにしてください。`);
  }
  // 全銀のデータには月日しか書かないので、対象の月から 1 年以内に限る
  if (date < plan.month || date > `${Number(plan.month.slice(0, 4)) + 1}${plan.month.slice(4)}`) {
    throw new UserError("振込指定日は、対象の月の初日から 1 年以内の日にしてください");
  }

  const earlier = plan.batches;
  let rows = plan.included;
  if (input.scope === "remaining") {
    rows = rows.filter((r) => r.inBatches.length === 0);
  } else if (earlier.length > 0 && !input.replaceConfirmed) {
    throw new UserError(
      `この月の振込データはすでに ${earlier.length} 件あります。同じ人に二重に振り込まないよう、「まだ入っていない人だけ」を選ぶか、前のデータを銀行に出していないことを確かめてから作ってください。`,
    );
  }
  if (rows.length === 0) {
    throw new UserError(
      input.scope === "remaining" && plan.included.length > 0
        ? "振込データに入っていない人はいません（全員、前に作った振込データに入っています）"
        : "振込データに入れられる人がいません。口座と振込額を確かめてください。",
    );
  }

  const total = rows.reduce((a, r) => a + r.amount, 0);
  // 同じ名前のファイルがあれば _2・_3 を付ける
  const baseName = transferFileName(month, date);
  const names = new Set(earlier.map((b) => b.fileName));
  let fileName = baseName;
  for (let n = 2; names.has(fileName); n++) fileName = baseName.replace(/\.txt$/, `_${n}.txt`);

  const [batch] = await db
    .insert(s.transferBatches)
    .values({
      tenantId,
      month,
      transferDate: date,
      statementIds: rows.map((r) => r.statementId),
      count: rows.length,
      total,
      fileName,
      createdBy: userId ?? null,
    })
    .returning();

  await audit(db, {
    tenantId,
    userId,
    action: "transfer.create",
    entity: "transfer_batch",
    entityId: batch.id,
    detail: {
      month,
      transferDate: date,
      promisedPayDate: plan.promisedPayDate,
      count: rows.length,
      total,
      fileName,
      scope: input.scope,
      lines: rows.map((r) => ({ statementId: r.statementId, driverId: r.driverId, amount: r.amount, version: r.version })),
      excluded: plan.excluded.map((e) => ({ driverId: e.driverId, reason: e.reason, amount: e.amount })),
    },
  });
  return { ...batch, excluded: plan.excluded };
}

// ---------------------------------------------------------------- ファイル

type BatchLine = { row: TransferRow; transfer: Transfer };

async function getBatch(db: Db, tenantId: string, batchId: string) {
  if (!isUuid(batchId)) throw new UserError("振込データが見つかりません");
  const rows = await db
    .select()
    .from(s.transferBatches)
    .where(and(eq(s.transferBatches.id, batchId), eq(s.transferBatches.tenantId, tenantId)))
    .limit(1);
  const batch = rows[0];
  if (!batch) throw new UserError("振込データが見つかりません");
  return batch;
}

/** 振込データに入れた明細を今の状態で読み直し、作ったときの人数・合計と同じか確かめる */
async function loadBatchLines(db: Db, tenantId: string, batch: typeof s.transferBatches.$inferSelect): Promise<BatchLine[]> {
  const ids = batch.statementIds;
  const statements = ids.length
    ? await db
        .select()
        .from(s.statements)
        .where(and(eq(s.statements.tenantId, tenantId), inArray(s.statements.id, ids)))
    : [];
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)).orderBy(asc(s.drivers.code));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  const total = statements.reduce((a, st) => a + st.total, 0);
  if (statements.length !== batch.count || total !== batch.total) {
    throw new UserError(
      `この振込データを作ったあとに明細が変わりました（作ったとき：${batch.count}人・${batch.total.toLocaleString("ja-JP")}円／いま：${statements.length}人・${total.toLocaleString("ja-JP")}円）。この振込データは取り消して、作り直してください。`,
    );
  }

  const lines: BatchLine[] = [];
  const problems: string[] = [];
  for (const st of statements) {
    const d = driverById.get(st.driverId);
    if (!d) {
      problems.push("ドライバーが見つからない明細があります");
      continue;
    }
    const bank = bankOf(d);
    const issues = hasNoBank(bank) ? ["口座が未登録です"] : bankIssues(bank, st.total);
    if (issues.length) problems.push(`${d.name}：${issues.join("・")}`);
    lines.push({
      row: {
        statementId: st.id,
        driverId: d.id,
        driverName: d.name,
        driverCode: d.code,
        amount: st.total,
        version: st.version,
        bank,
        holderHalf: toZenginKana(bank.holderKana).value,
        inBatches: [],
      },
      transfer: toTransfer(bank, st.total, d.code),
    });
  }
  if (problems.length) throw new UserError(`口座の情報に直すところがあります。ドライバーの設定で直してください。\n${problems.join("\n")}`);
  // 並びはドライバーの番号順（銀行の画面で見比べやすいように）
  lines.sort((a, b) => (a.row.driverCode ?? "").localeCompare(b.row.driverCode ?? "", "ja") || a.row.driverName.localeCompare(b.row.driverName, "ja"));
  return lines;
}

export type ZenginFile = { fileName: string; bytes: Uint8Array; records: string[]; batch: typeof s.transferBatches.$inferSelect };

/** 全銀の振込データ（Shift_JIS・120 桁・CRLF）を作る。会社で絞り、他社の振込データは読めない */
export async function buildTransferFile(db: Db, tenantId: string, batchId: string): Promise<ZenginFile> {
  const batch = await getBatch(db, tenantId, batchId);
  const tenant = await getTenant(db, tenantId);
  const { requester, problems } = readRequester(tenant.settings);
  if (!requester) {
    throw new UserError(`振込依頼人（会社の口座）の設定が足りません：${problems.join("・")}。会社の設定で入れてください。`);
  }
  const lines = await loadBatchLines(db, tenantId, batch);
  const mmdd = batch.transferDate.slice(5, 7) + batch.transferDate.slice(8, 10);
  const records = buildZenginRecords(
    requester,
    mmdd,
    lines.map((l) => l.transfer),
  );
  return { fileName: batch.fileName, bytes: zenginBytes(records), records, batch };
}

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { ordinary: "普通", checking: "当座" };

/** 全銀の取り込みが無い銀行向けの一覧（CSV）。手で入れるときに見る */
export async function buildTransferCsv(
  db: Db,
  tenantId: string,
  batchId: string,
): Promise<{ fileName: string; text: string; batch: typeof s.transferBatches.$inferSelect }> {
  const batch = await getBatch(db, tenantId, batchId);
  const lines = await loadBatchLines(db, tenantId, batch);
  const rows: (string | number)[][] = [
    ["ドライバー番号", "ドライバー", "金融機関コード", "金融機関名", "支店コード", "支店名", "預金種目", "口座番号", "口座名義（カナ）", "振込額", "振込指定日"],
    ...lines.map(({ row }) => [
      row.driverCode ?? "",
      row.driverName,
      row.bank.bankCode,
      row.bank.bankNameKana,
      row.bank.branchCode,
      row.bank.branchNameKana,
      ACCOUNT_TYPE_LABEL[row.bank.accountType],
      row.bank.accountNumber,
      row.holderHalf,
      row.amount,
      batch.transferDate,
    ]),
    ["", "合計", "", "", "", "", "", "", `${lines.length}人`, batch.total, ""],
  ];
  return { fileName: transferCsvName(batch.fileName), text: csvText(rows), batch };
}

// ---------------------------------------------------------------- 記録

/** 実際に振り込んだ日を入れる（締めたあとでも入れられる。空にすると消す） */
export async function setTransferExecutedOn(
  db: Db,
  tenantId: string,
  batchId: string,
  executedOn: string | null,
  userId?: string | null,
): Promise<typeof s.transferBatches.$inferSelect> {
  const batch = await getBatch(db, tenantId, batchId);
  const value = executedOn?.trim() || null;
  if (value !== null && !isDateString(value)) throw new UserError("振り込んだ日を正しい日付で入れてください（例：2026-11-25）");
  if (value !== null && value < batch.month) throw new UserError("振り込んだ日が、対象の月より前になっています。日付を確かめてください");
  const [row] = await db
    .update(s.transferBatches)
    .set({ executedOn: value })
    .where(and(eq(s.transferBatches.id, batch.id), eq(s.transferBatches.tenantId, tenantId)))
    .returning();
  await audit(db, {
    tenantId,
    userId,
    action: "transfer.executed",
    entity: "transfer_batch",
    entityId: batch.id,
    detail: { month: batch.month, fileName: batch.fileName, executedOn: value, previous: batch.executedOn },
  });
  return row;
}

/** 振込データを取り消す（振り込んだ日が入っていないものだけ。記録は操作の記録に残る） */
export async function deleteTransferBatch(db: Db, tenantId: string, batchId: string, userId?: string | null): Promise<void> {
  const batch = await getBatch(db, tenantId, batchId);
  if (batch.executedOn) {
    throw new UserError("振り込んだ日が入っている振込データは、記録として残すため取り消せません。間違いなら、先に振り込んだ日を消してください。");
  }
  await db.delete(s.transferBatches).where(and(eq(s.transferBatches.id, batch.id), eq(s.transferBatches.tenantId, tenantId)));
  await audit(db, {
    tenantId,
    userId,
    action: "transfer.delete",
    entity: "transfer_batch",
    entityId: batch.id,
    detail: { month: batch.month, fileName: batch.fileName, transferDate: batch.transferDate, count: batch.count, total: batch.total, statementIds: batch.statementIds },
  });
}

/** ダウンロードしたことを残す（持ち出しの記録） */
export async function auditTransferDownload(
  db: Db,
  tenantId: string,
  userId: string,
  batch: { id: string; month: string; count: number; total: number },
  format: "zengin" | "csv",
): Promise<void> {
  await audit(db, {
    tenantId,
    userId,
    action: "transfer.download",
    entity: "transfer_batch",
    entityId: batch.id,
    detail: { month: batch.month, format, count: batch.count, total: batch.total },
  });
}
