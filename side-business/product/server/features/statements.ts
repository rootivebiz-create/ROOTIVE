import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { deemedClauseMap, latestTermsByDriver } from "~/server/features/terms-content";
import { companyCopy, type CompanyCopy } from "~/server/features/statements/company-copy";
import { describeChanges } from "~/server/features/statements/diff";
import { buildVersionHistory, type VersionHistoryItem } from "~/server/features/statements/history";
import { deemedDaysOf, countStatuses, statementStatus, type StatementStatus, type StatusCounts } from "~/server/features/statements/status";
import { cleanBody, groupThreads, type Thread } from "~/server/features/statements/threads";
import {
  isLineKeyOf,
  isUuid,
  jpDateTime,
  linkExpiresAt,
  maskAccount,
  replyShareMessage,
  replyShareSubject,
  shareLinks,
  toDriverView,
  type DriverStatementView,
  type MaskedAccount,
} from "~/server/features/statements/view";
import { getTenant } from "~/server/repo";
import { readSnapshot } from "~/server/statements-core";
import { ipMarker, signStatementLink } from "~/server/tokens";

/**
 * 支払明細（会社の側）：一覧・中身・送った記録・リンクの作り直し・質問への返事と解決・確認の記録。
 * どの関数も (db, tenantId, …) を受け取り、必ず会社で絞る。画面から来た id は、その会社のものかを確かめてから使う。
 */

export type StatementRow = typeof s.statements.$inferSelect;
export type SendChannel = "copy" | "line" | "sms" | "mail" | "paper";

/** 会社で絞って明細を 1 件読む（他社の id なら null） */
export async function getStatementRow(db: Db, tenantId: string, id: string): Promise<StatementRow | null> {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function requireStatement(db: Db, tenantId: string, id: string): Promise<StatementRow> {
  const st = await getStatementRow(db, tenantId, id);
  if (!st) throw new UserError("明細が見つかりません。一覧から開き直してください");
  return st;
}

type ConfRow = { statementId: string; version: number; hash: string; createdAt: Date; totalAtConfirm: number; ipHash: string | null; userAgent: string | null };
type MsgRow = { statementId: string; createdAt: Date; resolvedAt: Date | null; readAt: Date | null };

async function loadConfirmations(db: Db, tenantId: string, ids: string[]): Promise<ConfRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      statementId: s.statementConfirmations.statementId,
      version: s.statementConfirmations.version,
      hash: s.statementConfirmations.hash,
      createdAt: s.statementConfirmations.createdAt,
      totalAtConfirm: s.statementConfirmations.totalAtConfirm,
      ipHash: s.statementConfirmations.ipHash,
      userAgent: s.statementConfirmations.userAgent,
    })
    .from(s.statementConfirmations)
    .where(and(eq(s.statementConfirmations.tenantId, tenantId), inArray(s.statementConfirmations.statementId, ids)))
    .orderBy(asc(s.statementConfirmations.createdAt));
}

async function loadDriverMessages(db: Db, tenantId: string, ids: string[]): Promise<MsgRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      statementId: s.statementMessages.statementId,
      createdAt: s.statementMessages.createdAt,
      resolvedAt: s.statementMessages.resolvedAt,
      readAt: s.statementMessages.readAt,
    })
    .from(s.statementMessages)
    .where(and(eq(s.statementMessages.tenantId, tenantId), inArray(s.statementMessages.statementId, ids), eq(s.statementMessages.author, "driver")));
}

function statusOf(st: StatementRow, confs: ConfRow[], msgs: MsgRow[], now: Date, deemedDays: number, deemedClause: boolean): StatementStatus {
  return statementStatus(
    {
      version: st.version,
      sentAt: st.sentAt,
      viewedAt: st.viewedAt,
      updatedAt: st.updatedAt,
      confirmations: confs.filter((c) => c.statementId === st.id),
      driverMessages: msgs.filter((m) => m.statementId === st.id),
      deemedClause,
    },
    now,
    deemedDays,
  );
}

/** ドライバーごとの「いちばん新しい取引条件の記録に、みなし確認の条項があるか」（terms-content にある。ここからも使える） */
export { deemedClauseMap };

// ---------------------------------------------------------------- 一覧

