import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { csvText, type CsvCell } from "~/server/download";
import type { PdfSource, StatementRow } from "~/server/features/statements";
import { changesSince, deviceHint } from "~/server/features/statements";
import { compareMonths, type MonthCompare } from "~/server/features/statements/compare";
import { cleanBody, groupThreads, type Thread } from "~/server/features/statements/threads";
import {
  isLineKeyOf,
  isUuid,
  jpDateTime,
  scheduledPayDate,
  jpMonthLabel,
  jpShortDateTime,
  linkExpiresAt,
  maskAccount,
  toDriverView,
  type DriverStatementView,
  type MaskedAccount,
} from "~/server/features/statements/view";
import { shiftMonth } from "~/server/month";
import { tooMany } from "~/server/rate-limit";
import { readSnapshot } from "~/server/statements-core";
import { signStatementLink, verifyStatementLink } from "~/server/tokens";

/**
 * ドライバーの画面（ログインなし）。入口は署名つきのリンクだけ。
 * - 毎回 verifyStatementLink（署名・期限）と、明細の link_nonce が同じかを確かめる（作り直したリンクは通さない）
 * - 画面から来た id は使わない。明細はリンクの中の id からだけ決め、そこから会社（tenant）を決める
 * - 見せるのはその明細と、同じドライバー・同じ会社の明細の数字だけ。会社の利益・売上は出さない
 * - ほかの月の明細は「締めた月」か「会社がもう送った明細」だけ（作りかけの明細を先に見せない）。
 *   それぞれのリンクは、ここで明細ごとに署名して作る（リンクの値に別の明細の id を入れて開くことはできない）
 */

export const LINK_UNUSABLE = "このリンクは使えません（期限切れ・作り直し）。会社に新しいリンクをお願いしてください";
export const TOO_MANY = "短い時間に何度も送られました。少し時間をおいてから、もう一度お試しください";
export const STALE_VERSION = "明細が新しくなっています。画面を読み直して、中身をもう一度ご確認ください";

export type PortalContext = {
  now?: Date;
  ipHash?: string | null;
  userAgent?: string | null;
  /** 会社の人がログインしたまま開いている（本人の操作として記録しない） */
  byStaff?: boolean;
};

/** リンクの値から明細を探す。署名・期限・nonce のどれかが合わなければ null（どれが違ったかは返さない） */
export async function findStatementByToken(db: Db, token: string, now = new Date()): Promise<StatementRow | null> {
  if (typeof token !== "string" || token.length > 600) return null;
  const check = verifyStatementLink(token, Math.floor(now.getTime() / 1000));
  if (!check.ok || !isUuid(check.statementId)) return null;
  const rows = await db.select().from(s.statements).where(eq(s.statements.id, check.statementId)).limit(1);
  const st = rows[0];
  if (!st || st.linkNonce !== check.nonce) return null;
  return st;
}

async function requirePortalStatement(db: Db, token: string, now: Date): Promise<StatementRow> {
  const st = await findStatementByToken(db, token, now);
  if (!st) throw new UserError(LINK_UNUSABLE);
  return st;
}

/** リンクの下見（LINE などが送るときに中身を取りに来る）を「開いた」と数えない */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return /bot|crawl|spider|slurp|facebookexternalhit|line-poker|preview|embedly|whatsapp|skypeuri|headless|curl|wget|python|go-http|okhttp|java\//i.test(ua);
}

// ---------------------------------------------------------------- 画面に出すもの

export type AnnualRow = {
  month: string;
  label: string;
  subtotal: number;
  tax: number;
  deductions: number;
  adjustments: number;
  withholding: number;
  total: number;
  payDate: string;
  current: boolean;
};

export type PortalData = {
  companyName: string;
  view: DriverStatementView;
  closed: boolean;
  /** 今の版を確認した記録 */
  confirmed: { at: string; version: number } | null;
  /** 前の版だけ確認している（そのあと中身が変わった） */
  confirmedOlder: { at: string; version: number } | null;
  /** 確認した前の版から、何が変わったか（短い文。「前に確認した内容からの変更」） */
  changes: string[];
  threads: Thread[];
  unreadReplies: number;
  account: MaskedAccount | null;
  year: { year: string; rows: AnnualRow[] };
  linkExpiresText: string;
  /** 先月の明細との比べ（先月の明細が無い・まだ見せられないときは null） */
  compare: MonthCompare | null;
  /** 同じ人のほかの月の明細（直近 12 か月。新しい月が上） */
  others: OtherStatement[];
};

