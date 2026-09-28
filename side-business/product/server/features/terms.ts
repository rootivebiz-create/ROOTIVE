import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import type { Role } from "~/server/auth";
import { buildTermsContent, compareTermsContent, latestTermsByDriver, type TermsContent } from "~/server/features/terms-content";
import {
  changeText,
  describeVersionChanges,
  paymentWordingProblem,
  readSubcontract,
  readTermsContent,
  shortTermsHash,
  notExtra,
  termsExtraChanges,
  termsHash,
  unlistedWorkText,
  type StoredTermsContent,
  type TermsDocument,
  type TermsSubcontract,
} from "~/server/features/terms/document";
import { jpDateTimeJst, todayJst } from "~/server/features/terms/links";
import { isUuid, termsBulkSchema, termsChannelSchema, termsVersionSchema, type TermsBulkInput, type TermsChannel, type TermsVersionInput } from "~/server/features/terms/schema";
import { termsStatusOf, type TermsStatusKey } from "~/server/features/terms/status";
import { shiftMonth } from "~/server/month";
import { getTenant } from "~/server/repo";
import { paymentDeadlineCheck, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";

/**
 * 取引条件の明示（フリーランス法 第3条）の記録：明示書の版・送付・ドライバーの「受け取りました」。
 *
 * - 中身は台帳（案件の単価・控除・支払日）から buildTermsContent で組み立て、版ごとに写しを terms_records に残す
 * - 版は 1 人ずつ 1, 2, 3 …（同じ会社・同じ人・同じ版は DB が 1 つに止める）。前の版は書き換えない
 * - drivers.terms_issued_on は「最初に明示した日」。空か、今回の日より後のときだけ入れる（後ろへはずらさない）
 * - どの関数も会社（tenant）で絞る。画面から来た id は、その会社のものか必ず確かめる
 * - 作る・送るは事務以上（見るだけの人は、Server Action だけでなくここでも止める）
 */

export type TermsRecordRow = typeof s.termsRecords.$inferSelect;
type DriverRow = typeof s.drivers.$inferSelect;

/** 操作した人（役割はここでも確かめる） */
export type TermsActor = { userId: string | null; role: Role };

export const TERMS_NO_PERMISSION = "見るだけの役割では、取引条件の明示書を作ったり送ったりできません。事務・オーナーの方にお願いしてください";
export const TERMS_DRIVER_NOT_FOUND = "ドライバーが見つかりません。一覧から開き直してください";
export const TERMS_RECORD_NOT_FOUND = "明示書が見つかりません。一覧から開き直してください";
export const TERMS_RACE = "ほかの人が先に新しい版を作りました。画面を読み直して、中身を確かめてからもう一度お試しください";

/** 給付を受け取る場所の、はじめの文（会社ごとに書き換える前提） */
export const DEFAULT_PLACE = "委託者が指定する配送先（集荷の場所と配送の地域は、案件ごとに前もってお知らせします）";

const RANK: Record<Role, number> = { viewer: 1, staff: 2, owner: 3 };

function assertStaff(actor: TermsActor) {
  if (!actor || !(RANK[actor.role] >= RANK.staff)) throw new UserError(TERMS_NO_PERMISSION);
}

function toDay(n: number): DayOfMonth {
  return n >= 1 && n <= 30 ? n : "末";
}

function toOffset(n: number): PayMonthOffset {
  return n <= 0 ? 0 : n >= 2 ? 2 : 1;
}

function monthOf(now: Date): string {
  return `${todayJst(now).slice(0, 7)}-01`;
}

/** 会社の設定の支払期日の文言に「まで」「以内」があれば、その言葉と文 */
function contractWordingOf(text: string | null | undefined): { words: string[]; text: string } | null {
  const t = (text ?? "").trim();
  const words = paymentWordingProblem(t);
  return words.length ? { words, text: t.length > 80 ? `${t.slice(0, 80)}…` : t } : null;
}

/** 今日までの日付ならそのまま、先の日付や空なら null */
function pastOrToday(date: string | null | undefined, today: string): string | null {
  return date && date <= today ? date : null;
}

/** 少しずつ並べて処理する（DB につなぐ数を増やしすぎない） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function driverOf(db: Db, tenantId: string, driverId: string): Promise<DriverRow | null> {
  if (!isUuid(driverId)) return null;
  const rows = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.id, driverId), eq(s.drivers.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** 明示書の記録（その会社のものだけ） */
export async function getTermsRecord(db: Db, tenantId: string, id: string): Promise<TermsRecordRow | null> {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(s.termsRecords)
    .where(and(eq(s.termsRecords.id, id), eq(s.termsRecords.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

async function requireRecord(db: Db, tenantId: string, id: string): Promise<TermsRecordRow> {
  const rec = await getTermsRecord(db, tenantId, id);
  if (!rec) throw new UserError(TERMS_RECORD_NOT_FOUND);
  return rec;
}

/** その人のいちばん新しい版の番号（無ければ 0） */
export async function latestTermsVersion(db: Db, tenantId: string, driverId: string): Promise<number> {
  const [row] = await db
    .select({ v: sql<number | null>`max(${s.termsRecords.version})` })
    .from(s.termsRecords)
    .where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, driverId)));
  return Number(row?.v ?? 0);
}

/** 記録 1 行 → 明示書 1 通の形 */
export function toTermsDocument(
  row: Pick<TermsRecordRow, "id" | "version" | "issuedOn" | "content" | "subcontract" | "documentName">,
  company: { name: string; registrationNo: string | null },
  driver: { name: string; code: string | null },
): TermsDocument {
  const hash = termsHash(row);
  return {
    recordId: row.id,
    version: row.version,
    issuedOn: row.issuedOn,
    company,
    driver,
    content: readTermsContent(row.content),
    subcontract: readSubcontract(row.subcontract),
    documentName: row.documentName,
    hash,
    hashShort: shortTermsHash(hash),
  };
}

// ---------------------------------------------------------------- 中身を組み立てる

type ComposeOptions = {
  projectIds?: string[];
  serviceDescription?: string;
  place: string;
  receipt?: string;
  other?: string;
  deemed: boolean;
  periodFrom?: string | null;
  periodTo?: string | null;
  commissionedOn?: string | null;
  month: string;
};

/**
 * 保存する写しを作る：台帳から buildTermsContent で組み立て、画面で書いた事項と期間を入れ、
 * 控除ごとに消費税の扱い（台帳の控除のルールの taxable）を写す
 */
async function composeContent(db: Db, tenantId: string, driverId: string, o: ComposeOptions): Promise<StoredTermsContent> {
  const [base, rules] = await Promise.all([
    buildTermsContent(db, tenantId, driverId, {
      projectIds: o.projectIds,
      month: o.month,
      deemed: o.deemed,
      defaults: { serviceDescription: o.serviceDescription, place: o.place, receipt: o.receipt, other: o.other ?? "" },
    }),
    db.select({ id: s.deductionRules.id, taxable: s.deductionRules.taxable }).from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
  ]);
  const taxable = new Map(rules.map((r) => [r.id, r.taxable]));
  return {
    ...base,
    period: { from: o.periodFrom ?? base.period.from, to: o.periodFrom !== undefined ? (o.periodTo ?? null) : base.period.to },
    deductions: base.deductions.map((d) => ({ ...d, taxable: taxable.get(d.ruleId) ?? true })),
    commissionedOn: o.commissionedOn ?? null,
  };
}

/** 記録した版と同じ案件・同じ条項で、今の台帳から組み立てた中身（「条件が変わっています」を見るため） */
async function currentFor(db: Db, tenantId: string, driverId: string, recorded: StoredTermsContent, month: string): Promise<TermsContent> {
  return buildTermsContent(db, tenantId, driverId, {
    projectIds: recorded.services.map((x) => x.projectId),
    month,
    deemed: !!recorded.deemedClause,
  });
}

/** 稼働した案件（その人・その案件の、いちばん最近に稼働した月） */
type WorkedProject = { projectId: string; name: string; last: string };

/**
 * 明示したあとに変わったこと：
 * 台帳の単価・控除・支払期日・振込手数料（compareTermsContent。見張り番と同じ比べ方）＋ みなし確認の日数・消費税の扱い ＋
 * 明示書に無い案件の稼働（明示した月から後・直近 3 か月）。比べられないときは空（画面は止めない）
 */
async function changesSince(
  db: Db,
  tenantId: string,
  driverId: string,
  recorded: StoredTermsContent,
  issuedOn: string,
  month: string,
  worked: WorkedProject[],
): Promise<string[]> {
  let out: string[] = [];
  try {
    const current = await currentFor(db, tenantId, driverId, recorded, month);
    out = [...compareTermsContent(recorded, current).filter(notExtra).map(changeText), ...termsExtraChanges(recorded, current)];
  } catch (error) {
    console.error("terms compare failed", error instanceof Error ? error.message : error);
  }
  const listed = new Set(recorded.services.map((x) => x.projectId));
  const from = `${issuedOn.slice(0, 7)}-01`;
  for (const w of worked) if (!listed.has(w.projectId) && w.last >= from) out.push(unlistedWorkText(w.name, w.last));
  return out;
}

// ---------------------------------------------------------------- 一覧

export type TermsLatest = {
  id: string;
  version: number;
  issuedOn: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  documentName: string | null;
  deemedClause: boolean;
  hasContent: boolean;
};

export type TermsListRow = {
  driverId: string;
  code: string | null;
  name: string;
  kana: string | null;
  /** 台帳に手で入っている明示の日（最初に明示した日） */
  firstIssuedOn: string | null;
  startedOn: string | null;
  /** いちばん最近に稼働した月（YYYY-MM-01） */
  lastWorkMonth: string | null;
  /** 直近 3 か月に稼働がある */
  workedRecently: boolean;
  latest: TermsLatest | null;
  versions: number;
  status: TermsStatusKey;
  /** 明示したあとに台帳で変わったこと（単価・控除・支払期日・振込手数料・みなし確認の日数・消費税の扱い・明示書に無い案件の稼働） */
  changes: string[];
};

export type TermsListCounts = {
  total: number;
  none: number;
  /** 未作成のうち、直近 3 か月に稼働がある人 */
  noneWorked: number;
  unsent: number;
  sent: number;
  received: number;
  changed: number;
  /** 記録はあるが、最新の版の「受け取りました」がまだ（未送付・送付済み） */
  unreceived: number;
};

export type TermsFilter = "" | "none" | "changed" | "unreceived";

export function parseTermsFilter(value: string | string[] | undefined): TermsFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "none" || v === "changed" || v === "unreceived" ? v : "";
}

export function filterTermsRows(rows: TermsListRow[], filter: TermsFilter): TermsListRow[] {
  if (filter === "none") return rows.filter((r) => r.status === "none");
  if (filter === "changed") return rows.filter((r) => r.changes.length > 0);
  if (filter === "unreceived") return rows.filter((r) => r.status === "unsent" || r.status === "sent");
  return rows;
}

export function countTermsRows(rows: TermsListRow[]): TermsListCounts {
  return {
    total: rows.length,
    none: rows.filter((r) => r.status === "none").length,
    noneWorked: rows.filter((r) => r.status === "none" && r.workedRecently).length,
    unsent: rows.filter((r) => r.status === "unsent").length,
    sent: rows.filter((r) => r.status === "sent").length,
    received: rows.filter((r) => r.status === "received").length,
    changed: rows.filter((r) => r.changes.length > 0).length,
    unreceived: rows.filter((r) => r.status === "unsent" || r.status === "sent").length,
  };
}

/** 有効なドライバー 1 人ずつの、最新の版・送付と受け取り・明示のあとの変化 */
export async function listTerms(db: Db, tenantId: string, now = new Date()): Promise<{ rows: TermsListRow[]; counts: TermsListCounts }> {
  const month = monthOf(now);
  const since = shiftMonth(month, -2);
  const [drivers, latest, versionCounts, work, projects] = await Promise.all([
    db
      .select()
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.active, true)))
      .orderBy(asc(s.drivers.code), asc(s.drivers.name)),
    latestTermsByDriver(db, tenantId),
    db
      .select({ driverId: s.termsRecords.driverId, n: count() })
      .from(s.termsRecords)
      .where(eq(s.termsRecords.tenantId, tenantId))
      .groupBy(s.termsRecords.driverId),
    // 数量が 0 の行（取り込んだ空の行）は稼働に数えない
    db
      .select({ driverId: s.workEntries.driverId, projectId: s.workEntries.projectId, last: sql<string>`max(${s.workEntries.month})::text` })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), gt(s.workEntries.qty, 0)))
      .groupBy(s.workEntries.driverId, s.workEntries.projectId),
    db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
  ]);
  const nVersions = new Map(versionCounts.map((v) => [v.driverId, Number(v.n)]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const lastWork = new Map<string, string>();
  const recentByDriver = new Map<string, WorkedProject[]>();
  for (const w of work) {
    if (!w.last) continue;
    const last = w.last.slice(0, 10);
    if (!lastWork.has(w.driverId) || last > lastWork.get(w.driverId)!) lastWork.set(w.driverId, last);
    if (last >= since) {
      const list = recentByDriver.get(w.driverId) ?? [];
      list.push({ projectId: w.projectId, name: projectName.get(w.projectId) ?? "（名前の無い案件）", last });
      recentByDriver.set(w.driverId, list);
    }
  }

  const rows = await mapLimit(drivers, 6, async (d): Promise<TermsListRow> => {
    const rec = latest.get(d.id) ?? null;
    const content = rec ? readTermsContent(rec.content) : null;
    const changes = content && rec ? await changesSince(db, tenantId, d.id, content, rec.issuedOn, month, recentByDriver.get(d.id) ?? []) : [];
    const last = lastWork.get(d.id) ?? null;
    return {
      driverId: d.id,
      code: d.code,
      name: d.name,
      kana: d.kana,
      firstIssuedOn: d.termsIssuedOn,
      startedOn: d.startedOn,
      lastWorkMonth: last,
      workedRecently: !!last && last >= since,
      latest: rec
        ? {
            id: rec.id,
            version: rec.version,
            issuedOn: rec.issuedOn,
            sentAt: rec.sentAt,
            receivedAt: rec.receivedAt,
            documentName: rec.documentName,
            deemedClause: rec.deemedClause,
            hasContent: !!content,
          }
        : null,
      versions: nVersions.get(d.id) ?? 0,
      status: termsStatusOf(rec),
      changes,
    };
  });
  return { rows, counts: countTermsRows(rows) };
}

// ---------------------------------------------------------------- 1 人の画面

export type TermsVersionView = {
  id: string;
  version: number;
  issuedOn: string;
  createdAt: Date;
  sentAt: Date | null;
  receivedAt: Date | null;
  documentName: string | null;
  deemedClause: boolean;
  subcontract: TermsSubcontract | null;
  doc: TermsDocument;
  /** 1 つ前の版から変わったところ（版 1 は null） */
  changesFromPrev: string[] | null;
  isLatest: boolean;
  status: TermsStatusKey;
  /** リンクの署名に使う値（画面には出さない。会社の画面でリンクを作るときだけ使う） */
  linkNonce: string;
};

export type TermsProjectChoice = { id: string; name: string; client: string | null; unit: string; payRate: number; active: boolean; recent: boolean };

/** 新しい版のフォームの初めの値 */
export type TermsFormInitial = {
  projectIds: string[];
  serviceDescription: string;
  place: string;
  periodFrom: string;
  periodTo: string;
  commissionedOn: string;
  receipt: string;
  other: string;
  deemed: boolean;
  isSubcontract: boolean;
  originalClient: string;
  originalPayDate: string;
  documentName: string;
  issuedOn: string;
};

export type TermsDriverDetail = {
  driver: Pick<DriverRow, "id" | "code" | "name" | "kana" | "phone" | "email" | "termsIssuedOn" | "startedOn" | "endOn" | "active">;
  company: { name: string; registrationNo: string | null };
  status: TermsStatusKey;
  workedRecently: boolean;
  firstWorkMonth: string | null;
  /** 新しい順 */
  versions: TermsVersionView[];
  latest: TermsVersionView | null;
  /** 最新の版のあとで台帳が変わったところ */
  changes: string[];
  /** 今の台帳から作ると入るもの（フォームの見本。みなし確認の条項の文もここから） */
  current: StoredTermsContent;
  deemedText: string;
  projects: TermsProjectChoice[];
  initial: TermsFormInitial;
  warnings: {
    /** 支払期日の文に入っている「まで」「以内」 */
    paymentWords: string[];
    /** 会社の設定の「支払期日の文言」（契約書などに書いている文）に入っている「まで」「以内」と、その文 */
    contractWording: { words: string[]; text: string } | null;
    feeByDriver: boolean;
    /** 支払日の決め方で、受け取りから 60 日を超える月があるか（ok 以外のときだけ） */
    deadline: { status: "caution" | "ng"; maxDaysFromStart: number; maxDaysFromEnd: number } | null;
  };
};

export async function loadTermsDriver(db: Db, tenantId: string, driverId: string, now = new Date()): Promise<TermsDriverDetail | null> {
  const driver = await driverOf(db, tenantId, driverId);
  if (!driver) return null;
  const month = monthOf(now);
  const today = todayJst(now);
  const [tenant, records, projects, clients, overrides, work] = await Promise.all([
    getTenant(db, tenantId),
    db
      .select()
      .from(s.termsRecords)
      .where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, driver.id)))
      .orderBy(desc(s.termsRecords.version)),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).orderBy(asc(s.projects.name)),
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select().from(s.rateOverrides).where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, driver.id))),
    db
      .select({ projectId: s.workEntries.projectId, first: sql<string>`min(${s.workEntries.month})::text`, last: sql<string>`max(${s.workEntries.month})::text` })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.driverId, driver.id), gt(s.workEntries.qty, 0)))
      .groupBy(s.workEntries.projectId),
  ]);
  const company = { name: tenant.name, registrationNo: tenant.registrationNo };
  const who = { name: driver.name, code: driver.code };
  const since = shiftMonth(month, -2);

  // 版の一覧（新しい順）と、1 つ前の版から変わったところ
  const docs = records.map((r) => toTermsDocument(r, company, who));
  const versions: TermsVersionView[] = records.map((r, i) => {
    const prev = records[i + 1];
    return {
      id: r.id,
      version: r.version,
      issuedOn: r.issuedOn,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      receivedAt: r.receivedAt,
      documentName: r.documentName,
      deemedClause: r.deemedClause,
      subcontract: readSubcontract(r.subcontract),
      doc: docs[i],
      changesFromPrev: prev
        ? describeVersionChanges(
            { content: docs[i + 1].content, subcontract: prev.subcontract, documentName: prev.documentName, issuedOn: prev.issuedOn },
            { content: docs[i].content, subcontract: r.subcontract, documentName: r.documentName, issuedOn: r.issuedOn },
          )
        : null,
      isLatest: i === 0,
      status: termsStatusOf(r),
      linkNonce: r.linkNonce,
    };
  });
  const latest = versions[0] ?? null;
  const latestContent = latest?.doc.content ?? null;

  // 選べる案件：有効な案件と、最新の版に入っている・最近稼働した案件（無効にした案件も、外すかどうか選べるように）
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const override = new Map(overrides.map((o) => [o.projectId, o.payRate]));
  const recentIds = new Set([...work.filter((w) => w.last && w.last.slice(0, 10) >= since).map((w) => w.projectId), ...overrides.map((o) => o.projectId)]);
  const inLatest = new Set(latestContent?.services.map((x) => x.projectId) ?? []);
  const choices: TermsProjectChoice[] = projects
    .filter((p) => p.active || inLatest.has(p.id) || recentIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      client: p.clientId ? clientName.get(p.clientId) ?? null : null,
      unit: p.unit,
      payRate: override.get(p.id) ?? p.payRate,
      active: p.active,
      recent: recentIds.has(p.id),
    }));
  const known = new Set(choices.map((c) => c.id));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const recentWork: WorkedProject[] = work
    .filter((w) => w.last && w.last.slice(0, 10) >= since)
    .map((w) => ({ projectId: w.projectId, name: projectName.get(w.projectId) ?? "（名前の無い案件）", last: w.last.slice(0, 10) }));
  // 明示書に無いのに、明示したあとで稼働した案件（新しい版では、はじめから選んでおく）
  const unlisted = latest && latestContent ? recentWork.filter((w) => !inLatest.has(w.projectId) && w.last >= `${latest.issuedOn.slice(0, 7)}-01`) : [];

  // 今の台帳から作るとどうなるか（最新の版があれば同じ案件＋明示書に無い稼働の案件で。無ければ直近の稼働などから）
  const current = await composeContent(db, tenantId, driver.id, {
    projectIds: latestContent
      ? [...new Set([...latestContent.services.map((x) => x.projectId), ...unlisted.map((w) => w.projectId)])].filter((id) => known.has(id))
      : undefined,
    serviceDescription: latestContent?.serviceDescription || undefined,
    place: latestContent?.place ?? "",
    receipt: latestContent?.receipt || undefined,
    other: latestContent?.other ?? "",
    deemed: true,
    month,
  });
  const changes = latest && latestContent ? await changesSince(db, tenantId, driver.id, latestContent, latest.issuedOn, month, recentWork) : [];

  const firstWork = work.reduce<string | null>((m, w) => (w.first && (!m || w.first < m) ? w.first.slice(0, 10) : m), null);
  const lastWork = work.reduce<string | null>((m, w) => (w.last && (!m || w.last > m) ? w.last.slice(0, 10) : m), null);

  const initial: TermsFormInitial = latestContent
    ? {
        projectIds: current.services.map((x) => x.projectId),
        serviceDescription: latestContent.serviceDescription,
        place: latestContent.place,
        periodFrom: latestContent.period.from || driver.startedOn || today,
        periodTo: latestContent.period.to ?? driver.endOn ?? "",
        commissionedOn: latestContent.commissionedOn ?? "",
        receipt: latestContent.receipt,
        other: latestContent.other,
        deemed: !!latestContent.deemedClause,
        isSubcontract: !!latest?.subcontract?.isSubcontract,
        originalClient: latest?.subcontract?.originalClient ?? "",
        originalPayDate: latest?.subcontract?.originalPayDate ?? "",
        documentName: latest?.documentName ?? "",
        issuedOn: today,
      }
    : {
        projectIds: current.services.map((x) => x.projectId),
        serviceDescription: current.serviceDescription,
        place: DEFAULT_PLACE,
        periodFrom: driver.startedOn ?? driver.termsIssuedOn ?? today,
        periodTo: driver.endOn ?? "",
        // 委託した日は今日より後にできない（これから始める人は、空＝明示した日と同じ）
        commissionedOn: pastOrToday(driver.startedOn ?? driver.termsIssuedOn, today) ?? "",
        receipt: current.receipt,
        other: "",
        deemed: false,
        isSubcontract: false,
        originalClient: "",
        originalPayDate: "",
        documentName: "",
        issuedOn: today,
      };

  const deadline = paymentDeadlineCheck({
    closingDay: toDay(tenant.closingDay),
    payMonthOffset: toOffset(tenant.payMonthOffset),
    payDay: toDay(tenant.payDay),
    serviceFrom: today,
  });

  return {
    driver: {
      id: driver.id,
      code: driver.code,
      name: driver.name,
      kana: driver.kana,
      phone: driver.phone,
      email: driver.email,
      termsIssuedOn: driver.termsIssuedOn,
      startedOn: driver.startedOn,
      endOn: driver.endOn,
      active: driver.active,
    },
    company,
    status: termsStatusOf(records[0] ?? null),
    workedRecently: !!lastWork && lastWork >= since,
    firstWorkMonth: firstWork,
    versions,
    latest,
    changes,
    current,
    deemedText: current.deemedClause ?? "",
    projects: choices,
    initial,
    warnings: {
      paymentWords: paymentWordingProblem(current.payment.text),
      contractWording: contractWordingOf(tenant.settings?.paymentTermsText),
      feeByDriver: current.feeBearer === "driver",
      deadline:
        deadline.error === null && deadline.status !== "ok"
          ? { status: deadline.status, maxDaysFromStart: deadline.maxDaysFromStart, maxDaysFromEnd: deadline.maxDaysFromEnd }
          : null,
    },
  };
}

