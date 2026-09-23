import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { deemedNote, rulesFor, type CalcRule } from "~/server/calc/statement";
import { shiftMonth } from "~/server/month";
import { getTenant } from "~/server/repo";
import { closingPeriodText, payRuleLabel, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";

/**
 * 取引条件の記録（terms_records.content）の中身の形と、台帳（単価・控除・支払日）から今の中身を組み立てる部品。
 * 取引条件の画面（明示書）・見張り番（明示のあとに単価や控除が変わっていないか）・明細（みなし確認の条項）が共通で使う。
 * フリーランス法 第3条で明示する事項に合わせる：業務の内容・報酬の額（または算定方法）・支払期日・委託した日・
 * 給付を受け取る日（期間）・場所、それに控除があればその額（または式）。
 */
export type TermsService = { projectId: string; name: string; client: string | null; unit: string; payRate: number };
export type TermsDeduction = {
  ruleId: string;
  name: string;
  kind: "percent" | "fixed" | "per_unit";
  rate: number | null;
  amount: number | null;
  onlyWhenWorked: boolean;
  /** 人が読める式（例：「委託料の 10%」「毎月 15,000円（稼働が無い月も）」） */
  how: string;
};

export type TermsContent = {
  /** 業務の内容（例：軽貨物での宅配の配達業務） */
  serviceDescription: string;
  /** 報酬：案件ごとの単価（税抜） */
  services: TermsService[];
  /** 消費税の扱い（例：「報酬とは別に消費税を支払う」） */
  taxNote: string;
  /** 支払期日（具体的な日。「〜まで」「〜以内」は使わない） */
  payment: { closingDay: number; payMonthOffset: number; payDay: number; text: string; periodText: string };
  /** 振込手数料はどちらが持つか（会社が持つのが既定） */
  feeBearer: "company" | "driver";
  deductions: TermsDeduction[];
  /** 業務の場所・期間・給付を受け取る日（期間） */
  place: string;
  period: { from: string; to: string | null };
  receipt: string;
  /** 明細のみなし確認の条項（入れるときだけ） */
  deemedClause: string | null;
  /** その他（再委託の 3 項目は terms_records.subcontract に入れる） */
  other: string;
};

function yen(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

export function deductionHow(r: Pick<CalcRule, "kind" | "rate" | "amount" | "onlyWhenWorked">): string {
  const whenWorked = r.onlyWhenWorked ? "（稼働した月だけ）" : "（稼働が無い月も）";
  if (r.kind === "percent") return `委託料（税抜）の ${Math.round((r.rate ?? 0) * 10000) / 100}%${whenWorked}`;
  if (r.kind === "per_unit") return `数量 1 あたり ${yen(r.rate ?? 0)}${whenWorked}`;
  return `毎月 ${yen(r.amount ?? 0)}${whenWorked}`;
}

function toDay(n: number): DayOfMonth {
  return n >= 1 && n <= 30 ? n : "末";
}

function toOffset(n: number): PayMonthOffset {
  return n <= 0 ? 0 : n >= 2 ? 2 : 1;
}

/**
 * 台帳から、そのドライバーの今の取引条件を組み立てる。
 * 案件は projectIds を渡せばそれ、無ければ「直近 3 か月に稼働した案件」と「その人だけの単価がある案件」。
 * それも無ければ、有効な案件すべて（新しく入る人に渡す場合）。
 */
export async function buildTermsContent(
  db: Db,
  tenantId: string,
  driverId: string,
  opts: { projectIds?: string[]; month?: string; defaults?: Partial<Pick<TermsContent, "serviceDescription" | "place" | "receipt" | "other">>; deemed?: boolean } = {},
): Promise<TermsContent> {
  const tenant = await getTenant(db, tenantId);
  const [driver] = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.id, driverId), eq(s.drivers.tenantId, tenantId)))
    .limit(1);
  if (!driver) throw new Error("ドライバーが見つかりません");

  const [projects, clients, overrides, rules] = await Promise.all([
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select().from(s.rateOverrides).where(and(eq(s.rateOverrides.tenantId, tenantId), eq(s.rateOverrides.driverId, driverId))),
    db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const override = new Map(overrides.map((o) => [o.projectId, o.payRate]));

  let ids = opts.projectIds;
  if (!ids || ids.length === 0) {
    const since = shiftMonth(opts.month ?? new Date().toISOString().slice(0, 7) + "-01", -2);
    const recent = await db
      .selectDistinct({ projectId: s.workEntries.projectId })
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.driverId, driverId), gte(s.workEntries.month, since)));
    const set = new Set([...recent.map((r) => r.projectId), ...overrides.map((o) => o.projectId)]);
    ids = set.size ? [...set] : projects.filter((p) => p.active).map((p) => p.id);
  }
  const chosen = new Set(ids);
  const services: TermsService[] = projects
    .filter((p) => chosen.has(p.id))
    .map((p) => ({ projectId: p.id, name: p.name, client: p.clientId ? clientName.get(p.clientId) ?? null : null, unit: p.unit, payRate: override.get(p.id) ?? p.payRate }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const calcRules: CalcRule[] = rules.map((r) => ({
    id: r.id,
    driverId: r.driverId,
    name: r.name,
    kind: r.kind as CalcRule["kind"],
    rate: r.rate,
    amount: r.amount,
    onlyWhenWorked: r.onlyWhenWorked,
    taxable: r.taxable,
    agreedInWriting: r.agreedInWriting,
    active: r.active,
    sort: r.sort,
  }));
  const deductions: TermsDeduction[] = rulesFor(calcRules, driverId)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "ja"))
    .map((r) => ({ ruleId: r.id, name: r.name, kind: r.kind, rate: r.rate, amount: r.amount, onlyWhenWorked: r.onlyWhenWorked, how: deductionHow(r) }));

  const settings = tenant.settings ?? {};
  const days = settings.deemedConfirmDays ?? 7;
  const payTax = driver.invoiceRegistered || tenant.payTaxToExempt;
  return {
    serviceDescription: opts.defaults?.serviceDescription ?? "貨物軽自動車を使った荷物の配送業務（下の案件）",
    services,
    taxNote: payTax ? "報酬（税抜）とは別に、消費税（登録の無い方は消費税相当額）を支払います。" : "表示の報酬に消費税は含みません（消費税相当額は支払いません）。",
    payment: {
      closingDay: tenant.closingDay,
      payMonthOffset: tenant.payMonthOffset,
      payDay: tenant.payDay,
      text: `${payRuleLabel(toDay(tenant.closingDay), toOffset(tenant.payMonthOffset), toDay(tenant.payDay))}（支払日が金融機関の休業日のときは、その前の営業日に支払います）`,
      periodText: closingPeriodText(toDay(tenant.closingDay)),
    },
    feeBearer: settings.transferFeeBearer === "driver" ? "driver" : "company",
    deductions,
    place: opts.defaults?.place ?? "",
    period: { from: driver.startedOn ?? driver.termsIssuedOn ?? new Date().toISOString().slice(0, 10), to: driver.endOn ?? null },
    receipt: opts.defaults?.receipt ?? "業務を行った日ごとに、その日の業務の完了をもって給付を受け取ったものとします。",
    deemedClause: opts.deemed ? deemedNote(days).replace("受け取りから", "支払明細の受け取りから") : null,
    other: opts.defaults?.other ?? "",
  };
}

