import "server-only";
import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { payDateFor } from "~/server/calc/statement";
import { monthLabelJa, shiftMonth } from "~/server/month";
import { getTenant, isMonthClosed } from "~/server/repo";
import { readSnapshot, statementsStatus } from "~/server/statements-core";
import { csvText } from "~/server/download";
import { keyedHash, sha256 } from "~/server/tokens";
import { deemedDaysOf, statementStatus } from "~/server/features/statements/status";
import { deemedClauseMap } from "~/server/features/terms-content";
import { addAdjustment } from "~/server/features/import/work";
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
  /**
   * 振り込んだ日が入っているデータのうち、振り込んだ額と今の明細の額に差があって、まだ精算の記録が無い人の数
   * （振り込んだあとに締めを外して明細を作り直したとき。loadPaidDifferences）
   */
  paidDiffOpen: number;
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

/**
 * 振込データを作ったあとに、入れた明細の中身が変わったか（明細の版が作ったあとに足されたか）。
 * 人数と合計だけだと「Aさん +1,000円・Bさん −1,000円」を見落とすため、版で見る。
 * 時刻の比べ合わせは DB の中で行う（JS の日時はミリ秒までなので、同じミリ秒の前後を取り違えない）。
 * 1 つの表だけの select では drizzle が列名に表の名前を付けないため、ここは表の名前を書いて区別する。
 */
const versionChangedSql = sql<boolean>`exists (
  select 1 from "statement_versions" sv
  where sv."tenant_id" = "transfer_batches"."tenant_id"
    and sv."statement_id" = any("transfer_batches"."statement_ids")
    and sv."created_at" > "transfer_batches"."created_at"
)`.mapWith(Boolean);

/** 表計算ソフトで式として読まれないように（名前が「=」「+」「@」で始まるときは頭に ' を付ける） */
function csvSafe(value: string): string {
  return /^[=+@\t\r]/.test(value) ? `'${value}` : value;
}

// ---------------------------------------------------------------- 口座の目印（前回の振込との比べ合わせ）

/**
 * 振込データに入れたときの口座の目印。口座番号そのものは残さず、「同じか・どこが違うか」だけが分かる形にする。
 * - fp：銀行・支店・種目・番号・名義をまとめた鍵つきハッシュ（会社ごとに変わる）
 * - n / h：番号だけ・名義だけの鍵つきハッシュ（どこが変わったかを言うため）
 * - tail：番号の下 3 桁（画面で「****567」と見せるため）
 * - v：目印の作り方（2＝APP_SECRET から作った鍵の HMAC。無い＝前の作り方の sha256。読み比べるときだけ使う）
 */
export type BankStamp = { fp: string; bankCode: string; branchCode: string; accountType: AccountType; tail: string; n: string; h: string; v?: number };

/** いまの目印の作り方 */
const STAMP_VERSION = 2;

/** 名義は半角カナにそろえてから比べる（全角・半角の違いだけでは「変わった」にしない） */
function holderKey(holderKana: string): string {
  return toZenginKana(holderKana).value.replace(/\s+/g, " ").trim();
}

/**
 * 口座の目印は、APP_SECRET から作った口座の目印用の鍵の HMAC（server/tokens.ts の keyedHash）。
 * 鍵なしの sha256 だと、会社の id（操作の記録の CSV に出る）と下 3 桁から、残りの桁を総当たりで割り出せてしまうため。
 * APP_SECRET を変えると前の目印と比べられなくなり、次の振込で全員が「口座が変わった人」に出る（確かめる側に倒れる）。
 * 本番で APP_SECRET が 32 文字未満なら、署名つきリンクと同じく止める。
 */
function keyedStamp(value: string): string {
  return keyedHash("bank-stamp:v2", value);
}

/** 口座の目印（鍵つき。会社の id も混ぜるので、他社の記録と照らし合わせても番号は分からない） */
export function bankFingerprint(tenantId: string, b: BankFields): string {
  return keyedStamp(`bank:${tenantId}|${b.bankCode}|${b.branchCode}|${b.accountType}|${b.accountNumber}|${holderKey(b.holderKana)}`);
}

export function bankStamp(tenantId: string, b: BankFields): BankStamp {
  return {
    fp: bankFingerprint(tenantId, b),
    bankCode: b.bankCode,
    branchCode: b.branchCode,
    accountType: b.accountType,
    tail: b.accountNumber.slice(-3),
    n: keyedStamp(`bank-number:${tenantId}|${b.accountNumber}`).slice(0, 16),
    h: keyedStamp(`bank-holder:${tenantId}|${holderKey(b.holderKana)}`).slice(0, 16),
    v: STAMP_VERSION,
  };
}

/**
 * 前の作り方（鍵なしの sha256）の目印。すでに操作の記録に残っている目印と比べるときだけ使う（新しく残さない）。
 * 操作の記録は消せないので、前の目印は画面・CSV に出すときに外している（close.ts の maskAuditDetail）。
 */
function legacyBankStamp(tenantId: string, b: BankFields): BankStamp {
  return {
    fp: sha256(`bank:${tenantId}|${b.bankCode}|${b.branchCode}|${b.accountType}|${b.accountNumber}|${holderKey(b.holderKana)}`),
    bankCode: b.bankCode,
    branchCode: b.branchCode,
    accountType: b.accountType,
    tail: b.accountNumber.slice(-3),
    n: sha256(`bank-number:${tenantId}|${b.accountNumber}`).slice(0, 16),
    h: sha256(`bank-holder:${tenantId}|${holderKey(b.holderKana)}`).slice(0, 16),
  };
}

/** 今の口座を、記録に残っている目印と同じ作り方で目印にする（作り方が違うと、同じ口座でも違って見えるため） */
function stampLike(tenantId: string, recorded: BankStamp, b: BankFields): BankStamp {
  return recorded.v === STAMP_VERSION ? bankStamp(tenantId, b) : legacyBankStamp(tenantId, b);
}

/** 記録の目印と今の口座が同じか（前の作り方の目印とも比べる） */
export function sameBankAsStamp(tenantId: string, recorded: BankStamp, b: BankFields): boolean {
  return recorded.fp === stampLike(tenantId, recorded, b).fp;
}

const ACCOUNT_TYPE_JA: Record<AccountType, string> = { ordinary: "普通", checking: "当座" };

/** 口座の見せ方（番号は下 3 桁だけ）：0001-101 普通 ****567 */
export function maskedBank(stamp: Pick<BankStamp, "bankCode" | "branchCode" | "accountType" | "tail">): string {
  return `${stamp.bankCode}-${stamp.branchCode} ${ACCOUNT_TYPE_JA[stamp.accountType] ?? "普通"} ****${stamp.tail}`;
}