/** 並べる順は「よみ（かな）」のあいうえお順。よみが無ければ名前、同じなら番号 */
async function sortKeys(db: Db, tenantId: string, driverIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(driverIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: s.drivers.id, kana: s.drivers.kana, name: s.drivers.name })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), inArray(s.drivers.id, ids)));
  return new Map(rows.map((r) => [r.id, (r.kana || r.name).normalize("NFKC")]));
}

function compareDrivers(order: Map<string, string>, a: { driverId: string; name: string; code: string | null }, b: { driverId: string; name: string; code: string | null }): number {
  const ka = order.get(a.driverId) ?? a.name;
  const kb = order.get(b.driverId) ?? b.name;
  return ka.localeCompare(kb, "ja") || (a.code ?? "").localeCompare(b.code ?? "");
}

export type StatementListItem = {
  id: string;
  driverId: string;
  name: string;
  code: string | null;
  version: number;
  isPurchaseStatement: boolean;
  subtotal: number;
  tax: number;
  /** 控除（税込） */
  deductions: number;
  /** 調整（消費税を含む） */
  adjustments: number;
  withholding: number;
  total: number;
  sentAtText: string | null;
  viewedAtText: string | null;
  confirmedAtText: string | null;
  status: StatementStatus;
};

export type MonthTotals = { subtotal: number; tax: number; deductions: number; adjustments: number; withholding: number; total: number };

export type MonthStatements = { items: StatementListItem[]; totals: MonthTotals; counts: StatusCounts; deemedDays: number };

export async function listMonthStatements(db: Db, tenantId: string, month: string, now = new Date()): Promise<MonthStatements> {
  const tenant = await getTenant(db, tenantId);
  const deemedDays = deemedDaysOf(tenant.settings);
  const rows = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  const ids = rows.map((r) => r.id);
  const [confs, msgs, order, clauses] = await Promise.all([
    loadConfirmations(db, tenantId, ids),
    loadDriverMessages(db, tenantId, ids),
    sortKeys(db, tenantId, rows.map((r) => r.driverId)),
    deemedClauseMap(db, tenantId, rows.map((r) => r.driverId)),
  ]);

  const items: StatementListItem[] = rows.map((r) => {
    const d = readSnapshot(r);
    const status = statusOf(r, confs, msgs, now, deemedDays, clauses.get(r.driverId) === true);
    return {
      id: r.id,
      driverId: r.driverId,
      name: d.driver.name,
      code: d.driver.code,
      version: r.version,
      isPurchaseStatement: d.isPurchaseStatement,
      subtotal: r.subtotal,
      tax: r.tax,
      deductions: r.deductions,
      adjustments: d.adjustmentTotal + d.adjustmentTax,
      withholding: r.withholding,
      total: r.total,
      sentAtText: r.sentAt ? jpDateTime(r.sentAt) : null,
      viewedAtText: r.viewedAt ? jpDateTime(r.viewedAt) : null,
      confirmedAtText: status.confirmedAt ? jpDateTime(status.confirmedAt) : null,
      status,
    };
  });
  items.sort((a, b) => compareDrivers(order, a, b));

  return { items, totals: sumItems(items), counts: countStatuses(items.map((i) => i.status)), deemedDays };
}

/** 一覧の合計（円の整数を足すだけ。丸めはしない） */
export function sumItems(items: Pick<StatementListItem, keyof MonthTotals>[]): MonthTotals {
  const t: MonthTotals = { subtotal: 0, tax: 0, deductions: 0, adjustments: 0, withholding: 0, total: 0 };
  for (const i of items) {
    t.subtotal += i.subtotal;
    t.tax += i.tax;
    t.deductions += i.deductions;
    t.adjustments += i.adjustments;
    t.withholding += i.withholding;
    t.total += i.total;
  }
  return t;
}

// ---------------------------------------------------------------- 前の版との違い

/** 保存してある前の版を、ドライバーに見せる形で読む（無ければ null。会社で絞る） */
export async function versionView(db: Db, tenantId: string, statementId: string, version: number): Promise<DriverStatementView | null> {
  if (!isUuid(statementId) || !Number.isInteger(version) || version < 1) return null;
  const rows = await db
    .select({ snapshot: s.statementVersions.snapshot, hash: s.statementVersions.hash, version: s.statementVersions.version })
    .from(s.statementVersions)
    .where(and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.statementId, statementId), eq(s.statementVersions.version, version)))
    .limit(1);
  const row = rows[0];
  return row ? toDriverView(readSnapshot(row), row) : null;
}