export type OtherStatement = { month: string; label: string; total: number; payDate: string; href: string; confirmed: boolean };

/** ほかの月の明細を見せる範囲（この明細の月の前後 12 か月） */
export const OTHER_MONTHS = 12;

export async function loadPortal(db: Db, token: string, now = new Date()): Promise<PortalData | null> {
  const st = await findStatementByToken(db, token, now);
  if (!st) return null;
  const check = verifyStatementLink(token, Math.floor(now.getTime() / 1000));
  const tenantId = st.tenantId;
  const [tenantRows, closeRows, confs, messages, driverRows, year] = await Promise.all([
    db.select({ name: s.tenants.name }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1),
    db
      .select({ status: s.monthCloses.status })
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, st.month)))
      .limit(1),
    db
      .select()
      .from(s.statementConfirmations)
      .where(and(eq(s.statementConfirmations.tenantId, tenantId), eq(s.statementConfirmations.statementId, st.id)))
      .orderBy(asc(s.statementConfirmations.createdAt)),
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
    annualRowsFor(db, st),
  ]);
  const view = toDriverView(readSnapshot(st), st);
  // ほかの月のリンクは、いま開いているリンクより長く使えるようにしない（たどり直しで期限を延ばせないように）
  const { compare, others } = await otherMonthsFor(db, st, view, now, check.ok ? check.expiresAt : 0);
  const current = confs.find((c) => c.version === st.version);
  const older = confs.filter((c) => c.version < st.version).at(-1);
  const changes = !current && older ? await changesSince(db, tenantId, st, view, older.version) : null;
  // ドライバーの画面では、事務の人の名前は出さない（「会社」とだけ出す）
  const threads = groupThreads(
    messages.map((m) => ({ ...m, authorName: null })),
    view,
  );
  return {
    companyName: tenantRows[0]?.name ?? "",
    view,
    closed: closeRows[0]?.status === "closed",
    confirmed: current ? { at: jpShortDateTime(current.createdAt), version: current.version } : null,
    confirmedOlder: !current && older ? { at: jpShortDateTime(older.createdAt), version: older.version } : null,
    changes: changes?.items ?? [],
    threads,
    unreadReplies: threads.reduce((n, t) => n + t.unreadReplies, 0),
    account: driverRows[0] ? maskAccount(driverRows[0]) : null,
    year,
    linkExpiresText: check.ok ? jpDateTime(new Date(check.expiresAt * 1000)) : "",
    compare,
    others,
  };
}

// ---------------------------------------------------------------- 先月との比べ・ほかの月の明細

/**
 * 同じ会社・同じドライバーの、ほかの月の明細（締めた月か、会社が送った明細だけ）。
 * 先月の明細があれば、振込額と案件ごとの数量を並べる。リンクは明細ごとに、その明細の nonce で署名する。
 * リンクの期限は、いま開いているリンクの期限を超えない（A → B → A とたどり直しても、期限は延びない。
 * 延ばせるのは、会社が新しいリンクを作って送ったときだけ）
 */
export function otherMonthExpiresAt(now: Date, openedExpiresAt: number): number {
  return Math.min(openedExpiresAt, linkExpiresAt(now));
}

async function otherMonthsFor(
  db: Db,
  st: StatementRow,
  view: DriverStatementView,
  now: Date,
  openedExpiresAt: number,
): Promise<{ compare: MonthCompare | null; others: OtherStatement[] }> {
  const from = shiftMonth(st.month, -OTHER_MONTHS);
  const to = shiftMonth(st.month, OTHER_MONTHS);
  const rows = await db
    .select()
    .from(s.statements)
    .where(
      and(
        eq(s.statements.tenantId, st.tenantId),
        eq(s.statements.driverId, st.driverId),
        ne(s.statements.id, st.id),
        gte(s.statements.month, from),
        lte(s.statements.month, to),
      ),
    )
    .orderBy(desc(s.statements.month));
  if (rows.length === 0) return { compare: null, others: [] };
  const months = [...new Set(rows.map((r) => r.month))];
  const ids = rows.map((r) => r.id);
  const [closes, confs] = await Promise.all([
    db
      .select({ month: s.monthCloses.month })
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, st.tenantId), eq(s.monthCloses.status, "closed"), inArray(s.monthCloses.month, months))),
    db
      .select({ statementId: s.statementConfirmations.statementId, version: s.statementConfirmations.version })
      .from(s.statementConfirmations)
      .where(and(eq(s.statementConfirmations.tenantId, st.tenantId), inArray(s.statementConfirmations.statementId, ids))),
  ]);
  const closed = new Set(closes.map((c) => c.month));
  const visible = rows.filter((r) => closed.has(r.month) || r.sentAt !== null);
  const expiresAt = otherMonthExpiresAt(now, openedExpiresAt);
  const others = visible.map((r) => ({
    month: r.month,
    label: jpMonthLabel(r.month),
    total: r.total,
    payDate: scheduledPayDate(readSnapshot(r).payDate),
    href: `/s/${signStatementLink(r.id, r.linkNonce, expiresAt)}`,
    confirmed: confs.some((c) => c.statementId === r.id && c.version === r.version),
  }));
  const prev = visible.find((r) => r.month === shiftMonth(st.month, -1));
  return { compare: prev ? compareMonths(toDriverView(readSnapshot(prev), prev), view) : null, others };
}