/** 前の目印と今の目印で、どこが違うか（日本語） */
export function stampDiff(before: BankStamp, after: BankStamp): string[] {
  const out: string[] = [];
  if (before.bankCode !== after.bankCode) out.push("銀行");
  if (before.branchCode !== after.branchCode) out.push("支店");
  if (before.accountType !== after.accountType) out.push("預金の種類");
  if (before.n !== after.n) out.push("口座番号");
  if (before.h !== after.h) out.push("口座名義");
  return out.length || before.fp === after.fp ? out : ["口座"];
}

/** ドライバーの設定の記録（driver.update の changed）の項目名 → 日本語 */
const BANK_FIELD_LABEL: Record<string, string> = {
  bankCode: "銀行コード",
  bankNameKana: "銀行名",
  branchCode: "支店コード",
  branchNameKana: "支店名",
  accountType: "預金の種類",
  accountNumber: "口座番号",
  holderKana: "口座名義",
};

function isStamp(v: unknown): v is BankStamp {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.fp === "string" && typeof o.bankCode === "string" && typeof o.branchCode === "string" && typeof o.tail === "string";
}

type StampedLine = { driverId: string; bank?: BankStamp };

/**
 * 振込データを作った記録。新しい順。
 * 取り消した振込データも「そのとき振り込むつもりだった口座」として比べる相手に入れる
 * （作ったあとに口座が変わり、取り消して作り直したときにも「変わった人」として出すため）。
 */
type CreatedRecord = { batchId: string; month: string; fileName: string; at: Date; deleted: boolean; lines: StampedLine[] };

async function createdTransferRecords(db: Db, tenantId: string): Promise<CreatedRecord[]> {
  const rows = await db
    .select({ action: s.auditLog.action, entityId: s.auditLog.entityId, detail: s.auditLog.detail, createdAt: s.auditLog.createdAt })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), inArray(s.auditLog.action, ["transfer.create", "transfer.delete"])))
    .orderBy(desc(s.auditLog.id));
  const deleted = new Set(rows.filter((r) => r.action === "transfer.delete").map((r) => r.entityId));
  const out: CreatedRecord[] = [];
  for (const r of rows) {
    if (r.action !== "transfer.create" || !r.entityId) continue;
    const d = r.detail ?? {};
    const lines = Array.isArray(d.lines) ? (d.lines as unknown[]) : [];
    out.push({
      batchId: r.entityId,
      month: typeof d.month === "string" ? d.month : "",
      fileName: typeof d.fileName === "string" ? d.fileName : "",
      at: r.createdAt,
      deleted: deleted.has(r.entityId),
      lines: lines
        .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && typeof (l as Record<string, unknown>).driverId === "string")
        .map((l) => ({ driverId: l.driverId as string, bank: isStamp(l.bank) ? l.bank : undefined })),
    });
  }
  return out;
}

export type BankEdit = {
  at: Date;
  userName: string | null;
  fields: string[];
  /** どこから変えたか（口座の一覧の取り込みなら、そのファイル名つき）。設定の画面なら null */
  via: string | null;
};

export type BankChange = {
  driverId: string;
  driverName: string;
  driverCode: string | null;
  /** 前回の振込（この人が入っていた、いちばん新しい振込データ。取り消したものも含む） */
  previous: { batchId: string; fileName: string; month: string; at: Date; deleted: boolean; masked: string };
  /** 今の口座（番号は下 3 桁だけ） */
  currentMasked: string;
  /** どこが変わったか（銀行・支店・預金の種類・口座番号・口座名義） */
  fields: string[];
  /** だれが・いつ変えたか（ドライバーの設定の記録から。新しい順） */
  edits: BankEdit[];
  /** 確かめた口座を表す短い値（「確かめました」を、画面で見た口座に結びつけるため。番号は分からない） */
  checkKey: string;
};

export type BankReview = {
  /** 前回の振込から口座が変わった人 */
  changed: BankChange[];
  /** 前に振り込んだ記録が無い人（初めての振込） */
  firstTime: { driverId: string; driverName: string; driverCode: string | null }[];
  /** 前に振り込んではいるが、そのときの口座の記録が無い人（この確かめを入れる前の振込） */
  unknown: { driverId: string; driverName: string; driverCode: string | null }[];
  /** 比べた人数 */
  compared: number;
};

type ReviewTarget = { driverId: string; driverName: string; driverCode: string | null; bank: BankFields };

/**
 * 前回の振込から口座が変わった人を探す（振込データを作る前に必ず見せる）。
 * 前回の口座は、振込データを作ったときの記録（transfer.create）に残した目印と比べる。
 * 変えた人と日時は、ドライバーの設定を直した記録（driver.update）から探す。見つからなければ edits は空。
 */
export async function reviewBankChanges(db: Db, tenantId: string, targets: ReviewTarget[]): Promise<BankReview> {
  const records = await createdTransferRecords(db, tenantId);
  const changed: BankChange[] = [];
  const firstTime: BankReview["firstTime"] = [];
  const unknown: BankReview["unknown"] = [];
  const pending: { target: ReviewTarget; since: Date; change: BankChange }[] = [];

  for (const t of targets) {
    const who = { driverId: t.driverId, driverName: t.driverName, driverCode: t.driverCode };
    const inAny = records.some((r) => r.lines.some((l) => l.driverId === t.driverId));
    const last = records.find((r) => r.lines.some((l) => l.driverId === t.driverId && l.bank));
    if (!last) {
      (inAny ? unknown : firstTime).push(who);
      continue;
    }
    const before = last.lines.find((l) => l.driverId === t.driverId && l.bank)!.bank!;
    const now = bankStamp(tenantId, t.bank);
    // 記録の目印と同じ作り方で比べる（前の作り方の目印でも、同じ口座なら「変わった」にしない）
    const nowLike = stampLike(tenantId, before, t.bank);
    if (before.fp === nowLike.fp) continue;
    const change: BankChange = {
      ...who,
      previous: { batchId: last.batchId, fileName: last.fileName, month: last.month, at: last.at, deleted: last.deleted, masked: maskedBank(before) },
      currentMasked: maskedBank(now),
      fields: stampDiff(before, nowLike),
      edits: [],
      checkKey: sha256(`bank-check:${t.driverId}|${now.fp}`).slice(0, 16),
    };
    changed.push(change);
    pending.push({ target: t, since: last.at, change });
  }

  // 変えた人と日時（ドライバーの設定を直した記録のうち、口座の項目が変わったもの）
  if (pending.length) {
    const since = new Date(Math.min(...pending.map((p) => p.since.getTime())));
    const [edits, users] = await Promise.all([
      db
        .select({ entityId: s.auditLog.entityId, userId: s.auditLog.userId, detail: s.auditLog.detail, createdAt: s.auditLog.createdAt })
        .from(s.auditLog)
        .where(
          and(
            eq(s.auditLog.tenantId, tenantId),
            eq(s.auditLog.action, "driver.update"),
            inArray(
              s.auditLog.entityId,
              pending.map((p) => p.target.driverId),
            ),
            gt(s.auditLog.createdAt, since),
          ),
        )
        .orderBy(desc(s.auditLog.id)),
      db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));
    for (const p of pending) {
      for (const e of edits) {
        if (e.entityId !== p.target.driverId || e.createdAt.getTime() <= p.since.getTime()) continue;
        const changedKeys = e.detail?.changed && typeof e.detail.changed === "object" ? Object.keys(e.detail.changed as object) : [];
        const fields = changedKeys.filter((k) => k in BANK_FIELD_LABEL).map((k) => BANK_FIELD_LABEL[k]);
        if (fields.length === 0) continue;
        const via =
          e.detail?.source === "import.bank"
            ? `口座の一覧の取り込み${typeof e.detail.fileName === "string" && e.detail.fileName ? `（${e.detail.fileName}）` : ""}`
            : null;
        p.change.edits.push({ at: e.createdAt, userName: e.userId ? userName.get(e.userId) ?? null : null, fields, via });
      }
    }
  }

  const byName = (a: { driverCode: string | null; driverName: string }, b: { driverCode: string | null; driverName: string }) =>
    (a.driverCode ?? "").localeCompare(b.driverCode ?? "", "ja") || a.driverName.localeCompare(b.driverName, "ja");
  return { changed: changed.sort(byName), firstTime: firstTime.sort(byName), unknown: unknown.sort(byName), compared: targets.length };
}