export type VersionChanges = {
  /** 比べた前の版 */
  fromVersion: number;
  /** その版をドライバーが確認していたか */
  fromConfirmed: boolean;
  items: string[];
};

/**
 * 今の版と、比べるべき前の版の違い。確認した前の版があればそれと、無ければ 1 つ前の版と比べる。
 * 版が 1 つしか無い・前の版の写しが無いときは null。
 */
export async function changesSince(
  db: Db,
  tenantId: string,
  st: Pick<StatementRow, "id" | "version">,
  current: DriverStatementView,
  lastConfirmedVersion: number | null,
): Promise<VersionChanges | null> {
  const confirmedOlder = lastConfirmedVersion !== null && lastConfirmedVersion < st.version ? lastConfirmedVersion : null;
  const from = confirmedOlder ?? (st.version > 1 ? st.version - 1 : null);
  if (from === null) return null;
  const before = await versionView(db, tenantId, st.id, from);
  if (!before) return null;
  return { fromVersion: from, fromConfirmed: confirmedOlder !== null, items: describeChanges(before, current) };
}

/** その人の取引条件の記録（いちばん新しい版）に「みなし確認」の条項があるか。記録が無ければ null */
export async function deemedClauseOf(db: Db, tenantId: string, driverId: string): Promise<{ version: number; issuedOn: string; deemedClause: boolean } | null> {
  if (!isUuid(driverId)) return null;
  const r = (await latestTermsByDriver(db, tenantId, [driverId])).get(driverId);
  return r ? { version: r.version, issuedOn: r.issuedOn, deemedClause: r.deemedClause } : null;
}

// ---------------------------------------------------------------- 版の履歴

/**
 * 明細の版の履歴（会社で絞る）。どの版も statement_versions の写しから作り、となりの版の違いと、
 * どの版をいつ確認したかを並べる。今の版の写しが無い古いデータは、明細そのものの写しで補う。
 */
export async function loadVersionHistory(db: Db, tenantId: string, st: StatementRow): Promise<VersionHistoryItem[]> {
  // 他社の明細の行を渡されても、何も返さない（写しで補うときに他社の中身を出さない）
  if (st.tenantId !== tenantId) return [];
  const [versions, confs] = await Promise.all([
    db
      .select()
      .from(s.statementVersions)
      .where(and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.statementId, st.id)))
      .orderBy(asc(s.statementVersions.version)),
    loadConfirmations(db, tenantId, [st.id]),
  ]);
  const userIds = [...new Set(versions.map((v) => v.createdBy).filter((v): v is string => !!v))];
  const users = userIds.length
    ? await db
        .select({ id: s.users.id, name: s.users.name })
        .from(s.users)
        .where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, userIds)))
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const inputs = versions.map((v) => ({
    version: v.version,
    hash: v.hash,
    createdAt: v.createdAt,
    total: v.total,
    createdByName: v.createdBy ? nameOf.get(v.createdBy) ?? null : null,
    view: toDriverView(readSnapshot(v), v),
  }));
  if (!inputs.some((v) => v.version === st.version)) {
    inputs.push({ version: st.version, hash: st.hash, createdAt: st.updatedAt, total: st.total, createdByName: null, view: toDriverView(readSnapshot(st), st) });
  }
  return buildVersionHistory(
    inputs,
    confs.map((c) => ({ version: c.version, hash: c.hash, createdAt: c.createdAt, totalAtConfirm: c.totalAtConfirm })),
    st.version,
  );
}

// ---------------------------------------------------------------- 1 件の中身

export type ConfirmationView = { at: string; version: number; hashShort: string; total: number; ipShort: string | null; device: string | null; current: boolean };

export type StatementDetail = {
  statement: StatementRow;
  view: DriverStatementView;
  status: StatementStatus;
  threads: Thread[];
  confirmations: ConfirmationView[];
  contact: { phone: string | null; email: string | null };
  account: MaskedAccount | null;
  sentAtText: string | null;
  viewedAtText: string | null;
  updatedAtText: string;
  deemedDays: number;
  /** 前の版（確認した版があればその版）からの違い */
  changes: VersionChanges | null;
  /** 取引条件の記録の「みなし確認」の条項（記録が無ければ null） */
  terms: { version: number; issuedOn: string; deemedClause: boolean } | null;
  /** 版の履歴（新しい版が先頭） */
  history: VersionHistoryItem[];
  /** 会社の控え（売上・利益・経過措置の負担。ドライバーには見せない） */
  company: CompanyCopy;
  /** 会社の消費税の計算方法（いまの設定。general＝原則課税） */
  taxMethod: string;
};