// ---------------------------------------------------------------- 版を作る

export type CreateTermsResult = {
  recordId: string;
  version: number;
  /** false：前の版と中身が同じだったので作らなかった */
  created: boolean;
  /** 台帳の「最初に明示した日」を今回の日にしたか */
  firstIssuedOnSet: boolean;
};

type SaveValues = {
  content: StoredTermsContent;
  subcontract: TermsSubcontract | null;
  documentName: string | null;
  issuedOn: string;
  deemed: boolean;
};

/**
 * 版を 1 つ足す。ドライバーの行を押さえてから番号を決める（同時に 2 人が作っても番号がぶつからない）。
 * baseVersion を渡すと、画面を開いたあとでほかの人が版を作っていたら止める。onlyIfNone は「まだ 1 つも無いときだけ」（まとめて作る）
 */
async function saveVersion(
  db: Db,
  tenantId: string,
  actor: TermsActor,
  driverId: string,
  v: SaveValues,
  opts: { baseVersion?: number | null; onlyIfNone?: boolean; source: "form" | "bulk"; now: Date },
): Promise<CreateTermsResult | null> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: s.drivers.id })
      .from(s.drivers)
      .where(and(eq(s.drivers.id, driverId), eq(s.drivers.tenantId, tenantId)))
      .for("update");
    if (!locked) throw new UserError(TERMS_DRIVER_NOT_FOUND);
    const [last] = await tx
      .select()
      .from(s.termsRecords)
      .where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, driverId)))
      .orderBy(desc(s.termsRecords.version))
      .limit(1);
    if (opts.onlyIfNone && last) return null;
    const lastVersion = last?.version ?? 0;

    const values = { content: v.content as unknown as Record<string, unknown>, subcontract: v.subcontract, documentName: v.documentName, issuedOn: v.issuedOn };
    // 押し直し・二重送信で同じ中身の版が並ばないように（先に保存した版と同じ中身なら、画面が古くてもその版を返す）
    if (last && last.deemedClause === v.deemed && termsHash(last) === termsHash(values)) {
      return { recordId: last.id, version: last.version, created: false, firstIssuedOnSet: false };
    }
    if (opts.baseVersion !== undefined && opts.baseVersion !== null && opts.baseVersion !== lastVersion) throw new UserError(TERMS_RACE);
    const [row] = await tx
      .insert(s.termsRecords)
      .values({
        tenantId,
        driverId,
        version: lastVersion + 1,
        issuedOn: v.issuedOn,
        content: values.content,
        deemedClause: v.deemed,
        subcontract: v.subcontract,
        documentName: v.documentName,
        createdBy: actor.userId,
        createdAt: opts.now,
      })
      .onConflictDoNothing({ target: [s.termsRecords.tenantId, s.termsRecords.driverId, s.termsRecords.version] })
      .returning({ id: s.termsRecords.id, version: s.termsRecords.version });
    if (!row) {
      if (opts.onlyIfNone) return null;
      throw new UserError(TERMS_RACE);
    }
    // 最初に明示した日：空か、今回の日より後のときだけ（後ろへはずらさない）
    const moved = await tx
      .update(s.drivers)
      .set({ termsIssuedOn: v.issuedOn })
      .where(and(eq(s.drivers.id, driverId), eq(s.drivers.tenantId, tenantId), or(isNull(s.drivers.termsIssuedOn), gt(s.drivers.termsIssuedOn, v.issuedOn))))
      .returning({ id: s.drivers.id });
    await audit(tx as unknown as Db, {
      tenantId,
      userId: actor.userId,
      action: "terms.create",
      entity: "terms_record",
      entityId: row.id,
      detail: {
        driverId,
        version: row.version,
        issuedOn: v.issuedOn,
        hash: termsHash(values),
        deemedClause: v.deemed,
        subcontract: !!v.subcontract?.isSubcontract,
        documentName: v.documentName,
        services: v.content.services.length,
        deductions: v.content.deductions.length,
        firstIssuedOnSet: moved.length > 0,
        source: opts.source,
      },
    });
    return { recordId: row.id, version: row.version, created: true, firstIssuedOnSet: moved.length > 0 };
  });
}