/**
 * 「口座が変わった人を確かめました」を、画面で見た人と口座に結びつける値。
 * 画面を開いたあとにまた口座が変わると値が変わるので、確かめていない口座で作ることを防げる。変わった人がいなければ空。
 */
export function bankReviewKey(changes: Pick<BankChange, "checkKey">[]): string {
  if (changes.length === 0) return "";
  return sha256(`bank-review:${changes.map((c) => c.checkKey).sort().join(",")}`).slice(0, 24);
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
      // 人で見る（明細が消えて作り直され、id が変わっていても、前のデータに入っていたと分かるように）
      inBatches: batches
        .filter((b) => b.driverIds.includes(st.driverId))
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
    batches: batches.map(({ statementIds: _ids, driverIds: _drivers, ...b }) => b),
  };
}

// ---------------------------------------------------------------- 作る前に確かめること（止めずに知らせる）

export type NoteDriver = { driverId: string; driverName: string; driverCode: string | null };

export type TransferNotes = {
  /** ドライバーからの質問で、まだ解決にしていないもの */
  openQuestions: (NoteDriver & { count: number })[];
  /** 今の版をまだ確認していない人（みなし確認は含めない） */
  unconfirmed: (NoteDriver & { status: string })[];
  /** 前の版を確認したが、そのあと明細が変わった人 */
  oldVersion: (NoteDriver & { confirmedVersion: number; currentVersion: number })[];
};