/** 端末の目安（UA の全文は出さない） */
export function deviceHint(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  return "その他の端末";
}

export async function getStatementDetail(db: Db, tenantId: string, id: string, now = new Date()): Promise<StatementDetail | null> {
  const st = await getStatementRow(db, tenantId, id);
  if (!st) return null;
  const tenant = await getTenant(db, tenantId);
  const deemedDays = deemedDaysOf(tenant.settings);
  const view = toDriverView(readSnapshot(st), st);
  const [confs, messages, driverRows] = await Promise.all([
    loadConfirmations(db, tenantId, [st.id]),
    db
      .select()
      .from(s.statementMessages)
      .where(and(eq(s.statementMessages.tenantId, tenantId), eq(s.statementMessages.statementId, st.id)))
      .orderBy(asc(s.statementMessages.createdAt)),
    db
      .select()
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, st.driverId)))
      .limit(1),
  ]);
  const staffIds = [...new Set(messages.map((m) => m.authorUserId).filter((v): v is string => !!v))];
  const staff = staffIds.length
    ? await db
        .select({ id: s.users.id, name: s.users.name })
        .from(s.users)
        .where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, staffIds)))
    : [];
  const staffName = new Map(staff.map((u) => [u.id, u.name]));
  const driverMsgs = messages.filter((m) => m.author === "driver");
  const terms = await deemedClauseOf(db, tenantId, st.driverId);
  const status = statusOf(st, confs, driverMsgs.map((m) => ({ ...m, statementId: st.id })), now, deemedDays, terms?.deemedClause === true);
  const driver = driverRows[0];
  const [changes, history] = await Promise.all([changesSince(db, tenantId, st, view, status.lastConfirmedVersion), loadVersionHistory(db, tenantId, st)]);

  return {
    statement: st,
    view,
    status,
    threads: groupThreads(
      messages.map((m) => ({ ...m, authorName: m.authorUserId ? staffName.get(m.authorUserId) ?? null : null })),
      view,
    ),
    confirmations: confs
      .map((c) => ({
        at: jpDateTime(c.createdAt),
        version: c.version,
        hashShort: c.hash.slice(0, 12),
        total: c.totalAtConfirm,
        ipShort: c.ipHash ? ipMarker(c.ipHash) : null,
        device: deviceHint(c.userAgent),
        current: c.version === st.version,
      }))
      .reverse(),
    contact: { phone: driver?.phone ?? null, email: driver?.email ?? null },
    account: driver ? maskAccount(driver) : null,
    sentAtText: st.sentAt ? jpDateTime(st.sentAt) : null,
    viewedAtText: st.viewedAt ? jpDateTime(st.viewedAt) : null,
    updatedAtText: jpDateTime(st.updatedAt),
    deemedDays,
    changes,
    terms,
    history,
    company: companyCopy(readSnapshot(st)),
    taxMethod: tenant.taxMethod,
  };
}

// ---------------------------------------------------------------- リンク

/** 会社の画面でだけ作るドライバー用のリンクの値（その日のうちは同じ値。期限は 120 日） */
export function staffLinkToken(st: Pick<StatementRow, "id" | "linkNonce">, now = new Date()): { token: string; expiresAt: number } {
  const expiresAt = linkExpiresAt(now);
  return { token: signStatementLink(st.id, st.linkNonce, expiresAt), expiresAt };
}

/** 会社の画面で使う、ドライバー用のリンクの URL（origin は https://… の頭の部分） */
export function staffLinkUrl(origin: string, st: Pick<StatementRow, "id" | "linkNonce">, now = new Date()): string {
  return `${origin}/s/${staffLinkToken(st, now).token}`;
}

export type SendListItem = { id: string; name: string; code: string | null; url: string };

/**
 * 送る一覧（名前とリンク）。渡した id のうち、この会社・この月の明細だけ。並びは渡した順（一覧の並び）。
 * 1 人ずつ、その人とのトークに貼るためのもの（会社の画面でだけ作る）
 */