/** 1 人の新しい版（版 n+1）を作る。中身は台帳（単価・控除・支払日）と、画面で書いた事項から */
export async function createTermsVersion(db: Db, tenantId: string, actor: TermsActor, raw: TermsVersionInput, now = new Date()): Promise<CreateTermsResult> {
  assertStaff(actor);
  const today = todayJst(now);
  const input = termsVersionSchema(today).parse(raw);
  const driver = await driverOf(db, tenantId, input.driverId);
  if (!driver) throw new UserError(TERMS_DRIVER_NOT_FOUND);

  // 案件はこの会社のものだけ（ほかの会社の案件 id は通さない）
  const projectIds = [...new Set(input.projectIds)];
  const found = await db
    .select({ id: s.projects.id })
    .from(s.projects)
    .where(and(eq(s.projects.tenantId, tenantId), inArray(s.projects.id, projectIds)));
  if (found.length !== projectIds.length) throw new UserError("選んだ案件の一部が見つかりません。画面を読み直してから、もう一度お試しください");

  const content = await composeContent(db, tenantId, driver.id, {
    projectIds,
    serviceDescription: input.serviceDescription,
    place: input.place,
    receipt: input.receipt,
    other: input.other,
    deemed: input.deemed,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    commissionedOn: input.commissionedOn,
    month: monthOf(now),
  });
  const subcontract: TermsSubcontract | null = input.isSubcontract
    ? { isSubcontract: true, originalClient: input.originalClient, originalPayDate: input.originalPayDate }
    : null;
  const result = await saveVersion(
    db,
    tenantId,
    actor,
    driver.id,
    { content, subcontract, documentName: input.documentName || null, issuedOn: input.issuedOn, deemed: input.deemed },
    { baseVersion: input.baseVersion ?? null, source: "form", now },
  );
  return result!;
}