/** 振込の前に知らせること：未解決の質問・未確認の明細・前の版を確認したままの明細 */
export async function loadTransferNotes(db: Db, tenantId: string, month: string, now: Date = new Date()): Promise<TransferNotes> {
  assertMonth(month);
  const tenant = await getTenant(db, tenantId);
  const statements = await db
    .select({
      id: s.statements.id,
      driverId: s.statements.driverId,
      version: s.statements.version,
      total: s.statements.total,
      sentAt: s.statements.sentAt,
      viewedAt: s.statements.viewedAt,
      updatedAt: s.statements.updatedAt,
      snapshot: s.statements.snapshot,
    })
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  const out: TransferNotes = { openQuestions: [], unconfirmed: [], oldVersion: [] };
  if (statements.length === 0) return out;
  const ids = statements.map((st) => st.id);
  const [confirmations, messages, drivers] = await Promise.all([
    db
      .select({ statementId: s.statementConfirmations.statementId, version: s.statementConfirmations.version, createdAt: s.statementConfirmations.createdAt })
      .from(s.statementConfirmations)
      .where(and(eq(s.statementConfirmations.tenantId, tenantId), inArray(s.statementConfirmations.statementId, ids))),
    db
      .select({
        statementId: s.statementMessages.statementId,
        createdAt: s.statementMessages.createdAt,
        resolvedAt: s.statementMessages.resolvedAt,
        readAt: s.statementMessages.readAt,
      })
      .from(s.statementMessages)
      .where(and(eq(s.statementMessages.tenantId, tenantId), eq(s.statementMessages.author, "driver"), inArray(s.statementMessages.statementId, ids))),
    db.select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const deemedDays = deemedDaysOf(tenant.settings);
  // みなし確認は、取引条件にその条項がある人だけ（明細の画面と同じ判定）
  const clauses = await deemedClauseMap(db, tenantId, statements.map((x) => x.driverId));
  for (const st of statements) {
    const d = driverById.get(st.driverId);
    const snap = readSnapshot(st);
    const who: NoteDriver = { driverId: st.driverId, driverName: d?.name ?? snap.driver?.name ?? "（不明）", driverCode: d?.code ?? snap.driver?.code ?? null };
    const status = statementStatus(
      {
        version: st.version,
        sentAt: st.sentAt,
        viewedAt: st.viewedAt,
        updatedAt: st.updatedAt,
        confirmations: confirmations.filter((c) => c.statementId === st.id),
        driverMessages: messages.filter((m) => m.statementId === st.id),
        deemedClause: clauses.get(st.driverId) === true,
      },
      now,
      deemedDays,
    );
    if (status.openQuestions > 0) out.openQuestions.push({ ...who, count: status.openQuestions });
    if (status.key === "changed") {
      out.oldVersion.push({ ...who, confirmedVersion: status.lastConfirmedVersion ?? 0, currentVersion: st.version });
    } else if (status.key !== "confirmed" && status.key !== "deemed") {
      out.unconfirmed.push({ ...who, status: status.label });
    }
  }
  const byName = (a: NoteDriver, b: NoteDriver) => (a.driverCode ?? "").localeCompare(b.driverCode ?? "", "ja") || a.driverName.localeCompare(b.driverName, "ja");
  out.openQuestions.sort(byName);
  out.unconfirmed.sort(byName);
  out.oldVersion.sort(byName);
  return out;
}

export type TransferReview = {
  /** 振込データに入る人（included）について、前回の振込からの口座の変わり方 */
  bank: BankReview;
  /** まだ振込データに入っていない人のうち、口座が変わった人の数（「まだの人だけ」を選んだときの確認に使う） */
  changedRemaining: number;
  /** 「確かめました」に添えて送る値（全員ぶん・まだの人だけ。bankReviewKey） */
  bankKeys: { all: string; remaining: string };
  notes: TransferNotes;
  /** この月の振込データのうち、作ったあとに口座が変わった人を含むもの（ダウンロードを止める） */
  staleBankBatches: { batchId: string; drivers: string[] }[];
};

/** 振込データを作る前に見せること（口座の変更・質問・確認の様子）。止めるのは口座の変更の確認だけ */
export async function loadTransferReview(db: Db, tenantId: string, month: string, plan?: TransferPlan): Promise<TransferReview> {
  const p = plan ?? (await loadTransferPlan(db, tenantId, month));
  const [bank, notes, staleBankBatches] = await Promise.all([
    reviewBankChanges(db, tenantId, p.included),
    loadTransferNotes(db, tenantId, month),
    batchesWithBankChanges(db, tenantId, month),
  ]);
  const remaining = new Set(p.included.filter((r) => r.inBatches.length === 0).map((r) => r.driverId));
  const changedRemaining = bank.changed.filter((c) => remaining.has(c.driverId));
  return {
    bank,
    changedRemaining: changedRemaining.length,
    bankKeys: { all: bankReviewKey(bank.changed), remaining: bankReviewKey(changedRemaining) },
    notes,
    staleBankBatches,
  };
}

/** 振込データを作ったときの口座の目印（記録が無い＝この確かめを入れる前のデータなら null） */
async function batchStamps(db: Db, tenantId: string, batchId: string): Promise<Map<string, BankStamp> | null> {
  const rows = await db
    .select({ detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create"), eq(s.auditLog.entityId, batchId)))
    .orderBy(desc(s.auditLog.id))
    .limit(1);
  const lines = Array.isArray(rows[0]?.detail?.lines) ? (rows[0].detail.lines as Record<string, unknown>[]) : [];
  const out = new Map<string, BankStamp>();
  for (const l of lines) if (l && typeof l.driverId === "string" && isStamp(l.bank)) out.set(l.driverId, l.bank);
  return out.size ? out : null;
}

/** この月の振込データのうち、作ったあとに口座が変わった人を含むもの（振り込んだ日が入っているものは除く） */
async function batchesWithBankChanges(db: Db, tenantId: string, month: string): Promise<{ batchId: string; drivers: string[] }[]> {
  const batches = await db
    .select({ id: s.transferBatches.id })
    .from(s.transferBatches)
    .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month), isNull(s.transferBatches.executedOn)));
  if (batches.length === 0) return [];
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  const out: { batchId: string; drivers: string[] }[] = [];
  for (const b of batches) {
    const stamps = await batchStamps(db, tenantId, b.id);
    if (!stamps) continue;
    const names = drivers.filter((d) => stamps.has(d.id) && !sameBankAsStamp(tenantId, stamps.get(d.id)!, bankOf(d))).map((d) => d.name);
    if (names.length) out.push({ batchId: b.id, drivers: names.sort((a, c) => a.localeCompare(c, "ja")) });
  }
  return out;
}

type BatchWithIds = BatchView & {
  statementIds: string[];
  /** 入っている人（明細が消えていても、版の記録から分かる） */
  driverIds: string[];
};

/** この月の振込データの一覧（新しい順）。作ったあとに明細が変わったかも見る */
export async function listTransferBatches(db: Db, tenantId: string, month: string): Promise<BatchWithIds[]> {
  const [batches, users, statements, versions] = await Promise.all([
    db
      .select({ ...getTableColumns(s.transferBatches), versionChanged: versionChangedSql })
      .from(s.transferBatches)
      .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month)))
      .orderBy(desc(s.transferBatches.createdAt)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
    db
      .select({ id: s.statements.id, total: s.statements.total, driverId: s.statements.driverId })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    db
      .selectDistinct({ statementId: s.statementVersions.statementId, driverId: s.statementVersions.driverId })
      .from(s.statementVersions)
      .where(and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.month, month))),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const totalById = new Map(statements.map((st) => [st.id, st.total]));
  const driverOf = new Map<string, string>([...versions.map((v) => [v.statementId, v.driverId] as const), ...statements.map((st) => [st.id, st.driverId] as const)]);
  // 振り込んだあとに明細が変わったデータがあるときだけ、振り込んだ額との差を人ごとに見る
  const isChanged = (b: (typeof batches)[number]) => {
    const current = b.statementIds.map((id) => totalById.get(id)).filter((t): t is number => t !== undefined);
    return b.versionChanged || current.length !== b.count || current.reduce((a, t) => a + t, 0) !== b.total;
  };
  const needsDiff = batches.some((b) => b.executedOn && isChanged(b));
  const open = needsDiff ? new Set((await loadPaidDifferences(db, tenantId, month)).rows.filter((r) => r.outstanding !== 0).map((r) => r.driverId)) : new Set<string>();
  return batches.map((b) => {
    const current = b.statementIds.map((id) => totalById.get(id)).filter((t): t is number => t !== undefined);
    const currentTotal = current.reduce((a, t) => a + t, 0);
    const driverIds = [...new Set(b.statementIds.map((id) => driverOf.get(id)).filter((d): d is string => d !== undefined))];
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
      changed: isChanged(b),
      currentCount: current.length,
      currentTotal,
      paidDiffOpen: b.executedOn ? driverIds.filter((d) => open.has(d)).length : 0,
      statementIds: b.statementIds,
      driverIds,
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
  /** 前回の振込から口座が変わった人を、ご本人に確かめたか（変わった人がいるとき必須） */
  bankChangesConfirmed?: boolean;
  /**
   * 確かめたときに画面に出ていた「変わった人と口座」の値（loadTransferReview の bankKeys）。
   * 渡されたときは、今の値と同じでなければ作らない（画面を開いたあとに、また口座が変わったとき）
   */
  bankReviewKey?: string;
};

export type CreatedBatch = typeof s.transferBatches.$inferSelect & {
  excluded: ExcludedRow[];
  /** 前回から口座が変わった人の数（確かめたうえで作った） */
  bankChanged?: number;
  /** 振込指定日が、明細に書いた支払日より何日あとか（0 なら間に合う日） */
  lateDays?: number;
};

/** a から b まで何日あとか（b が後なら正） */
export function daysAfter(a: string, b: string): number {
  const toUtc = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * 振込データを 1 件作って記録する。
 * 同じ会社で同時に 2 回押されても二重に作らないよう、会社の行に鍵をかけてから読み直して作る
 * （締めの処理も同じ鍵を使うので、締めている途中の明細で作ることもない）。
 */
export async function createTransferBatch(
  db: Db,
  tenantId: string,
  month: string,
  input: CreateTransferInput,
  userId?: string | null,
): Promise<CreatedBatch> {
  assertMonth(month);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockTenant(t, tenantId);
    return createTransferBatchLocked(t, tenantId, month, input, userId);
  });
}