export async function sendListFor(db: Db, tenantId: string, month: string, ids: string[], origin: string, now = new Date()): Promise<SendListItem[]> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return [];
  const rows = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month), inArray(s.statements.id, valid)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return valid
    .map((id) => byId.get(id))
    .filter((r): r is StatementRow => !!r)
    .map((r) => {
      const d = readSnapshot(r);
      return { id: r.id, name: d.driver.name, code: d.driver.code, url: staffLinkUrl(origin, r, now) };
    });
}

export type ReplyShare = { url: string; message: string; links: { line: string; sms: string; mail: string }; hasPhone: boolean; hasEmail: boolean };

/**
 * 返事を書いたことをドライバーに知らせる文面とリンク（返事はドライバーに自動では届かない）。会社で絞る。
 * リンクは明細のリンクと同じ（新しく作り直さない）
 */
export async function replyShareFor(db: Db, tenantId: string, id: string, origin: string, now = new Date()): Promise<ReplyShare | null> {
  const st = await getStatementRow(db, tenantId, id);
  if (!st) return null;
  const [driver] = await db
    .select({ phone: s.drivers.phone, email: s.drivers.email })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.id, st.driverId)))
    .limit(1);
  const d = readSnapshot(st);
  const url = staffLinkUrl(origin, st, now);
  const message = replyShareMessage(d.driver.name, st.month, url);
  return {
    url,
    message,
    links: shareLinks({ message, subject: replyShareSubject(st.month, d.company.name), phone: driver?.phone ?? null, email: driver?.email ?? null }),
    hasPhone: !!driver?.phone,
    hasEmail: !!driver?.email,
  };
}

/**
 * 送った記録をつける（コピー・LINE・SMS・メール・紙で渡した）。
 * まだ送っていないか、送ったあとで中身が変わっていたときだけ日時を今にする（何度コピーしても最初の日時が残る）。
 */
export async function markStatementSent(db: Db, tenantId: string, id: string, userId: string | null, channel: SendChannel, now = new Date()) {
  const st = await requireStatement(db, tenantId, id);
  const refresh = !st.sentAt || st.sentAt.getTime() < st.updatedAt.getTime();
  // 作った直後に送ると、DB とアプリの時計のわずかなずれで「送ったあとで変わった」に見えることがあるので、作った時刻より前にしない
  const sentAt = new Date(Math.max(now.getTime(), st.updatedAt.getTime()));
  if (refresh) {
    await db
      .update(s.statements)
      .set({ sentAt })
      .where(and(eq(s.statements.id, st.id), eq(s.statements.tenantId, tenantId)));
  }
  await audit(db, {
    tenantId,
    userId,
    action: "statement.send",
    entity: "statement",
    entityId: st.id,
    detail: { channel, month: st.month, driverId: st.driverId, version: st.version, recorded: refresh },
  });
  return { sentAt: refresh ? sentAt : st.sentAt };
}

/**
 * リンクを作り直す：今までのリンクはすべて使えなくなる。送った・開いた記録は外す（確認の記録は残す）。
 *
 * ドライバーの画面からは、同じ人のほかの月の明細へも行ける（そのつど新しいリンクを作って出す）。
 * そのため、間違った相手に送った・人に知られたときは、ほかの月の明細のリンクも作り直さないと、
 * 先にたどって手元に残ったリンクで見られてしまう。allMonths のときは、同じ人のすべての明細のリンクを作り直す
 * （ほかの月は、送った・開いた記録はそのまま。新しいリンクの画面から、今までどおりたどれる）。
 */