// ---------------------------------------------------------------- まとめて作る

export type BulkTermsPreview = { drivers: { id: string; name: string; code: string | null; workedRecently: boolean }[] };

/** 明示書がまだ 1 つも無い、有効なドライバー（まとめて作る前に見せる） */
export async function previewBulkTerms(db: Db, tenantId: string, now = new Date()): Promise<BulkTermsPreview> {
  const since = shiftMonth(monthOf(now), -2);
  const [drivers, withRecords, recent] = await Promise.all([
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code })
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.active, true)))
      .orderBy(asc(s.drivers.code), asc(s.drivers.name)),
    db.selectDistinct({ driverId: s.termsRecords.driverId }).from(s.termsRecords).where(eq(s.termsRecords.tenantId, tenantId)),
    db
      .selectDistinct({ driverId: s.workEntries.driverId })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), gte(s.workEntries.month, since), gt(s.workEntries.qty, 0))),
  ]);
  const has = new Set(withRecords.map((r) => r.driverId));
  const worked = new Set(recent.map((r) => r.driverId));
  return { drivers: drivers.filter((d) => !has.has(d.id)).map((d) => ({ ...d, workedRecently: worked.has(d.id) })) };
}

export type BulkTermsResult = {
  created: { driverId: string; name: string; recordId: string; version: number }[];
  skipped: { driverId: string; name: string; reason: string }[];
};