// ---------------------------------------------------------------- 開いた記録

/**
 * 画面が開かれたことを記録する（初めてのときだけ viewed_at）。事務からの返事は「読んだ」にする。
 * 下見の仕組み・会社の人のログイン中・回数の多すぎは記録しない（エラーにもしない）。
 */
export async function recordPortalView(db: Db, token: string, ctx: PortalContext = {}): Promise<{ recorded: boolean }> {
  const now = ctx.now ?? new Date();
  if (ctx.byStaff || isBotUserAgent(ctx.userAgent)) return { recorded: false };
  if (tooMany(`portal:view:${ctx.ipHash ?? "unknown"}`, 60, 10 * 60_000, now.getTime())) return { recorded: false };
  const st = await findStatementByToken(db, token, now);
  if (!st) return { recorded: false };
  let recorded = false;
  // 初めて開いたとき、または前に開いたあとで中身が変わったとき（今の中身を初めて開いた日時にする）
  if (!st.viewedAt || st.viewedAt.getTime() < st.updatedAt.getTime()) {
    const viewedAt = new Date(Math.max(now.getTime(), st.updatedAt.getTime()));
    const rows = await db
      .update(s.statements)
      .set({ viewedAt })
      .where(
        and(
          eq(s.statements.id, st.id),
          eq(s.statements.tenantId, st.tenantId),
          or(isNull(s.statements.viewedAt), lt(s.statements.viewedAt, s.statements.updatedAt)),
        ),
      )
      .returning({ id: s.statements.id });
    recorded = rows.length > 0;
    if (recorded) {
      await audit(db, {
        tenantId: st.tenantId,
        action: "statement.view",
        entity: "statement",
        entityId: st.id,
        detail: { by: "driver", month: st.month, driverId: st.driverId, version: st.version, again: !!st.viewedAt, device: deviceHint(ctx.userAgent ?? null) },
      });
    }
  }
  await db
    .update(s.statementMessages)
    .set({ readAt: now })
    .where(
      and(
        eq(s.statementMessages.tenantId, st.tenantId),
        eq(s.statementMessages.statementId, st.id),
        eq(s.statementMessages.author, "staff"),
        isNull(s.statementMessages.readAt),
      ),
    );
  return { recorded };
}

// ---------------------------------------------------------------- 「内容を確認しました」

export type ConfirmResult = { at: string; version: number; already: boolean };

/**
 * 確認の記録を残す。画面に出ていた版が今の版と同じときだけ保存する（古い画面のまま押しても記録しない）。
 * 同じ版を 2 回押しても 1 件。
 */