/** 会社の行に鍵をかける（トランザクションの中で。振込データを作る・締めるを 1 つずつにする） */
export async function lockTenant(db: Db, tenantId: string): Promise<void> {
  const rows = await db.select({ id: s.tenants.id }).from(s.tenants).where(eq(s.tenants.id, tenantId)).for("no key update");
  if (!rows[0]) throw new Error("会社が見つかりません");
}

async function createTransferBatchLocked(
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
  } else if (earlier.length > 0) {
    // 振り込んだ日が入っているデータがあるなら、全員ぶんは必ず二重になる
    const executed = earlier.filter((b) => b.executedOn);
    if (executed.length) {
      throw new UserError(
        `振り込んだ日が記録されている振込データ（${executed.map((b) => b.fileName).join("、")}）があるため、全員ぶんは作れません（二重の振込になります）。「まだ振込データに入っていない人だけ」を選んでください。振り込んだ日の記録が間違いなら、先にその日付を消してください。`,
      );
    }
    if (!input.replaceConfirmed) {
      throw new UserError(
        `この月の振込データはすでに ${earlier.length} 件あります。同じ人に二重に振り込まないよう、「まだ入っていない人だけ」を選ぶか、前のデータを銀行に出していないことを確かめてから作ってください。`,
      );
    }
  }
  if (rows.length === 0) {
    throw new UserError(
      input.scope === "remaining" && plan.included.length > 0
        ? "振込データに入っていない人はいません（全員、前に作った振込データに入っています）"
        : "振込データに入れられる人がいません。口座と振込額を確かめてください。",
    );
  }

  // 前回の振込から口座が変わった人は、確かめた印が無いと作らない（口座の書き換えによる誤送金を防ぐ）
  const bankReview = await reviewBankChanges(db, tenantId, rows);
  if (bankReview.changed.length && !input.bankChangesConfirmed) {
    const list = bankReview.changed.map((c) => `・${c.driverName}（${c.fields.join("・")}）`).join("\n");
    throw new UserError(
      `前回の振込から口座が変わった人が ${bankReview.changed.length}人います。口座が正しいか、ご本人に電話などで確かめてから、「口座が変わった人を確かめました」に印を付けて作ってください。\n${list}`,
    );
  }
  if (bankReview.changed.length && input.bankReviewKey !== undefined && input.bankReviewKey !== bankReviewKey(bankReview.changed)) {
    const list = bankReview.changed.map((c) => `・${c.driverName}（${c.fields.join("・")}）`).join("\n");
    throw new UserError(
      `確かめたあとに、口座が変わった人（または口座）がさらに変わっています。振込データは作っていません。画面を読み直して、「前回の振込から口座が変わった人」をもう一度確かめてください。\n${list}`,
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
      // 口座は目印だけを残す（番号そのものは残さない。次の振込で「口座が変わった人」を見つけるのに使う）
      lines: rows.map((r) => ({ statementId: r.statementId, driverId: r.driverId, amount: r.amount, version: r.version, bank: bankStamp(tenantId, r.bank) })),
      excluded: plan.excluded.map((e) => ({ driverId: e.driverId, reason: e.reason, amount: e.amount })),
      bankChanged: bankReview.changed.map((c) => ({ driverId: c.driverId, fields: c.fields })),
      firstTime: bankReview.firstTime.map((f) => f.driverId),
    },
  });
  return { ...batch, excluded: plan.excluded, bankChanged: bankReview.changed.length, lateDays: Math.max(0, daysAfter(plan.promisedPayDate, date)) };
}

// ---------------------------------------------------------------- ファイル

type BatchLine = { row: TransferRow; transfer: Transfer };

type StoredBatch = typeof s.transferBatches.$inferSelect & { versionChanged: boolean };

async function getBatch(db: Db, tenantId: string, batchId: string): Promise<StoredBatch> {
  if (!isUuid(batchId)) throw new UserError("振込データが見つかりません");
  const rows = await db
    .select({ ...getTableColumns(s.transferBatches), versionChanged: versionChangedSql })
    .from(s.transferBatches)
    .where(and(eq(s.transferBatches.id, batchId), eq(s.transferBatches.tenantId, tenantId)))
    .limit(1);
  const batch = rows[0];
  if (!batch) throw new UserError("振込データが見つかりません");
  return batch;
}