/**
 * 未作成の人の明示書（版 1）をまとめて作る。案件は直近の稼働・その人だけの単価から（無ければ有効な案件すべて）。
 * 途中でほかの人が作った人は飛ばす（二重に作らない）
 */
export async function bulkCreateTerms(db: Db, tenantId: string, actor: TermsActor, raw: TermsBulkInput, now = new Date()): Promise<BulkTermsResult> {
  assertStaff(actor);
  const input = termsBulkSchema(todayJst(now)).parse(raw);
  const { drivers } = await previewBulkTerms(db, tenantId, now);
  const month = monthOf(now);
  const result: BulkTermsResult = { created: [], skipped: [] };
  for (const d of drivers) {
    // 1 人でうまくいかなくても、ほかの人は作る（作れなかった人と理由は結果に出す）
    try {
      const driver = await driverOf(db, tenantId, d.id);
      if (!driver) {
        result.skipped.push({ driverId: d.id, name: d.name, reason: "ドライバーが見つかりません（消されたか、ほかの人が変えました）" });
        continue;
      }
      const periodFrom = driver.startedOn ?? driver.termsIssuedOn ?? input.issuedOn;
      const content = await composeContent(db, tenantId, d.id, {
        place: input.place,
        deemed: input.deemed,
        periodFrom,
        // 終わりの日が始まりより前になっている台帳は、終わりを書かない（1 人ずつの画面で直せる）
        periodTo: driver.endOn && driver.endOn >= periodFrom ? driver.endOn : null,
        commissionedOn: pastOrToday(driver.startedOn ?? driver.termsIssuedOn, input.issuedOn),
        month,
      });
      if (content.services.length === 0) {
        result.skipped.push({ driverId: d.id, name: d.name, reason: "案件が 1 つも無いため、報酬の額を書けません（設定 → 案件で登録してください）" });
        continue;
      }
      const saved = await saveVersion(
        db,
        tenantId,
        actor,
        d.id,
        { content, subcontract: null, documentName: null, issuedOn: input.issuedOn, deemed: input.deemed },
        { onlyIfNone: true, source: "bulk", now },
      );
      if (!saved) result.skipped.push({ driverId: d.id, name: d.name, reason: "ほかの人が先に作りました" });
      else result.created.push({ driverId: d.id, name: d.name, recordId: saved.recordId, version: saved.version });
    } catch (error) {
      console.error("terms bulk create failed", error instanceof Error ? error.message : error);
      result.skipped.push({
        driverId: d.id,
        name: d.name,
        reason: error instanceof UserError ? error.message : "保存できませんでした。少し時間をおいて、1 人ずつの画面から作ってください",
      });
    }
  }
  await audit(db, {
    tenantId,
    userId: actor.userId,
    action: "terms.bulk_create",
    entity: "terms_record",
    detail: { issuedOn: input.issuedOn, deemedClause: input.deemed, created: result.created.length, skipped: result.skipped.map((x) => ({ driverId: x.driverId, reason: x.reason })) },
  });
  return result;
}