export async function recreateStatementLink(db: Db, tenantId: string, id: string, userId: string | null, opts: { allMonths?: boolean } = {}) {
  const st = await requireStatement(db, tenantId, id);
  const nonce = randomBytes(16).toString("hex");
  await db
    .update(s.statements)
    .set({ linkNonce: nonce, sentAt: null, viewedAt: null })
    .where(and(eq(s.statements.id, st.id), eq(s.statements.tenantId, tenantId)));
  const others: { id: string; month: string }[] = [];
  if (opts.allMonths) {
    const rows = await db
      .select({ id: s.statements.id, month: s.statements.month })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, st.driverId), ne(s.statements.id, st.id)));
    // 明細ごとに別の値にする（1 つのリンクの値から、ほかの月のリンクを作れないように）
    for (const r of rows) {
      await db
        .update(s.statements)
        .set({ linkNonce: randomBytes(16).toString("hex") })
        .where(and(eq(s.statements.id, r.id), eq(s.statements.tenantId, tenantId)));
      others.push(r);
    }
  }
  await audit(db, {
    tenantId,
    userId,
    action: "statement.relink",
    entity: "statement",
    entityId: st.id,
    detail: {
      month: st.month,
      driverId: st.driverId,
      previousSentAt: st.sentAt?.toISOString() ?? null,
      previousViewedAt: st.viewedAt?.toISOString() ?? null,
      otherMonths: others.map((o) => o.month.slice(0, 7)).sort(),
    },
  });
  return { linkNonce: nonce, otherMonths: others.length };
}

// ---------------------------------------------------------------- 質問への返事・解決・既読

async function knownLineKey(db: Db, tenantId: string, st: StatementRow, lineKey: string): Promise<boolean> {
  if (isLineKeyOf(toDriverView(readSnapshot(st), st), lineKey)) return true;
  // 作り直しで消えた行の話にも返事ができるように、すでにある話の lineKey も認める
  const rows = await db
    .select({ id: s.statementMessages.id })
    .from(s.statementMessages)
    .where(and(eq(s.statementMessages.tenantId, tenantId), eq(s.statementMessages.statementId, st.id), eq(s.statementMessages.lineKey, lineKey)))
    .limit(1);
  return rows.length > 0;
}

function threadWhere(tenantId: string, statementId: string, lineKey: string | null) {
  return and(
    eq(s.statementMessages.tenantId, tenantId),
    eq(s.statementMessages.statementId, statementId),
    eq(s.statementMessages.author, "driver"),
    lineKey === null ? isNull(s.statementMessages.lineKey) : eq(s.statementMessages.lineKey, lineKey),
  );
}

export async function replyToDriver(db: Db, tenantId: string, id: string, userId: string | null, input: { lineKey: string | null; body: string }, now = new Date()) {
  const st = await requireStatement(db, tenantId, id);
  const body = cleanBody(input.body);
  if (!body) throw new UserError("返事は 1〜1,000 文字で書いてください");
  const lineKey = input.lineKey || null;
  if (lineKey && !(await knownLineKey(db, tenantId, st, lineKey))) throw new UserError("どの行への返事かが分かりません。画面を読み直してください");
  const [msg] = await db
    .insert(s.statementMessages)
    .values({ tenantId, statementId: st.id, author: "staff", authorUserId: userId, lineKey, body, createdAt: now })
    .returning({ id: s.statementMessages.id });
  // 返事をした話は読んだことにする
  await db
    .update(s.statementMessages)
    .set({ readAt: now })
    .where(and(threadWhere(tenantId, st.id, lineKey), isNull(s.statementMessages.readAt)));
  await audit(db, { tenantId, userId, action: "statement.reply", entity: "statement", entityId: st.id, detail: { messageId: msg.id, lineKey, length: body.length } });
  return { id: msg.id };
}

/** 話（lineKey ごと）を解決にする／未解決に戻す。数を返す */
export async function resolveThread(db: Db, tenantId: string, id: string, userId: string | null, lineKey: string | null, resolved: boolean, now = new Date()) {
  const st = await requireStatement(db, tenantId, id);
  const rows = await db
    .update(s.statementMessages)
    .set(resolved ? { resolvedAt: now, readAt: now } : { resolvedAt: null })
    .where(threadWhere(tenantId, st.id, lineKey))
    .returning({ id: s.statementMessages.id, readAt: s.statementMessages.readAt });
  await audit(db, { tenantId, userId, action: resolved ? "statement.resolve" : "statement.reopen_question", entity: "statement", entityId: st.id, detail: { lineKey, count: rows.length } });
  return { count: rows.length };
}

/** 会社の人が開いたら、ドライバーからの質問を「読んだ」にする */
export async function markQuestionsRead(db: Db, tenantId: string, id: string, now = new Date()): Promise<number> {
  if (!isUuid(id)) return 0;
  const rows = await db
    .update(s.statementMessages)
    .set({ readAt: now })
    .where(
      and(
        eq(s.statementMessages.tenantId, tenantId),
        eq(s.statementMessages.statementId, id),
        eq(s.statementMessages.author, "driver"),
        isNull(s.statementMessages.readAt),
      ),
    )
    .returning({ id: s.statementMessages.id });
  return rows.length;
}