export type TermsChange = { kind: "rate" | "service_added" | "service_removed" | "deduction_added" | "deduction_removed" | "deduction_changed" | "payment" | "fee"; label: string; before?: string; after?: string };

/**
 * 記録した取引条件と、今の台帳からの取引条件を比べる（純関数）。
 * 単価・控除・支払日・振込手数料の負担が変わっていたら、その一覧を返す（見張り番の「明示のあとに条件が変わった」に使う）。
 * 業務の内容・場所などの文は、画面で書き換える前提なので比べない。
 */
export function compareTermsContent(recorded: TermsContent, current: TermsContent): TermsChange[] {
  const out: TermsChange[] = [];
  const before = new Map(recorded.services.map((x) => [x.projectId, x]));
  const now = new Map(current.services.map((x) => [x.projectId, x]));
  for (const [id, cur] of now) {
    const old = before.get(id);
    if (!old) continue; // 新しく担当する案件は「追加」扱いにしない（記録した案件の単価の変化だけを見る）
    if (old.payRate !== cur.payRate) out.push({ kind: "rate", label: cur.name, before: `${old.payRate}円/${old.unit}`, after: `${cur.payRate}円/${cur.unit}` });
  }
  const oldD = new Map(recorded.deductions.map((x) => [x.ruleId, x]));
  const curD = new Map(current.deductions.map((x) => [x.ruleId, x]));
  for (const [id, cur] of curD) {
    const old = oldD.get(id);
    if (!old) out.push({ kind: "deduction_added", label: cur.name, after: cur.how });
    else if (old.how !== cur.how) out.push({ kind: "deduction_changed", label: cur.name, before: old.how, after: cur.how });
  }
  for (const [id, old] of oldD) if (!curD.has(id)) out.push({ kind: "deduction_removed", label: old.name, before: old.how });
  if (recorded.payment.text !== current.payment.text) out.push({ kind: "payment", label: "支払期日", before: recorded.payment.text, after: current.payment.text });
  if (recorded.feeBearer !== current.feeBearer) out.push({ kind: "fee", label: "振込手数料の負担", before: recorded.feeBearer, after: current.feeBearer });
  return out;
}

/** その会社のドライバーごとの、いちばん新しい取引条件の記録 */
export async function latestTermsByDriver(db: Db, tenantId: string, driverIds?: string[]) {
  const where = driverIds?.length
    ? and(eq(s.termsRecords.tenantId, tenantId), inArray(s.termsRecords.driverId, driverIds))
    : eq(s.termsRecords.tenantId, tenantId);
  const rows = await db.select().from(s.termsRecords).where(where).orderBy(desc(s.termsRecords.version));
  const out = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!out.has(r.driverId)) out.set(r.driverId, r);
  return out;
}