// ---------------------------------------------------------------- 送る・リンクを作り直す

/**
 * 送った記録をつける（コピー・LINE・SMS・メール・紙で渡した）。最初に送った日時だけを残す（何度押しても変わらない）。
 * 送れるのは最新の版だけ
 */
export async function markTermsSent(db: Db, tenantId: string, actor: TermsActor, recordId: string, channel: TermsChannel, now = new Date()) {
  assertStaff(actor);
  const ch = termsChannelSchema.parse(channel);
  const rec = await requireRecord(db, tenantId, recordId);
  const last = await latestTermsVersion(db, tenantId, rec.driverId);
  if (rec.version !== last) throw new UserError(`新しい版（版 ${last}）があります。新しい版を送ってください`);
  let first = false;
  if (!rec.sentAt) {
    const rows = await db
      .update(s.termsRecords)
      .set({ sentAt: now })
      .where(and(eq(s.termsRecords.id, rec.id), eq(s.termsRecords.tenantId, tenantId), isNull(s.termsRecords.sentAt)))
      .returning({ id: s.termsRecords.id });
    first = rows.length > 0;
  }
  await audit(db, {
    tenantId,
    userId: actor.userId,
    action: "terms.send",
    entity: "terms_record",
    entityId: rec.id,
    detail: { channel: ch, driverId: rec.driverId, version: rec.version, recorded: first },
  });
  return { sentAt: first ? now : rec.sentAt, first };
}