export async function confirmFromPortal(db: Db, token: string, input: { version: number }, ctx: PortalContext = {}): Promise<ConfirmResult> {
  const now = ctx.now ?? new Date();
  if (ctx.byStaff) throw new UserError("会社の方のログイン中は押せません。「内容を確認しました」はドライバーご本人が押してください（ご本人が会社の方でもあるときは、ログアウトしてから開き直してください）");
  const st = await requirePortalStatement(db, token, now);
  if (tooMany(`portal:confirm:${ctx.ipHash ?? "unknown"}:${st.id}`, 10, 10 * 60_000, now.getTime())) throw new UserError(TOO_MANY);
  if (!Number.isInteger(input.version) || input.version !== st.version) throw new UserError(STALE_VERSION);

  // 明細の行を押さえてから確かめて書く（2 回同時に押しても 1 件・作り直しの途中の版を確認にしない）
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ version: s.statements.version, hash: s.statements.hash, total: s.statements.total, linkNonce: s.statements.linkNonce })
      .from(s.statements)
      .where(and(eq(s.statements.id, st.id), eq(s.statements.tenantId, st.tenantId)))
      .for("update");
    if (!locked || locked.linkNonce !== st.linkNonce) throw new UserError(LINK_UNUSABLE);
    if (locked.version !== input.version) throw new UserError(STALE_VERSION);
    const existing = await tx
      .select({ createdAt: s.statementConfirmations.createdAt })
      .from(s.statementConfirmations)
      .where(
        and(
          eq(s.statementConfirmations.tenantId, st.tenantId),
          eq(s.statementConfirmations.statementId, st.id),
          eq(s.statementConfirmations.version, locked.version),
          eq(s.statementConfirmations.hash, locked.hash),
        ),
      )
      .limit(1);
    if (existing[0]) return { at: jpShortDateTime(existing[0].createdAt), version: locked.version, already: true };
    const [row] = await tx
      .insert(s.statementConfirmations)
      .values({
        tenantId: st.tenantId,
        statementId: st.id,
        totalAtConfirm: locked.total,
        version: locked.version,
        hash: locked.hash,
        ipHash: ctx.ipHash ?? null,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
        createdAt: now,
      })
      .returning({ id: s.statementConfirmations.id });
    await audit(tx as unknown as Db, {
      tenantId: st.tenantId,
      action: "statement.confirm",
      entity: "statement",
      entityId: st.id,
      detail: { by: "driver", confirmationId: row.id, month: st.month, driverId: st.driverId, version: locked.version, hash: locked.hash, total: locked.total },
    });
    return { at: jpShortDateTime(now), version: locked.version, already: false };
  });
}

// ---------------------------------------------------------------- 質問

export async function askFromPortal(db: Db, token: string, input: { lineKey: string | null; body: string }, ctx: PortalContext = {}) {
  const now = ctx.now ?? new Date();
  if (ctx.byStaff) throw new UserError("会社の方のログイン中は送れません。質問はドライバーご本人が送ってください（ご本人が会社の方でもあるときは、ログアウトしてから開き直してください）");
  const st = await requirePortalStatement(db, token, now);
  if (
    tooMany(`portal:ask:${ctx.ipHash ?? "unknown"}:${st.id}`, 10, 10 * 60_000, now.getTime()) ||
    tooMany(`portal:ask-day:${st.id}`, 40, 24 * 3600_000, now.getTime())
  ) {
    throw new UserError(TOO_MANY);
  }
  const body = cleanBody(input.body);
  if (!body) throw new UserError("質問は 1〜1,000 文字で書いてください");
  const lineKey = input.lineKey || null;
  const view = toDriverView(readSnapshot(st), st);
  if (lineKey && !isLineKeyOf(view, lineKey)) throw new UserError("明細が新しくなっています。画面を読み直してから、もう一度お送りください");
  const [msg] = await db
    .insert(s.statementMessages)
    .values({ tenantId: st.tenantId, statementId: st.id, author: "driver", lineKey, body, createdAt: now })
    .returning({ id: s.statementMessages.id });
  await audit(db, {
    tenantId: st.tenantId,
    action: "statement.question",
    entity: "statement",
    entityId: st.id,
    detail: { by: "driver", messageId: msg.id, lineKey, length: body.length, month: st.month, driverId: st.driverId },
  });
  return { id: msg.id };
}

// ---------------------------------------------------------------- 今年の支払の一覧（CSV）