/** 振込データに入れた明細を今の状態で読み直し、作ったときの人数・合計と同じか確かめる */
async function loadBatchLines(db: Db, tenantId: string, batch: StoredBatch): Promise<BatchLine[]> {
  const ids = batch.statementIds;
  const statements = ids.length
    ? await db
        .select()
        .from(s.statements)
        .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, batch.month), inArray(s.statements.id, ids)))
    : [];
  const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)).orderBy(asc(s.drivers.code));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  const total = statements.reduce((a, st) => a + st.total, 0);
  if (batch.versionChanged || statements.length !== batch.count || total !== batch.total) {
    const now = `いま：${statements.length}人・${total.toLocaleString("ja-JP")}円`;
    throw new UserError(
      `この振込データを作ったあとに明細が変わりました（作ったとき：${batch.count}人・${batch.total.toLocaleString("ja-JP")}円／${now}${
        batch.versionChanged && total === batch.total ? "。合計は同じでも、人ごとの額が変わっています" : ""
      }）。この振込データは取り消して、作り直してください。`,
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
  // 作ったあとに口座が変わった人がいれば出さない（ファイルは今の口座で作るため、確かめていない口座に振り込まないように）
  const stamps = await batchStamps(db, tenantId, batch.id);
  if (stamps) {
    const moved = lines.filter((l) => stamps.has(l.row.driverId) && !sameBankAsStamp(tenantId, stamps.get(l.row.driverId)!, l.row.bank));
    if (moved.length) {
      const who = moved.map((l) => l.row.driverName).join("、");
      throw new UserError(
        batch.executedOn
          ? `この振込データを作ったあとに、口座が変わった人がいます（${who}）。振り込んだ記録があるデータなので、いまの口座では出し直しません（振り込んだときの口座と違うファイルになるため）。振り込んだときの人数と金額は、この画面と操作の記録で確かめられます。`
          : `この振込データを作ったあとに、口座が変わった人がいます（${who}）。確かめていない口座に振り込まないよう、この振込データは取り消して作り直してください（作り直すときに、口座が変わった人を確かめる欄が出ます）。`,
      );
    }
  }
  // 並びはドライバーの番号順（銀行の画面で見比べやすいように）
  lines.sort((a, b) => (a.row.driverCode ?? "").localeCompare(b.row.driverCode ?? "", "ja") || a.row.driverName.localeCompare(b.row.driverName, "ja"));
  return lines;
}

export type ZenginFile = { fileName: string; bytes: Uint8Array; records: string[]; batch: StoredBatch };

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

/** 全銀の取り込みが無い銀行向けの一覧（CSV）。手で入れるときに見る */
export async function buildTransferCsv(
  db: Db,
  tenantId: string,
  batchId: string,
): Promise<{ fileName: string; text: string; batch: StoredBatch }> {
  const batch = await getBatch(db, tenantId, batchId);
  const lines = await loadBatchLines(db, tenantId, batch);
  const rows: (string | number)[][] = [
    ["ドライバー番号", "ドライバー", "金融機関コード", "金融機関名", "支店コード", "支店名", "預金種目", "口座番号", "口座名義（カナ）", "振込額", "振込指定日"],
    ...lines.map(({ row }) => [
      csvSafe(row.driverCode ?? ""),
      csvSafe(row.driverName),
      row.bank.bankCode,
      row.bank.bankNameKana,
      row.bank.branchCode,
      row.bank.branchNameKana,
      ACCOUNT_TYPE_JA[row.bank.accountType],
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

// ---------------------------------------------------------------- 振り込んだあとに明細が変わったとき（差の精算）

/**
 * 振り込んだ日が入っている振込データがある月で、締めを外して明細を作り直すと、振り込んだ額と明細の額が合わなくなる。
 * 二重に振り込まないよう、その人は「まだ入っていない人だけ」の振込データには入らない。そこで差を人ごとに出し、
 * 精算の仕方を記録する：翌月の明細の調整で精算する（調整を 1 行足す）か、別の方法で精算したと記録する（別に振り込んだ・返してもらった など）。
 * 精算の記録は操作の記録（transfer.settle）に残す（消せない表なので、あとから「どう精算したか」を必ずたどれる）。
 */

export type SettlementMethod = "next_month" | "outside";

export type Settlement = {
  /** 操作の記録の番号 */
  id: number;
  method: SettlementMethod;
  /** 精算した額（＋は払い足した、−は払いすぎの分を精算した） */
  amount: number;
  at: Date;
  userName: string | null;
  /** 翌月の明細の調整（next_month） */
  nextMonth: string | null;
  adjustmentId: string | null;
  /** 翌月の調整が消されていて、精算になっていない */
  voided: boolean;
  /** 別の方法で精算した日とメモ（outside） */
  settledOn: string | null;
  note: string | null;
};

export type PaidDiffRow = {
  driverId: string;
  driverName: string;
  driverCode: string | null;
  /** 振り込んだ額（振り込んだ日が入っている振込データに入れた額の合計） */
  paid: number;
  /** 振り込んだときの明細の版 */
  paidVersions: number[];
  /** 振り込んだ日 */
  paidOn: string[];
  /** 今の明細（無くなっていれば null・0 円） */
  statementId: string | null;
  statementVersion: number | null;
  statementTotal: number;
  /** 今の明細 − 振り込んだ額（＋：払い足りない／−：払いすぎ） */
  difference: number;
  settlements: Settlement[];
  /** 精算の記録の合計（消された調整は数えない） */
  settled: number;
  /** まだ精算の記録が無い差 */
  outstanding: number;
};

export type PaidDiffReport = {
  month: string;
  /** 振り込んだ日が入っている振込データの数 */
  executedBatches: number;
  /** 差がある人・精算の記録がある人 */
  rows: PaidDiffRow[];
  /** まだ精算の記録が無い差がある人数 */
  openCount: number;
  /** まだ精算していない、払い足りない額の合計 */
  underpaid: number;
  /** まだ精算していない、払いすぎの額の合計（正の数） */
  overpaid: number;
  /** 精算に使う翌月と、その月が締めてあるか */
  nextMonth: string;
  nextMonthClosed: boolean;
};

const SETTLE_ACTION = "transfer.settle";
const SETTLE_UNDO_ACTION = "transfer.settle_undo";

type PaidLine = { driverId: string; statementId: string; amount: number; version: number | null; executedOn: string };

/** 振り込んだ日が入っている振込データに、だれに・いくら入れたか（作ったときの記録から。記録が無ければ、作ったときの明細の版から） */
async function executedPaidLines(
  db: Db,
  tenantId: string,
  batches: { id: string; statementIds: string[]; executedOn: string; createdAt: Date }[],
): Promise<PaidLine[]> {
  if (batches.length === 0) return [];
  const logs = await db
    .select({ entityId: s.auditLog.entityId, detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create"), inArray(s.auditLog.entityId, batches.map((b) => b.id))))
    .orderBy(desc(s.auditLog.id));
  const linesOf = new Map<string, PaidLine[]>();
  const executedOf = new Map(batches.map((b) => [b.id, b.executedOn]));
  for (const log of logs) {
    if (!log.entityId || linesOf.has(log.entityId)) continue;
    const raw = Array.isArray(log.detail?.lines) ? (log.detail.lines as Record<string, unknown>[]) : [];
    const lines = raw
      .filter((l) => l && typeof l.driverId === "string" && typeof l.statementId === "string" && typeof l.amount === "number")
      .map((l) => ({
        driverId: l.driverId as string,
        statementId: l.statementId as string,
        amount: l.amount as number,
        version: typeof l.version === "number" ? l.version : null,
        executedOn: executedOf.get(log.entityId!)!,
      }));
    if (lines.length) linesOf.set(log.entityId, lines);
  }
  const out: PaidLine[] = [];
  const missing = batches.filter((b) => !linesOf.has(b.id));
  for (const b of batches) out.push(...(linesOf.get(b.id) ?? []));
  if (missing.length) {
    // 作ったときの記録が無い振込データ：作った時点でいちばん新しい明細の版の振込額
    const ids = [...new Set(missing.flatMap((b) => b.statementIds))];
    const versions = ids.length
      ? await db
          .select({
            statementId: s.statementVersions.statementId,
            driverId: s.statementVersions.driverId,
            version: s.statementVersions.version,
            total: s.statementVersions.total,
            createdAt: s.statementVersions.createdAt,
          })
          .from(s.statementVersions)
          .where(and(eq(s.statementVersions.tenantId, tenantId), inArray(s.statementVersions.statementId, ids)))
      : [];
    for (const b of missing) {
      for (const id of b.statementIds) {
        const at = versions
          .filter((v) => v.statementId === id && v.createdAt.getTime() <= b.createdAt.getTime())
          .sort((a, c) => c.version - a.version)[0];
        if (at) out.push({ driverId: at.driverId, statementId: id, amount: at.total, version: at.version, executedOn: b.executedOn });
      }
    }
  }
  return out;
}

/** 振り込んだ額と、今の明細の額の差（人ごと）。精算の記録も合わせて返す */
export async function loadPaidDifferences(db: Db, tenantId: string, month: string): Promise<PaidDiffReport> {
  assertMonth(month);
  const nextMonth = shiftMonth(month, 1);
  const [executed, nextMonthClosed] = await Promise.all([
    db
      .select({ id: s.transferBatches.id, statementIds: s.transferBatches.statementIds, executedOn: s.transferBatches.executedOn, createdAt: s.transferBatches.createdAt })
      .from(s.transferBatches)
      .where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, month), isNotNull(s.transferBatches.executedOn))),
    isMonthClosed(db, tenantId, nextMonth),
  ]);
  const report: PaidDiffReport = { month, executedBatches: executed.length, rows: [], openCount: 0, underpaid: 0, overpaid: 0, nextMonth, nextMonthClosed };
  if (executed.length === 0) return report;

  const paidLines = await executedPaidLines(
    db,
    tenantId,
    executed.map((b) => ({ id: b.id, statementIds: b.statementIds, executedOn: b.executedOn!, createdAt: b.createdAt })),
  );
  const [statements, drivers, settleLogs, users] = await Promise.all([
    db
      .select({ id: s.statements.id, driverId: s.statements.driverId, total: s.statements.total, version: s.statements.version, snapshot: s.statements.snapshot })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month))),
    db.select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
    db
      .select({ id: s.auditLog.id, action: s.auditLog.action, userId: s.auditLog.userId, detail: s.auditLog.detail, createdAt: s.auditLog.createdAt })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), inArray(s.auditLog.action, [SETTLE_ACTION, SETTLE_UNDO_ACTION]), sql`"audit_log"."detail"->>'month' = ${month}`))
      .orderBy(asc(s.auditLog.id)),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const statementOf = new Map(statements.map((st) => [st.driverId, st]));

  // 精算の記録（取り消したものは外す）。翌月の調整は、今もあるものだけを今の額で数える
  const undone = new Set(settleLogs.filter((l) => l.action === SETTLE_UNDO_ACTION && typeof l.detail?.settleId === "number").map((l) => l.detail.settleId as number));
  const settleRows = settleLogs.filter((l) => l.action === SETTLE_ACTION && !undone.has(l.id) && typeof l.detail?.driverId === "string");
  const adjustmentIds = settleRows.map((l) => l.detail.adjustmentId).filter((v): v is string => typeof v === "string" && isUuid(v));
  const adjustments = adjustmentIds.length
    ? await db
        .select({ id: s.adjustments.id, amount: s.adjustments.amount, month: s.adjustments.month })
        .from(s.adjustments)
        .where(and(eq(s.adjustments.tenantId, tenantId), inArray(s.adjustments.id, adjustmentIds)))
    : [];
  const adjustmentById = new Map(adjustments.map((a) => [a.id, a]));
  const settlementsOf = new Map<string, Settlement[]>();
  for (const l of settleRows) {
    const d = l.detail;
    const method: SettlementMethod = d.method === "next_month" ? "next_month" : "outside";
    const adjustmentId = typeof d.adjustmentId === "string" ? d.adjustmentId : null;
    const adj = adjustmentId ? adjustmentById.get(adjustmentId) : undefined;
    const voided = method === "next_month" && !adj;
    const amount = method === "next_month" ? adj?.amount ?? 0 : typeof d.amount === "number" ? d.amount : 0;
    const list = settlementsOf.get(d.driverId as string) ?? [];
    list.push({
      id: l.id,
      method,
      amount,
      at: l.createdAt,
      userName: l.userId ? userName.get(l.userId) ?? null : null,
      nextMonth: method === "next_month" ? (adj?.month ?? (typeof d.nextMonth === "string" ? d.nextMonth : null)) : null,
      adjustmentId,
      voided,
      settledOn: typeof d.settledOn === "string" ? d.settledOn : null,
      note: typeof d.note === "string" && d.note ? d.note : null,
    });
    settlementsOf.set(d.driverId as string, list);
  }

  const paidBy = new Map<string, { paid: number; versions: Set<number>; on: Set<string>; name: string | null }>();
  for (const l of paidLines) {
    const p = paidBy.get(l.driverId) ?? { paid: 0, versions: new Set<number>(), on: new Set<string>(), name: null };
    p.paid += l.amount;
    if (l.version !== null) p.versions.add(l.version);
    p.on.add(l.executedOn);
    paidBy.set(l.driverId, p);
  }

  for (const [driverId, p] of paidBy) {
    const st = statementOf.get(driverId);
    const statementTotal = st?.total ?? 0;
    const difference = statementTotal - p.paid;
    const settlements = settlementsOf.get(driverId) ?? [];
    if (difference === 0 && settlements.length === 0) continue;
    const settled = settlements.reduce((a, x) => a + (x.voided ? 0 : x.amount), 0);
    const d = driverById.get(driverId);
    const snap = st ? readSnapshot(st) : null;
    report.rows.push({
      driverId,
      driverName: d?.name ?? snap?.driver?.name ?? "（不明）",
      driverCode: d?.code ?? snap?.driver?.code ?? null,
      paid: p.paid,
      paidVersions: [...p.versions].sort((a, b) => a - b),
      paidOn: [...p.on].sort(),
      statementId: st?.id ?? null,
      statementVersion: st?.version ?? null,
      statementTotal,
      difference,
      settlements,
      settled,
      outstanding: difference - settled,
    });
  }
  report.rows.sort((a, b) => (a.driverCode ?? "").localeCompare(b.driverCode ?? "", "ja") || a.driverName.localeCompare(b.driverName, "ja"));
  for (const r of report.rows) {
    if (r.outstanding === 0) continue;
    report.openCount++;
    if (r.outstanding > 0) report.underpaid += r.outstanding;
    else report.overpaid += -r.outstanding;
  }
  return report;
}