/** リンクを作り直す：今までのリンクは使えなくなる。送った記録は外す（受け取りの記録は残す） */
export async function recreateTermsLink(db: Db, tenantId: string, actor: TermsActor, recordId: string) {
  assertStaff(actor);
  const rec = await requireRecord(db, tenantId, recordId);
  const nonce = randomBytes(16).toString("hex");
  await db
    .update(s.termsRecords)
    .set({ linkNonce: nonce, sentAt: null })
    .where(and(eq(s.termsRecords.id, rec.id), eq(s.termsRecords.tenantId, tenantId)));
  await audit(db, {
    tenantId,
    userId: actor.userId,
    action: "terms.relink",
    entity: "terms_record",
    entityId: rec.id,
    detail: { driverId: rec.driverId, version: rec.version, previousSentAt: rec.sentAt?.toISOString() ?? null },
  });
  return { linkNonce: nonce };
}

// ---------------------------------------------------------------- PDF（会社の画面から）

/** PDF に入れる「受け取りました」の記録の文 */
export function termsReceivedText(rec: { receivedAt: Date | null; version: number }): string {
  return rec.receivedAt
    ? `受託者の受け取り：${jpDateTimeJst(rec.receivedAt)}（版 ${rec.version}。リンクの「受け取りました」で記録）`
    : "受託者の受け取り：この版の記録はまだありません";
}