/** 同じ会社・同じドライバーの、この明細の年の明細（締めた月と、この明細） */
async function annualRowsFor(db: Db, st: StatementRow): Promise<{ year: string; rows: AnnualRow[] }> {
  const year = st.month.slice(0, 4);
  const from = `${year}-01-01`;
  const to = `${year}-12-01`;
  const [rows, closes] = await Promise.all([
    db
      .select()
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, st.tenantId), eq(s.statements.driverId, st.driverId), gte(s.statements.month, from), lte(s.statements.month, to)))
      .orderBy(asc(s.statements.month)),
    db
      .select({ month: s.monthCloses.month })
      .from(s.monthCloses)
      .where(and(eq(s.monthCloses.tenantId, st.tenantId), eq(s.monthCloses.status, "closed"), gte(s.monthCloses.month, from), lte(s.monthCloses.month, to))),
  ]);
  const closed = new Set(closes.map((c) => c.month));
  return {
    year,
    rows: rows
      .filter((r) => r.id === st.id || closed.has(r.month))
      .map((r) => {
        const d = readSnapshot(r);
        return {
          month: r.month,
          label: jpMonthLabel(r.month),
          subtotal: r.subtotal,
          tax: r.tax,
          deductions: r.deductions,
          adjustments: d.adjustmentTotal + d.adjustmentTax,
          withholding: r.withholding,
          total: r.total,
          // 振込予定日（銀行の休みの日なら前の営業日。明細の画面と同じ）
          payDate: scheduledPayDate(d.payDate),
          current: r.id === st.id,
        };
      }),
  };
}

export const ANNUAL_CSV_HEADER = ["月", "委託料（税抜）", "消費税", "控除（税込）", "調整", "源泉徴収", "振込額", "振込予定日"];

export function annualCsvText(rows: AnnualRow[]): string {
  const sum = (k: keyof Pick<AnnualRow, "subtotal" | "tax" | "deductions" | "adjustments" | "withholding" | "total">) => rows.reduce((n, r) => n + r[k], 0);
  const body: CsvCell[][] = [
    ANNUAL_CSV_HEADER,
    ...rows.map((r) => [r.label, r.subtotal, r.tax, r.deductions, r.adjustments, r.withholding, r.total, r.payDate]),
    ["合計", sum("subtotal"), sum("tax"), sum("deductions"), sum("adjustments"), sum("withholding"), sum("total"), ""],
  ];
  return csvText(body);
}

/** CSV の中身とファイル名。リンクが使えなければ null */
export async function annualCsvForToken(db: Db, token: string, ctx: PortalContext = {}): Promise<{ text: string; fileName: string } | null> {
  const now = ctx.now ?? new Date();
  const st = await findStatementByToken(db, token, now);
  if (!st) return null;
  if (tooMany(`portal:file:${ctx.ipHash ?? "unknown"}`, 30, 10 * 60_000, now.getTime())) throw new UserError(TOO_MANY);
  const { year, rows } = await annualRowsFor(db, st);
  const name = readSnapshot(st).driver.name;
  await audit(db, {
    tenantId: st.tenantId,
    action: "statement.annual_csv",
    entity: "statement",
    entityId: st.id,
    detail: { by: ctx.byStaff ? "staff_preview" : "driver", year, months: rows.map((r) => r.month) },
  });
  return { text: annualCsvText(rows), fileName: `支払の一覧_${year}年_${name}.csv` };
}

/** ドライバーの PDF の元。リンクが使えなければ null */
export async function portalPdfSource(db: Db, token: string, ctx: PortalContext = {}): Promise<{ source: PdfSource; fileName: string } | null> {
  const now = ctx.now ?? new Date();
  const st = await findStatementByToken(db, token, now);
  if (!st) return null;
  if (tooMany(`portal:file:${ctx.ipHash ?? "unknown"}`, 30, 10 * 60_000, now.getTime())) throw new UserError(TOO_MANY);
  const [confs, drivers] = await Promise.all([
    db
      .select()
      .from(s.statementConfirmations)
      .where(and(eq(s.statementConfirmations.tenantId, st.tenantId), eq(s.statementConfirmations.statementId, st.id)))
      .orderBy(asc(s.statementConfirmations.createdAt)),
    db
      .select()
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, st.tenantId), eq(s.drivers.id, st.driverId)))
      .limit(1),
  ]);
  const view = toDriverView(readSnapshot(st), st);
  const current = confs.find((c) => c.version === st.version);
  await audit(db, {
    tenantId: st.tenantId,
    action: "statement.pdf",
    entity: "statement",
    entityId: st.id,
    detail: { by: ctx.byStaff ? "staff_preview" : "driver", version: st.version },
  });
  return {
    source: {
      view,
      confirmationText: current ? `ドライバーの確認：${jpDateTime(current.createdAt)}（版 ${st.version}）` : "ドライバーの確認：この版の記録はまだありません",
      account: drivers[0] ? maskAccount(drivers[0]) : null,
    },
    fileName: `支払明細_${jpMonthLabel(st.month)}_${view.driver.name}_版${st.version}.pdf`,
  };
}