function versionsText(versions: number[]): string {
  return versions.length ? versions.map((v) => `第${v}版`).join("・") : "版の記録なし";
}

/** 翌月の調整の名前（60 文字まで） */
export function settlementLabel(month: string): string {
  return `${monthLabelJa(month)}分の精算（振込済みの額との差）`;
}

/** 翌月の調整の根拠（200 文字まで）：どの版の額を振り込み、どの版との差か */
export function settlementBasis(month: string, row: Pick<PaidDiffRow, "paid" | "paidVersions" | "paidOn" | "statementTotal" | "statementVersion">): string {
  const now = row.statementVersion === null ? "明細なし" : `明細 ${row.statementTotal.toLocaleString("ja-JP")}円（第${row.statementVersion}版）`;
  return `${monthLabelJa(month)}分：${row.paidOn.join("・")} に振り込んだ額 ${row.paid.toLocaleString("ja-JP")}円（${versionsText(row.paidVersions)}）と、${now}の差`;
}

export type SettleInput = {
  driverId: string;
  method: SettlementMethod;
  /** 画面で見た「まだ精算していない差」（開いたあとに変わっていたら止める） */
  expectedOutstanding: number;
  /** 別の方法で精算した日（outside のとき必須） */
  settledOn?: string | null;
  note?: string | null;
};