/** 明示書 1 通の中身と受け取りの記録（会社で絞る）。見つからなければ null */
export async function termsPdfSource(db: Db, tenantId: string, recordId: string): Promise<{ doc: TermsDocument; receivedText: string } | null> {
  const rec = await getTermsRecord(db, tenantId, recordId);
  if (!rec) return null;
  const [tenant, driver] = await Promise.all([getTenant(db, tenantId), driverOf(db, tenantId, rec.driverId)]);
  if (!driver) return null;
  return {
    doc: toTermsDocument(rec, { name: tenant.name, registrationNo: tenant.registrationNo }, { name: driver.name, code: driver.code }),
    receivedText: termsReceivedText(rec),
  };
}

export function termsPdfFileName(doc: Pick<TermsDocument, "driver" | "version">): string {
  return `取引条件の明示書_${doc.driver.name}_版${doc.version}.pdf`;
}


// ---------------------------------------------------------------- 監査用の出力（全員分の PDF・全部の版の CSV）

/** 有効なドライバーの、最新の版の明示書（全員分の PDF 用。名前の順） */
export async function latestTermsPdfSources(db: Db, tenantId: string): Promise<{ doc: TermsDocument; receivedText: string }[]> {
  const [tenant, drivers, latest] = await Promise.all([
    getTenant(db, tenantId),
    db
      .select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code })
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.active, true)))
      .orderBy(asc(s.drivers.code), asc(s.drivers.name)),
    latestTermsByDriver(db, tenantId),
  ]);
  const company = { name: tenant.name, registrationNo: tenant.registrationNo };
  return drivers.flatMap((d) => {
    const rec = latest.get(d.id);
    return rec ? [{ doc: toTermsDocument(rec, company, { name: d.name, code: d.code }), receivedText: termsReceivedText(rec) }] : [];
  });
}

export const TERMS_CSV_HEADER = [
  "ドライバーの番号",
  "ドライバー",
  "版",
  "最新の版か",
  "明示した日",
  "作った日時",
  "送付",
  "受け取り",
  "みなし確認の条項",
  "再委託",
  "明示した書面",
  "案件の数",
  "控除の数",
  "目印（中身のハッシュ）",
];

/** 取引条件の記録の全部の版（ドライバー・版の順）。無効にしたドライバーの記録も出す（消さない記録なので） */
export async function termsRecordRows(db: Db, tenantId: string): Promise<(string | number)[][]> {
  const [records, drivers] = await Promise.all([
    db.select().from(s.termsRecords).where(eq(s.termsRecords.tenantId, tenantId)).orderBy(asc(s.termsRecords.driverId), asc(s.termsRecords.version)),
    db.select({ id: s.drivers.id, name: s.drivers.name, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  const who = new Map(drivers.map((d) => [d.id, d]));
  const last = new Map<string, number>();
  for (const r of records) last.set(r.driverId, Math.max(last.get(r.driverId) ?? 0, r.version));
  return records
    .map((r) => ({ r, d: who.get(r.driverId) }))
    .sort((a, b) => (a.d?.code ?? "").localeCompare(b.d?.code ?? "", "ja") || (a.d?.name ?? "").localeCompare(b.d?.name ?? "", "ja") || a.r.version - b.r.version)
    .map(({ r, d }) => {
      const c = readTermsContent(r.content);
      const sub = readSubcontract(r.subcontract);
      return [
        d?.code ?? "",
        d?.name ?? "",
        r.version,
        r.version === last.get(r.driverId) ? "最新" : "",
        r.issuedOn,
        jpDateTimeJst(r.createdAt),
        r.sentAt ? jpDateTimeJst(r.sentAt) : "",
        r.receivedAt ? jpDateTimeJst(r.receivedAt) : "",
        r.deemedClause ? "あり" : "なし",
        sub?.isSubcontract ? `元委託者：${sub.originalClient}／元委託の支払期日：${sub.originalPayDate}` : "",
        r.documentName ?? "",
        c ? c.services.length : "",
        c ? c.deductions.length : "",
        termsHash(r),
      ];
    });
}

// ほかの機能から使いやすいように、中身の形と状態の型もここから出す
export { changeText, readTermsContent } from "~/server/features/terms/document";
export type { TermsDocument, StoredTermsContent } from "~/server/features/terms/document";
export type { TermsChannel } from "~/server/features/terms/schema";
export type { TermsStatusKey } from "~/server/features/terms/status";