// ---------------------------------------------------------------- 出力（PDF・確認の記録）

export type PdfSource = { view: DriverStatementView; confirmationText: string; account: MaskedAccount | null };

function confirmationText(st: StatementRow, confs: ConfRow[]): string {
  const mine = confs.filter((c) => c.statementId === st.id);
  const current = mine.filter((c) => c.version === st.version);
  if (current.length > 0) return `ドライバーの確認：${jpDateTime(current[0].createdAt)}（版 ${st.version}）`;
  if (mine.length > 0) {
    const last = mine[mine.length - 1];
    return `ドライバーの確認：前の版（版 ${last.version}）を ${jpDateTime(last.createdAt)} に確認。今の版は未確認`;
  }
  return "ドライバーの確認：記録はまだありません";
}

async function pdfSources(db: Db, tenantId: string, rows: StatementRow[]): Promise<PdfSource[]> {
  const confs = await loadConfirmations(db, tenantId, rows.map((r) => r.id));
  const driverIds = [...new Set(rows.map((r) => r.driverId))];
  const drivers = driverIds.length
    ? await db
        .select()
        .from(s.drivers)
        .where(and(eq(s.drivers.tenantId, tenantId), inArray(s.drivers.id, driverIds)))
    : [];
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const order = new Map(drivers.map((d) => [d.id, (d.kana || d.name).normalize("NFKC")]));
  return rows
    .map((r) => {
      const d = byId.get(r.driverId);
      const view = toDriverView(readSnapshot(r), r);
      return { key: { driverId: r.driverId, name: view.driver.name, code: view.driver.code }, source: { view, confirmationText: confirmationText(r, confs), account: d ? maskAccount(d) : null } };
    })
    .sort((a, b) => compareDrivers(order, a.key, b.key))
    .map((x) => x.source);
}

export async function statementPdfSource(db: Db, tenantId: string, id: string): Promise<PdfSource | null> {
  const st = await getStatementRow(db, tenantId, id);
  if (!st) return null;
  return (await pdfSources(db, tenantId, [st]))[0];
}

export async function monthPdfSources(db: Db, tenantId: string, month: string): Promise<PdfSource[]> {
  const rows = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  return pdfSources(db, tenantId, rows);
}

export const CONFIRMATION_CSV_HEADER = [
  "月",
  "コード",
  "ドライバー",
  "明細の版（今）",
  "ハッシュ（今）",
  "振込額（今）",
  "状態",
  "送付日時",
  "開いた日時（今の中身を初めて）",
  "確認日時",
  "確認した版",
  "確認したハッシュ",
  "確認時の振込額",
  "接続元の目印（IPから作った8文字）",
  "端末",
];

/** 確認の記録（CSV の行）。確認 1 回ごとに 1 行、確認の無い明細も 1 行 */
export async function confirmationRecordRows(db: Db, tenantId: string, month: string, now = new Date()): Promise<(string | number)[][]> {
  const list = await listMonthStatements(db, tenantId, month, now);
  const rows = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const confs = await loadConfirmations(db, tenantId, rows.map((r) => r.id));
  const out: (string | number)[][] = [CONFIRMATION_CSV_HEADER];
  const label = month.slice(0, 7);
  for (const item of list.items) {
    const st = byId.get(item.id)!;
    const viewed = item.viewedAtText ? (item.status.viewedCurrent ? item.viewedAtText : `前の中身を ${item.viewedAtText} に開いた（今の中身はまだ）`) : "";
    const base = [label, item.code ?? "", item.name, st.version, st.hash, st.total, item.status.label, item.sentAtText ?? "", viewed];
    const mine = confs.filter((c) => c.statementId === st.id);
    if (mine.length === 0) out.push([...base, "", "", "", "", "", ""]);
    for (const c of mine) {
      out.push([...base, jpDateTime(c.createdAt), c.version, c.hash, c.totalAtConfirm, c.ipHash ? ipMarker(c.ipHash) : "", deviceHint(c.userAgent) ?? ""]);
    }
  }
  return out;
}