export type SettleResult = { amount: number; method: SettlementMethod; nextMonth: string | null; adjustmentId: string | null; driverName: string };

/** 操作の記録に直接書く（精算の記録は、それ自体が「どう精算したか」の記録なので、書けなかったら操作ごと止める） */
async function insertSettleLog(db: Db, entry: { tenantId: string; userId: string | null; action: string; entityId: string; detail: Record<string, unknown> }) {
  const [row] = await db
    .insert(s.auditLog)
    .values({ tenantId: entry.tenantId, userId: entry.userId, action: entry.action, entity: "driver", entityId: entry.entityId, detail: entry.detail })
    .returning({ id: s.auditLog.id });
  return row.id;
}

/**
 * 振り込んだ額と明細の額の差を精算したことを記録する。
 * - next_month：翌月の明細に調整を 1 行足す（消費税・源泉の対象にしない。差は税・源泉を含めた振込額どうしの差のため）
 * - outside：別の方法で精算した日とメモを残す（別に振り込んだ・返してもらった など）
 * 同じ差を二重に精算しないよう、会社の行に鍵をかけ、画面で見た差と今の差が同じときだけ記録する。
 */
export async function settlePaidDifference(db: Db, tenantId: string, month: string, input: SettleInput, userId: string | null): Promise<SettleResult> {
  assertMonth(month);
  if (!isUuid(input.driverId)) throw new UserError("ドライバーが見つかりません。画面を読み直してください");
  if (input.method !== "next_month" && input.method !== "outside") throw new UserError("精算の仕方を選んでください");
  if (!Number.isInteger(input.expectedOutstanding)) throw new UserError("画面を読み直してください");
  const settledOn = (input.settledOn ?? "").trim();
  const note = (input.note ?? "").trim();
  if (input.method === "outside") {
    if (!isDateString(settledOn)) throw new UserError("精算した日を正しい日付で入れてください（例：2026-12-10）");
    if (settledOn < month) throw new UserError("精算した日が、対象の月より前になっています。日付を確かめてください");
    if (note.length > 200) throw new UserError("メモは 200 文字までにしてください");
  }
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockTenant(t, tenantId);
    const report = await loadPaidDifferences(t, tenantId, month);
    const row = report.rows.find((r) => r.driverId === input.driverId);
    if (!row || row.outstanding === 0) throw new UserError("この人には、まだ精算していない差はありません。画面を読み直してください");
    if (row.outstanding !== input.expectedOutstanding) {
      throw new UserError(
        `画面を開いたあとに差が変わりました（いま ${row.outstanding < 0 ? "−" : ""}${Math.abs(row.outstanding).toLocaleString("ja-JP")}円）。画面を読み直して、もう一度確かめてください。`,
      );
    }
    const amount = row.outstanding;
    const base = {
      month,
      driverId: row.driverId,
      driverName: row.driverName,
      amount,
      paid: row.paid,
      paidVersions: row.paidVersions,
      paidOn: row.paidOn,
      statementId: row.statementId,
      statementVersion: row.statementVersion,
      statementTotal: row.statementTotal,
      difference: row.difference,
    };
    if (input.method === "next_month") {
      if (report.nextMonthClosed) {
        throw new UserError(`${monthLabelJa(report.nextMonth)}は締めてあるため、調整を足せません。別の方法で精算したら、その日を記録してください。`);
      }
      const label = settlementLabel(month);
      const basis = settlementBasis(month, row);
      const { row: adj, driver } = await addAdjustment(t, tenantId, report.nextMonth, {
        driverId: row.driverId,
        label,
        amount,
        taxable: false,
        // 払いすぎの分を差し引くときは、ご本人との合意の記録が要る（見張り番が合意の記録を確かめる）
        agreedInWriting: false,
        basis,
      });
      await audit(t, {
        tenantId,
        userId,
        action: "adjustment.add",
        entity: "adjustment",
        entityId: adj.id,
        detail: { month: report.nextMonth, driver: driver.name, driverId: driver.id, label, amount, taxable: false, agreedInWriting: false, basis, source: SETTLE_ACTION, settledMonth: month },
      });
      await insertSettleLog(t, { tenantId, userId, action: SETTLE_ACTION, entityId: row.driverId, detail: { ...base, method: "next_month", nextMonth: report.nextMonth, adjustmentId: adj.id } });
      return { amount, method: "next_month" as const, nextMonth: report.nextMonth, adjustmentId: adj.id, driverName: row.driverName };
    }
    await insertSettleLog(t, { tenantId, userId, action: SETTLE_ACTION, entityId: row.driverId, detail: { ...base, method: "outside", settledOn, note: note || null } });
    return { amount, method: "outside" as const, nextMonth: null, adjustmentId: null, driverName: row.driverName };
  });
}

/**
 * 「別の方法で精算した」記録を取り消す（記録は消さず、取り消したことを足す）。
 * 翌月の調整で精算したものは、その調整を「稼働と調整」で消すと精算にならなくなる（ここでは取り消さない）。
 */
export async function undoSettlement(db: Db, tenantId: string, month: string, settleId: number, userId: string | null): Promise<void> {
  assertMonth(month);
  if (!Number.isInteger(settleId) || settleId <= 0) throw new UserError("精算の記録が見つかりません。画面を読み直してください");
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockTenant(t, tenantId);
    const report = await loadPaidDifferences(t, tenantId, month);
    const target = report.rows.flatMap((r) => r.settlements.map((x) => ({ row: r, x }))).find((p) => p.x.id === settleId);
    if (!target) throw new UserError("精算の記録が見つかりません（すでに取り消したかもしれません）。画面を読み直してください");
    if (target.x.method === "next_month") {
      throw new UserError(`翌月の調整で精算した記録は、${monthLabelJa(target.x.nextMonth ?? report.nextMonth)}の「稼働と調整」でその調整を消すと、精算していない差に戻ります。`);
    }
    await insertSettleLog(t, {
      tenantId,
      userId,
      action: SETTLE_UNDO_ACTION,
      entityId: target.row.driverId,
      detail: { month, settleId, driverId: target.row.driverId, driverName: target.row.driverName, amount: target.x.amount, settledOn: target.x.settledOn },
    });
  });
}
