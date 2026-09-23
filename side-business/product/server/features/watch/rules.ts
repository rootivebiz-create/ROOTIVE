/**
 * 見張り番のルール（純関数。DB に触らない）。材料は WatchContext（context.ts が集める）。
 *
 * 決まり：
 * - 記録から分かること（日付・金額・名前）と「〜のおそれがあります」「確認をおすすめします」までを書く。
 *   法令に合っているかの判定、税や法律の結論、ドライバーの報酬を下げる話は書かない。
 * - 60 日の数え方は @/lib/tools/torihiki-joken、経過措置の割合は @/lib/payroll/tax を使う（日付の計算を自前で持たない）。
 * - 金額は明細（StatementDraft）の値をそのまま使う。独自の丸めを書かない。
 */
import { groupDigits, jpDate, jpMonth, yenText } from "@/lib/format";
import { pct, roundYen } from "@/lib/payroll/money";
import { monthEnd, nonDeductibleTax, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";
import { validateTransfers, type Requester } from "@/lib/payroll/zengin";
import { daysBetween } from "@/lib/tools/invoice-cost";
import {
  addDays,
  adjustForBankHoliday,
  dayInMonth,
  dayLabel,
  isBankHoliday,
  isDateString,
  paymentDeadlineCheck,
  payRuleLabel,
  type DayOfMonth,
  type PayMonthOffset,
} from "@/lib/tools/torihiki-joken";
import type { Rounding } from "@/lib/payroll/types";
import { payDateFor, type StatementDraft } from "~/server/calc/statement";
import { BASIS, EFFECTIVE, FIX, SOURCES, WATCH_RULES_AS_OF_MONTH } from "~/server/features/watch/sources";
import type { TermsChange, TermsContent, TermsDeduction } from "~/server/features/terms-content";
import type { IssueDraft, WatchContext, WatchDriver, WatchImpact, WatchSeverity, WatchSubcontract } from "~/server/features/watch/types";

// ---------------------------------------------------------------- 小さな部品

/** 登録番号の形（T＋13 桁の数字） */
export const REG_NO_RE = /^T\d{13}$/;
/** 振込手数料の差し引きに見える名前 */
export const FEE_WORDS = /振込手数料|送金手数料|振込料/;
/** 事故・破損・罰金などの負担に見える名前（根拠の記録を求める） */
export const DAMAGE_WORDS = /事故|破損|弁償|罰金|修理|違約金|ペナルティ/;
/** 支払期日を「期間」で書いている言葉 */
export const PERIOD_WORDS = ["まで", "以内"] as const;
/** 支払期日を、仕事を受け取った日ではない日から数えている言葉 */
export const START_WORDS = ["請求書受領", "請求書到着", "検収後"] as const;
/** 違約金・ペナルティの名目に見える名前（差し引きの理由を確かめてもらう） */
export const PENALTY_WORDS = /違約金|ペナルティ|罰金/;
/** 公表サイトで登録を確かめ直す目安の日数 */
export const REGISTRATION_CHECK_DAYS = 180;
/** 数量の急な変化の目安（±50%） */
export const QTY_JUMP_RATIO = 0.5;
/**
 * 取適法の目安（運送の委託＝役務提供委託の区分）：委託する側の資本金が 1,000 万円を超える、
 * または常時使用する従業員が 300 人を超える（相手が個人か、資本金 1,000 万円以下・従業員 300 人以下の会社のとき）。
 * 区分ごとに基準が違うので、画面では「目安」として出す
 */
export const TORITEKI_CAPITAL_YEN = 10_000_000;
export const TORITEKI_EMPLOYEES = 300;
/** 「資本金1,000万円超、または常時使用する従業員300人超」 */
export const TORITEKI_THRESHOLD_TEXT = `資本金${groupDigits(TORITEKI_CAPITAL_YEN / 10_000)}万円超、または常時使用する従業員${groupDigits(TORITEKI_EMPLOYEES)}人超`;
/** 経過措置の次の段が、この月数のうちに始まるならお知らせする */
export const TRANSITIONAL_NEXT_MONTHS = 6;
/** 再委託の特例：元委託の支払期日から起算して数える日数（初日を 1 日目に数える。60 日の数え方と同じ） */
export const SUBCONTRACT_DAYS = 30;

/** 再委託の特例の期限：元委託の支払期日を 1 日目として 30 日目 */
export function subcontractLimit(originalPayDate: string): string {
  return addDays(originalPayDate, SUBCONTRACT_DAYS - 1);
}

const EPS = 1e-9;

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** 「青木 翔太・井上 美咲・上田 健 ほか 2人」 */
export function nameList(names: string[], max = 3): string {
  const uniq = [...new Set(names)];
  if (uniq.length <= max) return uniq.join("・");
  return `${uniq.slice(0, max).join("・")} ほか ${uniq.length - max}人`;
}

/** 単価（小数あり）：150 → 150円、12.5 → 12.5円 */
function rateText(v: number): string {
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 4 })}円`;
}

function qtyText(v: number, unit: string): string {
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 4 })}${unit}`;
}

/** 円（マイナスは「マイナス」と書く） */
function signedYen(v: number): string {
  return v < 0 ? `マイナス ${yenText(-v)}` : yenText(v);
}

/** date に n か月足す（その日が無い月は末日） */
function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return dayInMonth(Math.floor(index / 12), (index % 12) + 1, d);
}

function driverName(ctx: WatchContext, driverId: string, fallback?: string): string {
  return ctx.drivers.find((d) => d.id === driverId)?.name ?? fallback ?? "（名前の無いドライバー）";
}

const monthQuery = (ctx: WatchContext) => ctx.month.slice(0, 7);
const rounding = (ctx: WatchContext): Rounding => ctx.tenant.amountRounding ?? "round";

/** 影響額（出せないときは yen: null。画面では「—」） */
export function impactOf(yen: number | null, label: string): WatchImpact {
  return { yen: yen === null || !Number.isFinite(yen) ? null : Math.round(yen), label };
}

/** 支払額の合計（振込額がプラスの人だけ） */
function payTotal(drafts: StatementDraft[]): number {
  return drafts.reduce((a, d) => a + (d.total > 0 ? d.total : 0), 0);
}
/** 「2026年10月分」（締めた月を開いても「今月」と書かない） */
const monthOf = (ctx: WatchContext) => `${jpMonth(ctx.month)}分`;

// ---------------------------------------------------------------- 1. 取引条件の明示

export function termsMissing(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const drivers = byId(ctx.drivers);
  const label = jpMonth(ctx.month);
  for (const d of ctx.drafts) {
    const drv = drivers.get(d.driverId);
    if (!drv) continue;
    const deducted = d.deductions.length > 0 || d.adjustments.some((a) => a.amount < 0);
    if (!d.hasWork && !deducted) continue;
    const base = {
      code: "terms_missing",
      subjectId: d.driverId,
      subjectLabel: drv.name,
      basis: BASIS.terms,
      sourceUrl: SOURCES.flQa,
      fixHref: FIX.driver(d.driverId),
      impact: impactOf(d.total, `${drv.name}さんの${monthOf(ctx)}の支払額`),
    };
    const pay = `${monthOf(ctx)}の支払額は ${signedYen(d.total)}です。`;
    const first = drv.termsFirstIssuedOn;
    if (!first) {
      out.push({
        ...base,
        severity: "red",
        title: "取引条件を明示した記録がありません",
        detail:
          `${label}に${d.hasWork ? "稼働" : "差し引き"}がありますが、取引条件（仕事の内容・報酬の額・支払期日など）を明示した日の記録が見つかりません。${pay}` +
          "書面やメールで明示していれば、その日付をドライバーの設定に入れてください。まだなら、取引条件を明示して、その日付を入れてください。",
      });
      continue;
    }

    const lateThan: string[] = [];
    let unsure = false;
    if (drv.startedOn && first > drv.startedOn) lateThan.push(`委託を始めた日（${jpDate(drv.startedOn)}）`);
    const fw = drv.firstWork;
    if (fw) {
      const exact = fw.minDate !== null && !fw.hasUndated;
      if (fw.minDate && first > fw.minDate) {
        lateThan.push(`${exact ? "最初の稼働日" : "記録にある稼働日"}（${jpDate(fw.minDate)}）`);
      } else if (!exact) {
        // 日付の無い稼働がある月：その月の終わり（または日付のある最初の日）より後なら確かに後
        const upper = fw.minDate ?? monthEnd(fw.month.slice(0, 7));
        if (first > upper) lateThan.push(`最初に稼働した月（${jpMonth(fw.month)}）`);
        else if (first > fw.month) {
          // 月の途中で明示している。委託を始めた日がその月の中にあれば、それで比べられる
          const started = drv.startedOn;
          const known = started !== null && started >= fw.month && started <= upper;
          if (!known) unsure = true;
        }
      }
    }
    if (lateThan.length) {
      out.push({
        ...base,
        severity: "red",
        title: "取引条件の明示が、仕事を始めたあとになっています",
        detail:
          `取引条件を最初に明示した日（${jpDate(first)}）が、${[...new Set(lateThan)].join("・")}より後です。` +
          "フリーランス法では、仕事を頼んだら直ちに取引条件を明示することになっています。明示した日の記録が正しいか確かめてください。" +
          `記録どおりなら、いきさつを「確認済み」のメモに残してください。${pay}`,
      });
    } else if (unsure && fw) {
      out.push({
        ...base,
        severity: "yellow",
        title: "取引条件を明示した日が、最初の稼働より前か分かりません",
        detail:
          `最初に稼働した${jpMonth(fw.month)}の稼働に日付が無いため、取引条件を明示した日（${jpDate(first)}）が仕事を始める前か確かめられません。` +
          "委託を始めた日をドライバーの設定に入れると確かめられます。",
      });
    }
  }
  return out;
}

export function rateChangedWithoutRecord(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const drivers = byId(ctx.drivers);
  const drafts = new Map(ctx.drafts.map((d) => [d.driverId, d]));
  for (const o of ctx.overrides) {
    if (o.agreedOn) continue;
    const drv = drivers.get(o.driverId);
    const latest = drv?.termsLatestIssuedOn;
    if (!drv || !latest || !(o.updatedOn > latest)) continue;
    // この月に、その単価で払っている行だけ（関係のない月には出さない）
    const line = drafts.get(o.driverId)?.lines.find((l) => l.projectId === o.projectId && Math.abs(l.rate - o.payRate) < EPS);
    if (!line) continue;
    out.push({
      code: "rate_changed_without_record",
      severity: "yellow",
      subjectId: o.id,
      subjectLabel: `${drv.name}・${line.project}`,
      title: "単価を変えた記録に、合意の日付がありません",
      detail:
        `「${line.project}」の単価 ${rateText(line.rate)}（1${line.unit}あたり）は ${jpDate(o.updatedOn)} に登録・変更したもので、取引条件を最後に明示した日（${jpDate(latest)}）より後です。` +
        `この単価で合意した日の記録がありません。合意した日を入れるか、変えた条件を明示した記録を残すことをおすすめします。${monthOf(ctx)}は ${qtyText(line.qty, line.unit)}で ${yenText(line.amount)}です。`,
      basis: BASIS.terms,
      sourceUrl: SOURCES.flQa,
      fixHref: FIX.rates(o.driverId, o.projectId),
      impact: impactOf(line.amount, `この単価での${monthOf(ctx)}の支払`),
    });
  }
  return out;
}

/**
 * 取引条件の記録（terms_records.content）を、比べられる形か確かめて読む。
 * 古い形・空（{}）など、単価・控除・支払期日がそろっていなければ null（比べない）
 */
export function readTermsContent(value: unknown): TermsContent | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<TermsContent>;
  if (!Array.isArray(c.services) || !Array.isArray(c.deductions) || !c.payment || typeof c.payment.text !== "string") return null;
  const services = c.services.filter((x) => x && typeof x.projectId === "string" && typeof x.payRate === "number");
  const deductions = c.deductions.filter((x) => x && typeof x.ruleId === "string" && typeof x.how === "string");
  return { ...(c as TermsContent), services, deductions, feeBearer: c.feeBearer === "driver" ? "driver" : "company" };
}

/** 取引条件の違い 1 つを、短い文に（「「宅配」の単価 150円/個 → 155円/個」） */
export function termsChangeText(c: TermsChange): string {
  const bearer = (v?: string) => (v === "driver" ? "ドライバー" : v === "company" ? "会社" : (v ?? ""));
  switch (c.kind) {
    case "rate":
      return `「${c.label}」の単価 ${c.before ?? ""} → ${c.after ?? ""}`;
    case "deduction_added":
      return `控除「${c.label}」が加わった（${c.after ?? ""}）`;
    case "deduction_removed":
      return `控除「${c.label}」が無くなった（${c.before ?? ""}）`;
    case "deduction_changed":
      return `控除「${c.label}」 ${c.before ?? ""} → ${c.after ?? ""}`;
    case "payment":
      return `支払期日「${c.before ?? ""}」→「${c.after ?? ""}」`;
    case "fee":
      return `振込手数料の負担 ${bearer(c.before)} → ${bearer(c.after)}`;
    default:
      return c.label;
  }
}

/** 記録した控除の式で、この月に引いたとしたらの額（明細と同じ式・同じ端数処理） */
function recordedDeductionAmount(o: TermsDeduction, d: StatementDraft, mode: Rounding): number {
  const qty = d.lines.reduce((a, l) => a + l.qty, 0);
  if (o.kind === "percent") return roundYen(d.subtotal * (o.rate ?? 0), mode);
  if (o.kind === "per_unit") return roundYen(qty * (o.rate ?? 0), mode);
  return o.amount ?? 0;
}

/**
 * 明示した条件と今の条件の違いで、この月の支払がいくら変わったか（単価の差 × 今月の数量・控除の差）。
 * 金額の変わらない違い（支払期日の文・手数料の負担）だけなら null
 */
export function termsChangeImpact(recorded: TermsContent, current: TermsContent, d: StatementDraft, mode: Rounding = "round"): number | null {
  let total = 0;
  let money = false;
  const before = new Map(recorded.services.map((x) => [x.projectId, x]));
  for (const cur of current.services) {
    const old = before.get(cur.projectId);
    if (!old || old.payRate === cur.payRate) continue;
    money = true;
    const line = d.lines.find((l) => l.projectId === cur.projectId);
    if (line) total += Math.abs(roundYen((cur.payRate - old.payRate) * line.qty, mode));
  }
  const oldD = new Map(recorded.deductions.map((x) => [x.ruleId, x]));
  for (const cur of current.deductions) {
    const old = oldD.get(cur.ruleId);
    if (old && old.how === cur.how) continue;
    money = true;
    const applied = d.deductions.find((x) => x.ruleId === cur.ruleId);
    if (!applied) continue;
    total += old ? Math.abs(applied.amount - recordedDeductionAmount(old, d, mode)) : applied.amount;
  }
  return money ? total : null;
}

export function termsOutdated(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const drafts = new Map(ctx.drafts.map((d) => [d.driverId, d]));
  for (const t of ctx.terms ?? []) {
    if (!t.recorded || !t.current || t.changes.length === 0) continue;
    const d = drafts.get(t.driverId);
    if (!d) continue;
    const name = driverName(ctx, t.driverId, d.driver.name);
    const list = t.changes.map(termsChangeText);
    const shown = list.slice(0, 5).join("、") + (list.length > 5 ? ` ほか ${list.length - 5}件` : "");
    out.push({
      code: "terms_outdated",
      severity: "yellow",
      subjectId: t.driverId,
      subjectLabel: name,
      title: "取引条件を明示したあとで、単価や控除などが変わっています",
      detail:
        `取引条件を最後に明示した記録（版 ${t.version}・${jpDate(t.issuedOn)}）と、今の台帳の条件が違います：${shown}。` +
        "変えた条件は、ドライバーと話し合って合意した記録を残し、あらためて明示することをおすすめします。取引条件の画面で、今の条件の新しい版を作れます。",
      basis: BASIS.terms,
      sourceUrl: SOURCES.flQa,
      fixHref: FIX.terms(t.driverId),
      impact: impactOf(termsChangeImpact(t.recorded, t.current, d, rounding(ctx)), `条件が変わった分の${monthOf(ctx)}の差額`),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 2〜4. 支払期日

export function paymentWording(ctx: WatchContext): IssueDraft[] {
  const text = (ctx.tenant.settings.paymentTermsText ?? "").trim();
  const base = { code: "payment_wording", subjectId: "tenant", subjectLabel: "取引条件の支払期日の文言", basis: BASIS.payDate, sourceUrl: SOURCES.flQa, fixHref: FIX.company(monthQuery(ctx)) };
  if (!text) {
    return [
      {
        ...base,
        severity: "info",
        title: "支払期日の文言が入っていません",
        detail: "取引条件に書いている支払期日の文言を入れると確認できます（例：「毎月末日締め・翌月25日払い」）。会社の設定から入れられます。",
      },
    ];
  }
  const period = PERIOD_WORDS.filter((w) => text.includes(w));
  const start = START_WORDS.filter((w) => text.includes(w));
  if (!period.length && !start.length) return [];
  const excerpt = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const parts: string[] = [];
  if (period.length) {
    parts.push(
      `「${period.join("」「")}」のように期間で書くと、支払う日が一つに決まらず、支払期日を定めたことにならないおそれがあります。「毎月末日締め・翌月25日払い」のように、日を特定できる書き方の確認をおすすめします。`,
    );
  }
  if (start.length) {
    parts.push(
      `「${start.join("」「")}」から数える書き方は、請求書や検収が遅れると、仕事を受け取った日から60日を超えるおそれがあります。支払期日は仕事を受け取った日から数えるので、書き方の確認をおすすめします。`,
    );
  }
  return [
    {
      ...base,
      severity: "yellow",
      title: `支払期日の書き方に「${[...period, ...start].join("」「")}」があります`,
      detail: `取引条件の支払期日の文言：「${excerpt}」。${parts.join("")}`,
      impact: impactOf(ctx.drafts.length ? payTotal(ctx.drafts) : null, `${monthOf(ctx)}の支払額の合計（この文言で払う人）`),
    },
  ];
}

export type PayDeadline = {
  ruleLabel: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  /** 銀行の休みの日なら前の営業日にずらした日（サイトの道具と同じ数え方） */
  payDateActual: string;
  limitFromStart: string;
  limitFromEnd: string;
  status: "ok" | "caution" | "ng";
};

function toDay(v: number): DayOfMonth {
  return v >= 1 && v <= 30 ? v : "末";
}

/**
 * その月（締める月）の締め期間・60 日（2 か月）の期限・判定。
 * 締め期間と期限はサイトの道具（paymentDeadlineCheck・sixtyDayLimit）から受け取り、
 * 判定も道具と同じ式（休みの日は前の営業日にずらした支払日を、期間の初日から／締め日からの期限と比べる）にする。
 * 支払日は明細に書いた日（payDateFor）を使う。
 */
export function payDeadlineFor(month: string, tenant: WatchContext["tenant"], payDate: string): PayDeadline | null {
  const closing = toDay(tenant.closingDay);
  const payDay = toDay(tenant.payDay);
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  // この月の締め期間の初日（前の月の締め日の翌日）から 1 か月ぶんを道具に数えさせる
  const serviceFrom = addDays(dayInMonth(prev.y, prev.m, closing), 1);
  // 締め期間と期限は支払日の決め方によらないので、道具には受け付ける形（翌々月末日）で渡す
  const r = paymentDeadlineCheck({ closingDay: closing, payMonthOffset: 2, payDay: "末", holidayRule: "before", serviceFrom, months: 1 });
  const row = r.rows[0];
  if (!row) return null;
  const payDateActual = adjustForBankHoliday(payDate, "before");
  const status = payDateActual <= row.limitFromStart ? "ok" : payDateActual <= row.limitFromEnd ? "caution" : "ng";
  const offset = tenant.payMonthOffset;
  const ruleLabel =
    offset >= 0 && offset <= 2
      ? payRuleLabel(closing, offset as PayMonthOffset, payDay)
      : `毎月${dayLabel(closing)}締め・${offset}か月後の${dayLabel(payDay)}払い`;
  return {
    ruleLabel,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    payDate,
    payDateActual,
    limitFromStart: row.limitFromStart,
    limitFromEnd: row.limitFromEnd,
    status,
  };
}

/** 再委託の 3 項目（再委託であること・元委託の相手・元委託の支払期日）がそろっているか */
export function hasSubcontractItems(sc: WatchSubcontract | null | undefined): sc is WatchSubcontract & { originalClient: string; originalPayDate: string } {
  return !!sc && sc.isSubcontract === true && !!sc.originalClient?.trim() && !!sc.originalPayDate?.trim();
}

/**
 * 元委託の支払期日を、その月（締める月）の分の日付にする。読めなければ null。
 * 読める形：「2026-11-30」「2026/11/30」「2026年11月30日」（その日）と、
 * 「翌月末日」「翌々月10日」「当月25日」「2か月後の末日」（締める月から数える。「毎月20日締め・翌月末日払い」のような文の中でもよい）
 */
export function originalPayDateFor(month: string, text: string): string | null {
  const t = text.normalize("NFKC").replace(/\s/g, "");
  const exact = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(t);
  if (exact) {
    const iso = `${exact[1]}-${exact[2].padStart(2, "0")}-${exact[3].padStart(2, "0")}`;
    return isDateString(iso) ? iso : null;
  }
  const rel = /(当月|翌々月|翌月|(\d{1,2})[かヶケカ]月後の?)(末日?|(\d{1,2})日)/.exec(t);
  if (!rel) return null;
  const offset = rel[1] === "当月" ? 0 : rel[1] === "翌月" ? 1 : rel[1] === "翌々月" ? 2 : Number(rel[2]);
  const day = rel[4] ? Number(rel[4]) : null;
  if (day !== null && (day < 1 || day > 31)) return null;
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const index = y * 12 + (m - 1) + offset;
  return dayInMonth(Math.floor(index / 12), (index % 12) + 1, day ?? "末");
}

export function sixtyDays(ctx: WatchContext): IssueDraft[] {
  const payDate = ctx.drafts[0]?.payDate ?? payDateFor(ctx.month, ctx.tenant);
  const dl = payDeadlineFor(ctx.month, ctx.tenant, payDate);
  if (!dl || dl.status === "ok") return [];
  const shifted = dl.payDateActual !== dl.payDate ? `（銀行の休みの日のため、前の営業日の${jpDate(dl.payDateActual)}として数えています）` : "";
  const base = { code: "sixty_days", subjectId: "tenant", subjectLabel: "会社の支払日の設定", basis: BASIS.payDate, sourceUrl: SOURCES.flGuidelines, fixHref: FIX.company(monthQuery(ctx)) };
  // 締めた月の写しの支払日が今の設定と違うときは、設定の名前を書かない（写しの日で数える）
  const setting = dl.payDate === payDateFor(ctx.month, ctx.tenant) ? `（${dl.ruleLabel}）` : "（明細に書いた支払日）";
  const head = `${jpMonth(ctx.month)}分（${jpDate(dl.periodStart)}〜${jpDate(dl.periodEnd)}）の支払日は${jpDate(dl.payDate)}${setting}${shifted}です。`;

  // 再委託の特例：取引条件の記録に 3 項目がある人は、元委託の支払期日から 30 日で数える（フリーランス法 第4条第3項）
  const termsBy = new Map((ctx.terms ?? []).map((t) => [t.driverId, t]));
  const payees = ctx.drafts.filter((d) => d.total > 0 || d.hasWork);
  const covered: { name: string; orig: string; limit: string }[] = [];
  const overSpecial: { name: string; orig: string; limit: string }[] = [];
  const unreadable: { name: string; text: string }[] = [];
  const subject: StatementDraft[] = [];
  for (const d of payees) {
    const sc = termsBy.get(d.driverId)?.subcontract;
    if (!hasSubcontractItems(sc)) {
      subject.push(d);
      continue;
    }
    const orig = originalPayDateFor(ctx.month, sc.originalPayDate);
    if (!orig) {
      unreadable.push({ name: d.driver.name, text: sc.originalPayDate });
      subject.push(d);
      continue;
    }
    const limit = subcontractLimit(orig);
    if (dl.payDateActual <= limit) covered.push({ name: d.driver.name, orig, limit });
    else {
      overSpecial.push({ name: d.driver.name, orig, limit });
      subject.push(d);
    }
  }
  const specialText = (xs: { name: string; orig: string; limit: string }[]) =>
    xs.map((x) => `${x.name}さん（元委託の支払期日 ${jpDate(x.orig)}・特例の期限 ${jpDate(x.limit)}）`).join("、");
  const notes: string[] = [];
  if (covered.length) {
    notes.push(
      `${specialText(covered)}は、取引条件の記録に再委託の3項目（再委託であること・元委託の相手・元委託の支払期日）があるので、元委託の支払期日から${SUBCONTRACT_DAYS}日の特例で数え、この指摘の対象から外しています。`,
    );
  }
  if (overSpecial.length) notes.push(`${specialText(overSpecial)}は、再委託の特例で数えても期限を過ぎます。`);
  if (unreadable.length) {
    notes.push(
      `${unreadable.map((x) => `${x.name}さん（「${x.text}」）`).join("、")}は、再委託の記録がありますが、元委託の支払期日を日付として読めないため、60日で数えています。「翌月末日」や「2026-11-30」の形で入れると特例で数えられます。`,
    );
  }
  const note = notes.join("");

  if (payees.length > 0 && subject.length === 0) {
    // 全員が再委託の特例の中：判定はせず、どう数えたかだけを知らせる
    return [
      {
        ...base,
        severity: "info",
        basis: BASIS.subcontract,
        title: `再委託の特例（元委託の支払期日から${SUBCONTRACT_DAYS}日）で数えています`,
        detail:
          head +
          `60日（2か月）で数えると期限（${jpDate(dl.status === "ng" ? dl.limitFromEnd : dl.limitFromStart)}）を超えますが、` +
          note +
          "特例で数えてよいのは、再委託であることと元委託の相手・支払期日を取引条件で明示している場合です。記録の中身の確認をおすすめします。",
        fixHref: covered.length === 1 ? FIX.terms(payees[0].driverId) : FIX.termsList,
        impact: impactOf(null, "特例の中で払う見込みです"),
      },
    ];
  }
  const impact = impactOf(subject.length ? payTotal(subject) : null, `対象の方の${monthOf(ctx)}の支払額の合計${subject.length ? `（${subject.length}人）` : ""}`);
  if (dl.status === "ng") {
    return [
      {
        ...base,
        severity: "red",
        title: "支払日が、60日（2か月）の期限を超えます",
        detail:
          head +
          `締め日（${jpDate(dl.periodEnd)}）から数えた期限の${jpDate(dl.limitFromEnd)}より ${daysBetween(dl.limitFromEnd, dl.payDateActual)}日後です。` +
          "フリーランス法では、報酬の支払期日は、仕事を受け取った日から60日以内のできるだけ早い日に定めることになっています。支払日の設定の確認をおすすめします。" +
          note,
        impact,
      },
    ];
  }
  return [
    {
      ...base,
      severity: "yellow",
      title: "締め期間の最初の日から数えると、支払日が60日（2か月）を超えます",
      detail:
        head +
        `締め期間の最初の日（${jpDate(dl.periodStart)}）から数えた期限の${jpDate(dl.limitFromStart)}より ${daysBetween(dl.limitFromStart, dl.payDateActual)}日後です（締め日から数えれば、期限の${jpDate(dl.limitFromEnd)}までに入ります）。` +
        "締め日から数えてよいのは、同じ種類の仕事が続き、月ごとに締めてまとめて払うことと、報酬の額（算定方法）を取引条件に書いている場合です。取引条件の記録の確認をおすすめします。" +
        note,
      impact,
    },
  ];
}

type LateBatch = { batch: WatchContext["batches"][number]; late: { name: string; payDate: string; days: number; total: number }[]; payDates: string[]; maxDays: number; total: number; holidayNote: string };

/** 振り込んだ日が明細の支払期日より後の振込データ（振込データごと） */
function lateBatches(ctx: WatchContext, batches: WatchContext["batches"], statementsList: WatchContext["statements"]): { late: LateBatch[]; paidIds: Set<string> } {
  const statements = byId(statementsList);
  const paidIds = new Set<string>();
  const out: LateBatch[] = [];
  for (const b of batches) {
    if (!b.executedOn) continue;
    const late: LateBatch["late"] = [];
    for (const id of b.statementIds) {
      const st = statements.get(id);
      if (!st) continue;
      paidIds.add(id);
      if (b.executedOn > st.payDate) {
        late.push({ name: driverName(ctx, st.driverId), payDate: st.payDate, days: daysBetween(st.payDate, b.executedOn), total: st.total });
      }
    }
    if (!late.length) continue;
    const payDates = [...new Set(late.map((x) => x.payDate))].sort();
    // 支払期日が銀行の休みの日（土日・年末年始）なら、そのことも書く（事実だけ。扱いは取引条件しだい）
    const holidays = payDates.filter((d) => isBankHoliday(d));
    const holidayNote = holidays.length
      ? `明細の支払期日（${holidays.map(jpDate).join("・")}）は銀行の休みの日です。休みの日にあたるときの扱いを、取引条件にどう書いているかも確かめてください。`
      : "";
    out.push({ batch: b, late, payDates, maxDays: Math.max(...late.map((x) => x.days)), total: late.reduce((a, x) => a + x.total, 0), holidayNote });
  }
  return { late: out, paidIds };
}

export function paidLate(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const m = monthQuery(ctx);
  const { late, paidIds } = lateBatches(ctx, ctx.batches, ctx.statements);
  for (const x of late) {
    out.push({
      code: "paid_late",
      severity: "red",
      subjectId: x.batch.id,
      subjectLabel: `振込データ ${x.batch.fileName}`,
      title: "支払期日より後に振り込んだ記録があります",
      detail:
        `振り込んだ日の記録は${jpDate(x.batch.executedOn!)}で、明細の支払期日（${x.payDates.map(jpDate).join("・")}）より ${x.maxDays}日後です。` +
        `対象：${nameList(x.late.map((y) => y.name))}（${x.late.length}人・合計 ${yenText(x.total)}）。` +
        x.holidayNote +
        "振り込んだ日の記録が正しいか確かめてください。記録どおりなら、遅れた事情とドライバーへの連絡を「確認済み」のメモに残すことをおすすめします。",
      basis: BASIS.payDate,
      sourceUrl: SOURCES.flQa,
      fixHref: FIX.transfer(m),
      impact: impactOf(x.total, "遅れて払った額の合計"),
    });
  }

  // 支払期日を過ぎたのに、振り込んだ日の記録が無い人
  const payees: { id: string | null; driverId: string; total: number; payDate: string }[] = ctx.statements.length
    ? ctx.statements.filter((st) => st.total > 0)
    : ctx.drafts.filter((d) => d.total > 0).map((d) => ({ id: null, driverId: d.driverId, total: d.total, payDate: d.payDate }));
  const unpaid = payees.filter((p) => !(p.id && paidIds.has(p.id)) && ctx.today > p.payDate);
  if (unpaid.length) {
    const payDates = [...new Set(unpaid.map((p) => p.payDate))].sort();
    const total = unpaid.reduce((a, p) => a + p.total, 0);
    out.push({
      code: "paid_late",
      severity: "yellow",
      subjectId: "unpaid",
      subjectLabel: `振り込んだ日の記録が無い ${unpaid.length}人`,
      title: "支払期日を過ぎましたが、振り込んだ日の記録がありません",
      detail:
        `明細の支払期日（${payDates.map(jpDate).join("・")}）を過ぎていますが、${nameList(unpaid.map((p) => driverName(ctx, p.driverId)))}（${unpaid.length}人・合計 ${yenText(total)}）は振り込んだ日の記録がありません。` +
        "振り込んでいれば、振込データの画面で振り込んだ日を入れてください。",
      basis: BASIS.payDate,
      sourceUrl: SOURCES.flQa,
      fixHref: FIX.transfer(m),
      impact: impactOf(total, "振り込んだ記録が無い額の合計"),
    });
  }
  return out;
}

/** 前の月の振込が、その月の明細の支払期日より後だった（今月の締めの前に、事情と連絡を確かめてもらう） */
export function latePaymentPrev(ctx: WatchContext): IssueDraft[] {
  const prevMonth = addMonths(ctx.month, -1);
  const { late } = lateBatches(ctx, ctx.prevBatches ?? [], ctx.prevStatements ?? []);
  return late.map((x) => ({
    code: "late_payment_prev",
    severity: "red" as const,
    subjectId: `prev:${x.batch.id}`,
    subjectLabel: `${jpMonth(prevMonth)}分の振込データ ${x.batch.fileName}`,
    title: "前の月の振込が、支払期日より後になっています",
    detail:
      `${jpMonth(prevMonth)}分の振込は、振り込んだ日の記録が${jpDate(x.batch.executedOn!)}で、明細の支払期日（${x.payDates.map(jpDate).join("・")}）より ${x.maxDays}日後です。` +
      `対象：${nameList(x.late.map((y) => y.name))}（${x.late.length}人・合計 ${yenText(x.total)}）。` +
      x.holidayNote +
      `記録が正しいか確かめ、遅れた事情とドライバーへの連絡を「確認済み」のメモに残してください。${jpMonth(ctx.month)}分の支払日（${jpDate(ctx.drafts[0]?.payDate ?? payDateFor(ctx.month, ctx.tenant))}）に振り込めるかも確かめておくと安心です。`,
    basis: BASIS.payDate,
    sourceUrl: SOURCES.flQa,
    fixHref: FIX.transfer(prevMonth.slice(0, 7)),
    impact: impactOf(x.total, "遅れて払った額の合計（前の月）"),
  }));
}

// ---------------------------------------------------------------- 5〜7. 差し引きと単価

/** 決まった言い方（合意があっても、を必ず添える） */
export const FEE_SENTENCE = "振込手数料をドライバーの負担にすると、報酬の減額にあたるおそれがあります（合意があっても）。";

/** 「木村 誠さん・5,000円」「8人（青木 翔太・井上 美咲・上田 健 ほか 5人）・合計 241,060円」 */
function peopleText(items: { name: string; amount: number }[]): string {
  const total = items.reduce((s, x) => s + x.amount, 0);
  if (items.length === 1) return `${items[0].name}さん・${yenText(total)}`;
  return `${items.length}人（${nameList(items.map((x) => x.name))}）・合計 ${yenText(total)}`;
}

function sumAmounts(items: { amount: number }[]): number {
  return items.reduce((s, x) => s + x.amount, 0);
}

/** この月の明細に出ている控除（ルールごと） */
function appliedDeductions(drafts: StatementDraft[]) {
  const map = new Map<string, { name: string; agreedInWriting: boolean; items: { driverId: string; name: string; amount: number }[] }>();
  for (const d of drafts) {
    for (const x of d.deductions) {
      const cur = map.get(x.ruleId) ?? { name: x.name, agreedInWriting: x.agreedInWriting, items: [] };
      cur.items.push({ driverId: d.driverId, name: d.driver.name, amount: x.amount });
      map.set(x.ruleId, cur);
    }
  }
  return map;
}

export function feeDeducted(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const base = { code: "fee_deducted", severity: "red" as const, basis: BASIS.fee, sourceUrl: SOURCES.toritekiLeaflet };
  if (ctx.tenant.settings.transferFeeBearer === "driver") {
    out.push({
      ...base,
      subjectId: "tenant",
      subjectLabel: "会社の設定（振込手数料）",
      title: "振込手数料をドライバーの負担にする設定です",
      detail: `会社の設定で、振込手数料を「ドライバーの負担」にしています。${FEE_SENTENCE}会社の負担にする設定の確認をおすすめします。`,
      fixHref: FIX.company(monthQuery(ctx)),
      impact: impactOf(null, "手数料 × 人数（手数料の額の記録が無いので出せません）"),
    });
  }
  const applied = appliedDeductions(ctx.drafts);
  const seen = new Set<string>();
  for (const r of ctx.rules) {
    if (!FEE_WORDS.test(r.name)) continue;
    const a = applied.get(r.id);
    if (!r.active && !a) continue;
    seen.add(r.id);
    out.push({
      ...base,
      subjectId: r.id,
      subjectLabel: `控除「${r.name}」`,
      title: "振込手数料を報酬から差し引く控除があります",
      detail:
        `控除「${r.name}」で、振込手数料にあたる額を報酬から差し引いています` +
        `${a ? `（${monthOf(ctx)} ${peopleText(a.items)}）` : "（有効なルールです）"}。${FEE_SENTENCE}`,
      fixHref: FIX.rules(monthQuery(ctx), r.driverId),
      impact: impactOf(a ? sumAmounts(a.items) : null, a ? `差し引いた手数料の合計（税抜・${a.items.length}人）` : `${monthOf(ctx)}はまだ差し引いていません`),
    });
  }
  // ルールが消えていても、明細に残っている分は出す
  for (const [ruleId, a] of applied) {
    if (seen.has(ruleId) || !FEE_WORDS.test(a.name)) continue;
    out.push({
      ...base,
      subjectId: ruleId,
      subjectLabel: `控除「${a.name}」`,
      title: "振込手数料を報酬から差し引く控除があります",
      detail: `控除「${a.name}」で、振込手数料にあたる額を報酬から差し引いています（${monthOf(ctx)} ${peopleText(a.items)}）。${FEE_SENTENCE}`,
      fixHref: FIX.rules(monthQuery(ctx)),
      impact: impactOf(sumAmounts(a.items), `差し引いた手数料の合計（税抜・${a.items.length}人）`),
    });
  }
  for (const a of ctx.adjustments) {
    if (a.amount >= 0 || !FEE_WORDS.test(a.label)) continue;
    const name = driverName(ctx, a.driverId);
    out.push({
      ...base,
      subjectId: `adj:${a.id}`,
      subjectLabel: `${name}・${a.label}`,
      title: "振込手数料を報酬から差し引く調整があります",
      detail: `調整「${a.label}」で ${yenText(-a.amount)} を${name}さんの報酬から差し引いています。${FEE_SENTENCE}`,
      fixHref: FIX.adjustment(monthQuery(ctx), a.id),
      impact: impactOf(-a.amount, "差し引いた額"),
    });
  }
  return out;
}

export function deductionNoAgreement(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const rules = byId(ctx.rules);
  const base = { code: "deduction_no_agreement", basis: BASIS.reduction, sourceUrl: SOURCES.flGuidelines };
  for (const [ruleId, a] of appliedDeductions(ctx.drafts)) {
    const rule = rules.get(ruleId);
    const name = rule?.name ?? a.name;
    // 振込手数料は fee_deducted が必ず出す（同じものを二重に出さない）
    if (FEE_WORDS.test(name)) continue;
    const who = `${monthOf(ctx)} ${peopleText(a.items)}`;
    const fixHref = FIX.rules(monthQuery(ctx), rule?.driverId ?? null);
    const subjectLabel = a.items.length === 1 ? `${name}（${a.items[0].name}）` : `${name}（${a.items.length}人）`;
    const agreed = rule ? rule.agreedInWriting : a.agreedInWriting;
    const impact = impactOf(sumAmounts(a.items), `控除の合計（税抜・${a.items.length}人）`);
    if (!agreed) {
      out.push({
        ...base,
        severity: "red",
        subjectId: ruleId,
        subjectLabel,
        title: "書面で合意した記録が無い控除があります",
        detail:
          `控除「${name}」を報酬から差し引いています（${who}）。書面で合意した記録が見つかりません。` +
          "合意の無い差し引きは、報酬の減額にあたるおそれがあります。合意した書面があれば、控除のルールに「書面で合意している」と合意した日を入れてください。" +
          "書面が見つからないときは、払う前に、差し引いてよいものかを確かめることをおすすめします。",
        fixHref,
        impact,
      });
    } else if (rule && !rule.agreedOn) {
      out.push({
        ...base,
        severity: "yellow",
        subjectId: ruleId,
        subjectLabel,
        title: "控除の合意の日付がありません",
        detail:
          `控除「${name}」（${who}）は「書面で合意している」になっていますが、合意した日の記録がありません。` +
          "合意がこの月の仕事より前か確かめられるよう、合意した日を入れることをおすすめします。",
        fixHref,
        impact,
      });
    } else if (rule?.agreedOn && rule.agreedOn > ctx.month) {
      out.push({
        ...base,
        severity: "yellow",
        subjectId: ruleId,
        subjectLabel,
        title: "控除の合意が、この月の途中です",
        detail:
          `控除「${name}」（${who}）の合意した日（${jpDate(rule.agreedOn)}）が、この月の初日（${jpDate(ctx.month)}）より後です。` +
          "合意より前の仕事の分まで差し引くと、報酬の減額にあたるおそれがあります。差し引く範囲の確認をおすすめします。",
        fixHref,
        impact,
      });
    }
  }

  for (const a of ctx.adjustments) {
    // 0 円の調整は明細に出ない。振込手数料の差し引きは fee_deducted が出す
    if (a.amount === 0 || (a.amount < 0 && FEE_WORDS.test(a.label))) continue;
    const damage = DAMAGE_WORDS.test(a.label);
    const noBasis = !a.basis?.trim();
    const reasons: string[] = [];
    if (a.amount < 0 && !a.agreedInWriting) reasons.push("書面で合意した記録がありません");
    if ((a.amount < 0 || damage) && noBasis) reasons.push("根拠（事故の報告・領収書・合意書など）が入っていません");
    if (!reasons.length) continue;
    const name = driverName(ctx, a.driverId);
    const what = a.amount < 0 ? `${yenText(-a.amount)}を差し引き` : `${yenText(a.amount)}を支払`;
    out.push({
      ...base,
      severity: "yellow",
      subjectId: `adj:${a.id}`,
      subjectLabel: `${name}・${a.label}`,
      title:
        damage && noBasis
          ? a.amount < 0
            ? "事故・破損などの負担の根拠が入っていません"
            : "事故・破損などに関わる支払の根拠が入っていません"
          : "差し引きの合意・根拠の記録が足りません",
      detail:
        `調整「${a.label}」（${name}さん・${what}）について、${reasons.join("。")}。` +
        (damage ? "事故や破損などを扱うときは、どんな出来事で、なぜその額なのかの記録を残すことをおすすめします。" : "") +
        (a.amount < 0 ? "根拠の無い差し引きは、報酬の減額にあたるおそれがあります。" : ""),
      fixHref: FIX.adjustment(monthQuery(ctx), a.id),
      impact: impactOf(Math.abs(a.amount), a.amount < 0 ? "差し引いた額" : "支払う額"),
    });
  }
  return out;
}

export function rateDown(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const prev = new Map(ctx.prevDrafts.map((d) => [d.driverId, d]));
  const overrides = new Set(ctx.overrides.map((o) => `${o.driverId}:${o.projectId}`));
  for (const d of ctx.drafts) {
    const p = prev.get(d.driverId);
    if (!p) continue;
    for (const line of d.lines) {
      const pl = p.lines.find((l) => l.projectId === line.projectId);
      if (!pl || !(line.rate < pl.rate - EPS)) continue;
      const diff = pl.rate - line.rate;
      const effect = roundYen(diff * line.qty, "round");
      out.push({
        code: "rate_down",
        severity: "yellow",
        subjectId: `${d.driverId}:${line.projectId}`,
        subjectLabel: `${d.driver.name}・${line.project}`,
        title: "前月より単価が下がっています",
        detail:
          `「${line.project}」の単価が、前月の ${rateText(pl.rate)} から ${rateText(line.rate)} になっています（1${line.unit}あたり ${rateText(diff)}。${monthOf(ctx)}の ${qtyText(line.qty, line.unit)}で約 ${yenText(effect)}）。` +
          "前月より単価が下がっています。協議した記録を確認してください。",
        basis: BASIS.rateDown,
        sourceUrl: SOURCES.flGuidelines,
        fixHref: overrides.has(`${d.driverId}:${line.projectId}`) ? FIX.rates(d.driverId, line.projectId) : FIX.projects(line.project),
        impact: impactOf(effect, "下がった分（単価の差 × 今月の数量）"),
      });
    }
  }
  return out;
}

/** 控除の式の強さ（明細の how から読む）：定額は額、率は割合、数量あたりは 1 あたりの円 */
export type DeductionMeasure = { kind: "fixed" | "percent" | "per_unit"; value: number };

export function deductionMeasure(x: { amount: number; how: string }): DeductionMeasure {
  const percent = /×\s*([\d.,]+)%\s*$/.exec(x.how);
  if (percent) return { kind: "percent", value: Number(percent[1].replace(/,/g, "")) / 100 };
  const unit = /^数量.*×\s*([\d.,]+)円\s*$/.exec(x.how);
  if (unit) return { kind: "per_unit", value: Number(unit[1].replace(/,/g, "")) };
  return { kind: "fixed", value: x.amount };
}

const sameName = (a: string, b: string) => a.normalize("NFKC").replace(/\s/g, "") === b.normalize("NFKC").replace(/\s/g, "");

/** 前の月の明細と比べて、新しく加わった控除・増えた控除（振込手数料は fee_deducted が出す） */
export function dedNewOrUp(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const prev = new Map(ctx.prevDrafts.map((d) => [d.driverId, d]));
  const rules = byId(ctx.rules);
  const prevLabel = `${jpMonth(addMonths(ctx.month, -1))}分`;
  for (const d of ctx.drafts) {
    const p = prev.get(d.driverId);
    if (!p) continue;
    const qty = d.lines.reduce((a, l) => a + l.qty, 0);
    for (const x of d.deductions) {
      if (FEE_WORDS.test(x.name)) continue;
      const rule = rules.get(x.ruleId);
      const px = p.deductions.find((y) => y.ruleId === x.ruleId) ?? p.deductions.find((y) => sameName(y.name, x.name));
      let increase: number;
      let what: string;
      if (!px) {
        // 前の月に稼働が無く、稼働した月だけ引く控除なら、前の月に無いのは当たり前（新しいとは言えない）
        if (!p.hasWork && d.hasWork && rule?.onlyWhenWorked !== false) continue;
        increase = x.amount;
        what = `控除「${x.name}」（${x.how}・${yenText(x.amount)}）は、前の月（${prevLabel}）の明細にはありませんでした。`;
      } else {
        const a = deductionMeasure(px);
        const b = deductionMeasure(x);
        if (a.kind !== b.kind) {
          increase = x.amount - px.amount;
          what = `控除「${x.name}」の決め方が、前の月（${prevLabel}）の「${px.how}」（${yenText(px.amount)}）から「${x.how}」（${yenText(x.amount)}）に変わっています。`;
        } else if (!(b.value > a.value + EPS)) {
          continue;
        } else if (b.kind === "percent") {
          increase = x.amount - roundYen(d.subtotal * a.value, rounding(ctx));
          what = `控除「${x.name}」の率が、前の月（${prevLabel}）の ${pct(a.value)} から ${pct(b.value)} に上がっています（${monthOf(ctx)}の委託料で ${yenText(increase)} 増えます）。`;
        } else if (b.kind === "per_unit") {
          increase = x.amount - roundYen(qty * a.value, rounding(ctx));
          what = `控除「${x.name}」の1あたりの額が、前の月（${prevLabel}）の ${rateText(a.value)} から ${rateText(b.value)} に上がっています（${monthOf(ctx)}の数量で ${yenText(increase)} 増えます）。`;
        } else {
          increase = x.amount - px.amount;
          what = `控除「${x.name}」の額が、前の月（${prevLabel}）の ${yenText(px.amount)} から ${yenText(x.amount)} に増えています。`;
        }
        if (!(increase > 0)) continue;
      }
      out.push({
        code: "ded_new_or_up",
        severity: "yellow",
        subjectId: `${d.driverId}:${x.ruleId}`,
        subjectLabel: `${d.driver.name}・${x.name}`,
        title: px ? "前の月より控除が増えています" : "前の月には無かった控除が加わっています",
        detail:
          what +
          "控除を新しく加える・増やすときは、取引条件で明示して、ドライバーと合意した記録を残しておくことをおすすめします。合意の無い差し引きは、報酬の減額にあたるおそれがあります。" +
          (rule?.agreedOn ? `控除のルールに記録してある合意の日：${jpDate(rule.agreedOn)}。` : "控除のルールに、合意した日の記録がありません。"),
        basis: BASIS.reduction,
        sourceUrl: SOURCES.flGuidelines,
        fixHref: FIX.rules(monthQuery(ctx), rule?.driverId ?? null),
        impact: impactOf(increase, px ? "増えた額（税抜）" : "加わった控除の額（税抜）"),
      });
    }
  }
  return out;
}

/** 決まった言い方（違約金・ペナルティの差し引き） */
export const PENALTY_SENTENCE =
  "違約金・ペナルティとして報酬から差し引くと、ドライバーに原因が無い分まで引いている場合などに、報酬の減額にあたるおそれがあります。どんな出来事で、なぜその額なのか、取引条件にどう書いてあるかの記録を確認してください。";

export function dedPenalty(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const rules = byId(ctx.rules);
  const base = { code: "ded_penalty", severity: "yellow" as const, title: "違約金・ペナルティの名目で差し引いています", basis: BASIS.penalty, sourceUrl: SOURCES.flGuidelines };
  for (const [ruleId, a] of appliedDeductions(ctx.drafts)) {
    if (!PENALTY_WORDS.test(a.name)) continue;
    out.push({
      ...base,
      subjectId: ruleId,
      subjectLabel: a.items.length === 1 ? `${a.name}（${a.items[0].name}）` : `${a.name}（${a.items.length}人）`,
      detail: `控除「${a.name}」を報酬から差し引いています（${monthOf(ctx)} ${peopleText(a.items)}）。${PENALTY_SENTENCE}`,
      fixHref: FIX.rules(monthQuery(ctx), rules.get(ruleId)?.driverId ?? null),
      impact: impactOf(sumAmounts(a.items), `差し引いた額の合計（税抜・${a.items.length}人）`),
    });
  }
  for (const a of ctx.adjustments) {
    if (a.amount >= 0 || !PENALTY_WORDS.test(a.label)) continue;
    const name = driverName(ctx, a.driverId);
    out.push({
      ...base,
      subjectId: `adj:${a.id}`,
      subjectLabel: `${name}・${a.label}`,
      detail: `調整「${a.label}」で ${yenText(-a.amount)} を${name}さんの報酬から差し引いています。${PENALTY_SENTENCE}`,
      fixHref: FIX.adjustment(monthQuery(ctx), a.id),
      impact: impactOf(-a.amount, "差し引いた額"),
    });
  }
  return out;
}

/** 決まった言い方（登録の無い方だけ単価が下がった） */
export const EXEMPT_CUT_SENTENCE = "登録の無い方だけ単価が下がっています。取引の条件を協議した記録を確認してください。";

/**
 * 同じ案件で、インボイスの登録が無い方だけ前の月より単価が下がり、登録のある方は下がっていない。
 * （登録のある方がその案件にいない・登録のある方も下がっているときは出さない。rate_down が人ごとに出す）
 */
export function exemptOnlyCut(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const prev = new Map(ctx.prevDrafts.map((d) => [d.driverId, d]));
  type Cut = { driverId: string; name: string; from: number; to: number; effect: number };
  const groups = new Map<string, { name: string; cuts: Cut[]; registeredCut: number; registeredKept: string[] }>();
  for (const d of ctx.drafts) {
    const p = prev.get(d.driverId);
    if (!p) continue;
    for (const line of d.lines) {
      const pl = p.lines.find((l) => l.projectId === line.projectId);
      if (!pl) continue;
      const g = groups.get(line.projectId) ?? { name: line.project, cuts: [], registeredCut: 0, registeredKept: [] };
      groups.set(line.projectId, g);
      const down = line.rate < pl.rate - EPS;
      if (d.driver.invoiceRegistered) {
        if (down) g.registeredCut++;
        else g.registeredKept.push(d.driver.name);
      } else if (down) {
        g.cuts.push({ driverId: d.driverId, name: d.driver.name, from: pl.rate, to: line.rate, effect: roundYen((pl.rate - line.rate) * line.qty, "round") });
      }
    }
  }
  for (const [projectId, g] of groups) {
    if (!g.cuts.length || g.registeredCut > 0 || !g.registeredKept.length) continue;
    const effect = g.cuts.reduce((a, c) => a + c.effect, 0);
    out.push({
      code: "exempt_only_cut",
      severity: "red",
      subjectId: projectId,
      subjectLabel: `${g.name}（登録の無い方 ${g.cuts.length}人）`,
      title: "登録の無い方だけ単価が下がっています",
      detail:
        EXEMPT_CUT_SENTENCE +
        `「${g.name}」で、インボイスの登録が無い ${g.cuts.map((c) => `${c.name}さん（${rateText(c.from)} → ${rateText(c.to)}）`).join("、")}の単価が前の月より下がっていて、` +
        `登録のある ${g.registeredKept.length}人（${nameList(g.registeredKept)}）は下がっていません（${monthOf(ctx)}の数量で約 ${yenText(effect)}）。` +
        "登録が無いことを理由にした取引条件の見直しについて、公正取引委員会などが Q&A で考え方を示しています。話し合った経緯と合意の記録を確かめてください。",
      basis: BASIS.exemptCut,
      sourceUrl: SOURCES.exemptQa,
      fixHref: FIX.rates(g.cuts[0].driverId, projectId),
      impact: impactOf(effect, "下がった分（単価の差 × 今月の数量）"),
    });
  }
  return out;
}

/** 稼働が無い月に控除だけを引いている（車両リースなど） */
export function dedWithoutWork(ctx: WatchContext): IssueDraft[] {
  return ctx.drafts
    .filter((d) => !d.hasWork && d.deductions.length > 0)
    .map((d) => {
      const amount = d.deductionTotal + d.deductionTax;
      const names = d.deductions.map((x) => `「${x.name}」${yenText(x.amount)}`).join("・");
      return {
        code: "ded_without_work",
        severity: "yellow" as const,
        subjectId: d.driverId,
        subjectLabel: d.driver.name,
        title: "稼働の無い月に控除を差し引いています",
        detail:
          `${d.driver.name}さんは${monthOf(ctx)}の稼働がありませんが、控除（${names}）を差し引いています` +
          `${d.deductionTax ? `（消費税を含めて ${yenText(amount)}）` : ""}。振込額は ${signedYen(d.total)}です。` +
          "稼働が無い月にも差し引くことを取引条件に書いて合意しているか、確認をおすすめします。稼働の入れ忘れなら、稼働を取り込んでください。",
        fixHref: FIX.rules(monthQuery(ctx), d.driverId),
        impact: impactOf(amount, d.deductionTax ? "差し引く額（消費税を含む）" : "差し引く額"),
      };
    });
}

// ---------------------------------------------------------------- 8. 取適法の目安

export function toriteki(ctx: WatchContext): IssueDraft[] {
  const capitalYen = toNumber(ctx.tenant.settings.capitalYen);
  const employees = toNumber(ctx.tenant.settings.employees);
  const hasCap = capitalYen !== null;
  const hasEmp = employees !== null;
  const base = {
    code: "toriteki",
    severity: "info" as const,
    subjectId: "tenant",
    subjectLabel: "会社の資本金・従業員の数",
    basis: BASIS.toriteki,
    sourceUrl: SOURCES.toritekiOverview,
    fixHref: FIX.company(monthQuery(ctx)),
    impact: impactOf(null, "金額で出す指摘ではありません"),
  };
  const over = (capitalYen !== null && capitalYen > TORITEKI_CAPITAL_YEN) || (employees !== null && employees > TORITEKI_EMPLOYEES);
  if (over) {
    const facts = [capitalYen !== null ? `資本金 ${yenText(capitalYen)}` : null, employees !== null ? `常時使用する従業員 ${employees.toLocaleString("ja-JP")}人` : null]
      .filter(Boolean)
      .join("・");
    return [
      {
        ...base,
        title: "取適法の対象になる可能性があります",
        detail:
          `会社の設定では ${facts}です。運送の委託の目安（${TORITEKI_THRESHOLD_TEXT}。相手が個人か、それより小さい会社のとき）に当たるため、取適法の対象になる可能性があります。` +
          "対象になると、支払期日・手形などでの支払の禁止・書面の保存などのルールがかかります。" +
          "目安です。区分ごとに基準が違います。弁護士などにご確認ください。",
      },
    ];
  }
  if (!hasCap || !hasEmp) {
    return [
      {
        ...base,
        title: "取適法の対象かどうかの目安を出せます",
        detail: "資本金と従業員の数を入れると、取適法の対象かどうかの目安を出します。会社の設定から入れられます。",
      },
    ];
  }
  return [];
}

/** 設定の数（文字で入っていても読む。空・読めないものは null） */
function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[,，\s]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------- 9. インボイス

export function invoiceNumber(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const drivers = byId(ctx.drivers);
  const stale: WatchDriver[] = [];
  for (const d of ctx.drafts) {
    const drv = drivers.get(d.driverId);
    if (!drv?.invoiceRegistered) continue;
    const no = (drv.registrationNo ?? "").replace(/\s+/g, "");
    if (!REG_NO_RE.test(no)) {
      out.push({
        code: "invoice_number",
        severity: "yellow",
        subjectId: drv.id,
        subjectLabel: drv.name,
        title: no ? "登録番号の形が正しくありません" : "登録番号が入っていません",
        detail:
          (no ? `登録番号「${no}」は「T＋13桁の数字」の形ではありません。` : "インボイスの登録ありになっていますが、登録番号が入っていません。") +
          "登録のある方への明細（仕入明細書）には、相手の登録番号を書くことになっています。公表サイトで確かめて、ドライバーの設定で直してください。",
        basis: BASIS.invoiceNumber,
        sourceUrl: SOURCES.purchaseStatement,
        fixHref: FIX.driver(drv.id),
        impact: impactOf(d.tax, `${drv.name}さんの${monthOf(ctx)}の消費税額`),
      });
      continue;
    }
    const checked = drv.registrationCheckedOn;
    if (!checked || daysBetween(checked, ctx.today) > REGISTRATION_CHECK_DAYS) stale.push(drv);
  }
  const taxOf = new Map(ctx.drafts.map((d) => [d.driverId, d.tax]));
  if (stale.length) {
    out.push({
      code: "invoice_number",
      severity: "info",
      subjectId: "registration_check",
      subjectLabel: `登録のある方 ${stale.length}人`,
      title: "公表サイトで登録を確かめた日が古い（または記録がありません）",
      detail:
        `${nameList(stale.map((d) => d.name))}（${stale.length}人）は、国税庁の公表サイトで登録を確かめた日の記録が無いか、${REGISTRATION_CHECK_DAYS}日より前です。` +
        "登録が取り消されていないかを公表サイトで確かめ、確かめた日をドライバーの設定に入れることをおすすめします。",
      basis: BASIS.invoiceRegistry,
      sourceUrl: SOURCES.invoiceRegistry,
      fixHref: stale.length === 1 ? FIX.driver(stale[0].id) : FIX.drivers,
      impact: impactOf(
        stale.reduce((a, d) => a + (taxOf.get(d.id) ?? 0), 0),
        `${stale.length}人の${monthOf(ctx)}の消費税額の合計`,
      ),
    });
  }
  return out;
}

export function invoiceBurden(ctx: WatchContext): IssueDraft[] {
  const exempt = ctx.drafts.filter((d) => !d.driver.invoiceRegistered && d.invoiceBurden > 0);
  if (!exempt.length) return [];
  const total = exempt.reduce((s, d) => s + d.invoiceBurden, 0);
  const rate = exempt[0].deductibleRate;
  const judgedOn = monthEnd(ctx.month.slice(0, 7));
  const current = TRANSITIONAL_STEPS.find((s) => judgedOn >= s.from && (s.to === null || judgedOn <= s.to));
  const next = TRANSITIONAL_STEPS.find((s) => s.from > judgedOn);
  const nextBurden = next ? exempt.reduce((s, d) => s + nonDeductibleTax(d.subtotal + d.tax, next.from), 0) : null;
  return [
    {
      code: "invoice_burden",
      severity: "info",
      subjectId: "exempt",
      subjectLabel: `インボイスの登録が無い方 ${exempt.length}人`,
      title: "インボイスの登録が無い方への支払で、会社が控除できない消費税があります",
      detail:
        `インボイスの登録が無い ${nameList(exempt.map((d) => d.driver.name))}（${exempt.length}人）への${jpMonth(ctx.month)}分の支払では、` +
        `会社が仕入税額控除できない消費税の見込みが合計 ${yenText(total)}です（控除できる割合 ${pct(rate)}${current ? `・${jpDate(current.from)}からの割合` : ""}で計算）。` +
        (next && nextBurden !== null ? `次の段階：${jpMonth(next.from)}から ${pct(next.rate)}（同じ支払額なら、月 ${yenText(nextBurden)}の見込み）。` : "") +
        "会社の消費税の計算で生じる見込みで、明細の振込額は変わりません。",
      basis: BASIS.transitional,
      sourceUrl: SOURCES.invoiceTransitional,
      impact: impactOf(total, `会社が控除できない消費税の見込み（${monthOf(ctx)}）`),
    },
  ];
}

/**
 * 締めの期間が経過措置の段の境目をまたぎ、登録の無い方の稼働に日付が無い（期間の末日の割合で数えている）。
 * 影響額は「期間の初日の割合で数えた場合との差」の上限（期間の全部を初日の割合で数えたとき）
 */
export function transitionalSpan(ctx: WatchContext): IssueDraft[] {
  const hit = ctx.drafts.filter((d) => d.undatedAcrossStep && !d.driver.invoiceRegistered && d.invoiceBurden > 0);
  if (!hit.length) return [];
  const { from, to } = hit[0].period;
  const diff = hit.reduce((a, d) => a + Math.max(0, nonDeductibleTax(d.subtotal + d.tax, d.period.to) - nonDeductibleTax(d.subtotal + d.tax, d.period.from)), 0);
  const step = TRANSITIONAL_STEPS.find((s) => s.from > from && s.from <= to);
  return [
    {
      code: "transitional_span",
      severity: "yellow",
      subjectId: "transitional_span",
      subjectLabel: `インボイスの登録が無い方 ${hit.length}人`,
      title: "締めの期間が経過措置の境目をまたいでいて、日付の無い稼働があります",
      detail:
        `${monthOf(ctx)}の締めの期間（${jpDate(from)}〜${jpDate(to)}）の途中${step ? `の${jpDate(step.from)}` : ""}で、登録の無い方への支払で控除できる割合が変わります。` +
        `${nameList(hit.map((d) => d.driver.name))}（${hit.length}人）の稼働に日付の無い行があるため、その行は期間の末日（${jpDate(to)}）の割合で数えています。` +
        `期間の初日（${jpDate(from)}）の割合で数えた場合との差は、多くて ${yenText(diff)}です。` +
        "稼働に日付を入れる（Excel に日付の列があれば、日付つきで取り込み直す）と、日ごとの割合で分けて数えます。明細の振込額は変わりません。",
      basis: BASIS.transitional,
      sourceUrl: SOURCES.invoiceTransitional,
      fixHref: FIX.work(monthQuery(ctx)),
      impact: impactOf(diff, "期間の初日の割合で数えた場合との差（多くて）"),
    },
  ];
}

/** 経過措置の次の段が 6 か月以内に始まる：同じ支払額なら月の負担がいくら増えるかの見込み */
export function transitionalNext(ctx: WatchContext): IssueDraft[] {
  const exempt = ctx.drafts.filter((d) => !d.driver.invoiceRegistered && d.invoiceBurden > 0);
  if (!exempt.length) return [];
  const judgedOn = monthEnd(ctx.month.slice(0, 7));
  const next = TRANSITIONAL_STEPS.find((s) => s.from > judgedOn);
  if (!next || next.from > addMonths(judgedOn, TRANSITIONAL_NEXT_MONTHS)) return [];
  const now = exempt.reduce((a, d) => a + d.invoiceBurden, 0);
  const later = exempt.reduce((a, d) => a + nonDeductibleTax(d.subtotal + d.tax, next.from), 0);
  const increase = later - now;
  if (!(increase > 0)) return [];
  return [
    {
      code: "transitional_next",
      severity: "info",
      subjectId: "transitional_next",
      subjectLabel: `インボイスの登録が無い方 ${exempt.length}人`,
      title: `${jpMonth(next.from)}から、経過措置の控除できる割合が変わります`,
      detail:
        `${jpDate(next.from)}から、インボイスの登録が無い方への支払で控除できる割合が ${pct(exempt[0].deductibleRate)} から ${pct(next.rate)} になります。` +
        `${monthOf(ctx)}と同じ支払額なら、会社が控除できない消費税は月 ${yenText(now)} から ${yenText(later)} になる見込みです（${yenText(increase)} 増えます）。` +
        "会社の消費税の計算で生じる見込みで、ドライバーへの支払額は変わりません。資金繰りの見込みに入れておくと安心です。",
      basis: BASIS.transitional,
      sourceUrl: SOURCES.invoiceTransitional,
      impact: impactOf(increase, "次の段での月の負担増（見込み）"),
    },
  ];
}

// ---------------------------------------------------------------- 10. 終了の予告

export function contractEnd(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  for (const drv of ctx.drivers) {
    const end = drv.endOn;
    if (!end || end < ctx.month) continue;
    const fw = drv.firstWork;
    const firstWorkOn = fw ? (fw.minDate && !fw.hasUndated ? fw.minDate : fw.month) : null;
    const start = drv.startedOn ?? drv.termsFirstIssuedOn ?? firstWorkOn;
    if (!start || start > end) continue;
    // 6 か月以上続く委託か（始めた日から終わりの日までが 6 か月以上）
    if (end < addDays(addMonths(start, 6), -1)) continue;
    const noticed = drv.endNoticedOn;
    const days = noticed ? daysBetween(noticed, end) : null;
    if (days !== null && days >= 30) continue;
    // 予告の目安の日（終了日の 30 日前）
    const noticeBy = addDays(end, -30);
    out.push({
      code: "contract_end",
      severity: "yellow",
      subjectId: drv.id,
      subjectLabel: drv.name,
      title: noticed ? "委託の終了の予告が、30日前より後です" : "委託の終了を伝えた日の記録がありません",
      detail:
        `委託の終了日は${jpDate(end)}で、${jpDate(start)}から6か月以上続いた委託です。` +
        (noticed
          ? `終了を伝えた日の記録は${jpDate(noticed)}で、終了日の ${days}日前です。`
          : `終了を伝えた日の記録がありません（終了日の30日前は${jpDate(noticeBy)}${ctx.today > noticeBy ? "で、すでに過ぎています" : "です"}）。`) +
        "6か月以上続いた委託を終える（更新しない）ときは、少なくとも30日前までに予告することが求められています（例外があります）。予告した日の記録の確認をおすすめします。",
      basis: BASIS.endNotice,
      sourceUrl: SOURCES.mhlwFl,
      fixHref: FIX.driver(drv.id),
      impact: impactOf(null, "金額で出す指摘ではありません"),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 数字のおかしなところ

/** ドライバー側の口座だけを確かめるための仮の依頼人（振込データの画面と同じ確かめ方） */
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

export function noBank(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const drivers = byId(ctx.drivers);
  for (const d of ctx.drafts) {
    if (!(d.total > 0)) continue;
    const drv = drivers.get(d.driverId);
    if (!drv) continue;
    const b = drv.bank;
    const empty = !b.bankCode && !b.branchCode && !b.accountNumber && !b.holderKana;
    const problems = empty
      ? []
      : validateTransfers(PLACEHOLDER_REQUESTER, [{ ...b, amount: d.total }])
          .filter((i) => i.index >= 0)
          .map((i) => i.message);
    if (!empty && !problems.length) continue;
    out.push({
      code: "no_bank",
      severity: "yellow",
      subjectId: drv.id,
      subjectLabel: drv.name,
      title: empty ? "振込先の口座が登録されていません" : "振込先の口座に直すところがあります",
      detail:
        `振込額は ${yenText(d.total)}ですが、${empty ? "口座が登録されていません" : `口座の情報に直すところがあります（${problems.join("・")}）`}。` +
        "このままでは全銀の振込データに入りません。ドライバーの設定で口座を入れてください。",
      fixHref: FIX.driver(drv.id),
      impact: impactOf(d.total, "振込額"),
    });
  }
  return out;
}

/** 明細の振込額の内訳（委託料 ＋ 消費税 − 控除 ± 調整 − 源泉徴収 ＝ 振込額。明細の値をそのまま並べる） */
export function totalBreakdown(d: StatementDraft): string {
  const parts = [`委託料 ${yenText(d.subtotal)}`];
  if (d.tax) parts.push(`＋ ${d.taxLabel ?? "消費税"} ${yenText(d.tax)}`);
  const deducted = d.deductionTotal + d.deductionTax;
  if (deducted) parts.push(`− 控除 ${yenText(deducted)}${d.deductionTax ? "（消費税を含む）" : ""}`);
  const adjusted = d.adjustmentTotal + d.adjustmentTax;
  if (adjusted) parts.push(`${adjusted < 0 ? "−" : "＋"} 調整 ${yenText(Math.abs(adjusted))}`);
  const withheld = d.withholding?.amount ?? 0;
  if (withheld) parts.push(`− 源泉徴収 ${yenText(withheld)}`);
  return parts.join(" ");
}

export function negativeTotal(ctx: WatchContext): IssueDraft[] {
  return ctx.drafts
    .filter((d) => d.total < 0)
    .map((d) => ({
      code: "negative_total",
      severity: "red" as const,
      subjectId: d.driverId,
      subjectLabel: d.driver.name,
      title: "振込額がマイナスです",
      detail:
        `${monthOf(ctx)}の振込額が ${signedYen(d.total)}です（${totalBreakdown(d)}）。` +
        "このままでは振り込めません。控除と調整の中身と金額を確かめてください。",
      fixHref: FIX.work(monthQuery(ctx)),
      impact: impactOf(-d.total, "マイナスの額"),
    }));
}

export function qtyJump(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const prev = new Map(ctx.prevDrafts.map((d) => [d.driverId, d]));
  for (const d of ctx.drafts) {
    const p = prev.get(d.driverId);
    if (!p || !d.hasWork || !p.hasWork) continue;
    const cur = d.lines.reduce((s, l) => s + l.qty, 0);
    const before = p.lines.reduce((s, l) => s + l.qty, 0);
    if (!(before > 0)) continue;
    const ratio = (cur - before) / before;
    if (Math.abs(ratio) < QTY_JUMP_RATIO) continue;
    // 案件ごとの前月 → 今月（変わったものだけ）
    const ids = [...new Set([...p.lines.map((l) => l.projectId), ...d.lines.map((l) => l.projectId)])];
    const changes = ids
      .map((id) => {
        const a = p.lines.find((l) => l.projectId === id);
        const b = d.lines.find((l) => l.projectId === id);
        const unit = (b ?? a)!.unit;
        return { name: (b ?? a)!.project, before: a?.qty ?? 0, after: b?.qty ?? 0, unit };
      })
      .filter((c) => Math.abs(c.after - c.before) > EPS)
      .map((c) => `${c.name} ${qtyText(c.before, c.unit)} → ${qtyText(c.after, c.unit)}`);
    const sign = ratio > 0 ? "＋" : "−";
    out.push({
      code: "qty_jump",
      severity: "yellow",
      subjectId: d.driverId,
      subjectLabel: d.driver.name,
      title: ratio > 0 ? "前月より数量が大きく増えています" : "前月より数量が大きく減っています",
      detail:
        `数量の合計が前月の ${before.toLocaleString("ja-JP")} から ${cur.toLocaleString("ja-JP")} になっています（${sign}${Math.round(Math.abs(ratio) * 100)}%）。` +
        `${changes.join("、")}。取り込みの漏れ・重なり、名前の取り違えが無いか確かめてください。`,
      fixHref: FIX.work(monthQuery(ctx)),
      impact: impactOf(Math.abs(d.subtotal - p.subtotal), "委託料（税抜）の前月との差"),
    });
  }
  return out;
}

export function statementsStale(ctx: WatchContext): IssueDraft[] {
  const st = ctx.statementsStatus;
  if (ctx.closed || !st || st.upToDate) return [];
  const changed = st.missing + st.stale + st.orphan;
  if (changed === 0) return [];
  const base = {
    code: "statements_stale",
    severity: "yellow" as const,
    subjectId: "statements",
    subjectLabel: "支払明細",
    fixHref: FIX.statements(monthQuery(ctx)),
    impact: impactOf(null, "金額で出す指摘ではありません"),
  };
  if (st.saved === 0) {
    return [
      {
        ...base,
        title: "明細をまだ作っていません",
        detail: `${st.missing}人ぶんの明細がまだ保存されていません。明細の画面で作ってから、ドライバーへ送ってください（締めるときにも最新にします）。`,
      },
    ];
  }
  const parts = [st.stale && `作ったあとに稼働や設定が変わった人が ${st.stale}人`, st.missing && `まだ作っていない人が ${st.missing}人`, st.orphan && `稼働が無くなった人が ${st.orphan}人`].filter(Boolean);
  return [
    {
      ...base,
      title: "明細を作り直してください",
      detail: `${parts.join("、")}います。明細を作り直してください。すでに送った明細が変わると、ドライバーにもう一度確認をお願いすることになります。`,
    },
  ];
}

export function workMissing(ctx: WatchContext): IssueDraft[] {
  const worked = new Set(ctx.drafts.filter((d) => d.hasWork).map((d) => d.driverId));
  // まだ誰の稼働も入っていない月は、人ごとには出さない（画面の「稼働がまだありません」の案内で足りる）
  if (worked.size === 0) return [];
  const prevWorked = new Set(ctx.prevDrafts.filter((d) => d.hasWork).map((d) => d.driverId));
  const prevTotal = new Map(ctx.prevDrafts.map((d) => [d.driverId, d.total]));
  const out: IssueDraft[] = [];
  for (const drv of ctx.drivers) {
    if (!drv.active || !prevWorked.has(drv.id) || worked.has(drv.id)) continue;
    // 前の月のうちに委託を終えた人は出さない
    if (drv.endOn && drv.endOn < ctx.month) continue;
    out.push({
      code: "work_missing",
      severity: "info",
      subjectId: drv.id,
      subjectLabel: drv.name,
      title: "前月は稼働があった方に、この月の稼働がありません",
      detail: `${drv.name}さんは前月に稼働がありましたが、${jpMonth(ctx.month)}の稼働がまだ入っていません。取り込みの漏れや名前の取り違えが無いか確かめてください。`,
      fixHref: FIX.work(monthQuery(ctx)),
      impact: impactOf(prevTotal.get(drv.id) ?? null, "前月の支払額（参考）"),
    });
  }
  return out;
}

/** 同じ人・同じ案件・同じ日付の稼働が 2 行以上ある（二重の取り込みのおそれ）。人ごとにまとめる */
export function duplicateRows(ctx: WatchContext): IssueDraft[] {
  const groups = new Map<string, { driverId: string; projectId: string; date: string; qtys: number[] }>();
  for (const r of ctx.workRows ?? []) {
    if (!r.workDate || !(r.qty > 0)) continue;
    const key = `${r.driverId}\u0000${r.projectId}\u0000${r.workDate}`;
    const g = groups.get(key) ?? { driverId: r.driverId, projectId: r.projectId, date: r.workDate, qtys: [] };
    g.qtys.push(r.qty);
    groups.set(key, g);
  }
  const drafts = new Map(ctx.drafts.map((d) => [d.driverId, d]));
  const byDriver = new Map<string, { date: string; project: string; unit: string; qtys: number[]; extra: number }[]>();
  for (const g of groups.values()) {
    if (g.qtys.length < 2) continue;
    const line = drafts.get(g.driverId)?.lines.find((l) => l.projectId === g.projectId);
    if (!line) continue;
    // 重なっている分：いちばん多い行を残して、残りの行の数量 × 単価
    const extraQty = g.qtys.reduce((a, q) => a + q, 0) - Math.max(...g.qtys);
    const list = byDriver.get(g.driverId) ?? [];
    list.push({ date: g.date, project: line.project, unit: line.unit, qtys: g.qtys, extra: roundYen(line.rate * extraQty, rounding(ctx)) });
    byDriver.set(g.driverId, list);
  }
  const out: IssueDraft[] = [];
  for (const [driverId, list] of byDriver) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project, "ja"));
    const extra = list.reduce((a, x) => a + x.extra, 0);
    const shown = list
      .slice(0, 5)
      .map((x) => `${jpDate(x.date)} ${x.project} ${x.qtys.length}行（${x.qtys.map((q) => qtyText(q, x.unit)).join("・")}）`)
      .join("、");
    const name = driverName(ctx, driverId, drafts.get(driverId)?.driver.name);
    out.push({
      code: "duplicate_rows",
      severity: "red",
      subjectId: driverId,
      subjectLabel: name,
      title: "同じ日・同じ案件の稼働が重なっています",
      detail:
        `${name}さんの稼働に、同じ日付・同じ案件の行が2つ以上あります：${shown}${list.length > 5 ? ` ほか ${list.length - 5}件` : ""}。` +
        `重なっている分の支払は ${yenText(extra)}です。同じ Excel を二重に取り込んでいないか確かめてください。別々の仕事なら、そのことを「確認済み」のメモに残してください。`,
      fixHref: FIX.work(monthQuery(ctx)),
      impact: impactOf(extra, "重なっている分の支払"),
    });
  }
  return out;
}

/** 保存した明細の写しから、質問の行（lineKey）の名前と金額を引く（全体の質問・見つからない行は金額なし） */
export function questionLine(draft: StatementDraft | null, lineKey: string | null): { label: string; amount: number | null } {
  if (!lineKey) return { label: "明細全体", amount: null };
  if (!draft) return { label: "明細の行", amount: null };
  const line = draft.lines.find((l) => l.projectId === lineKey);
  if (line) return { label: line.project, amount: line.amount };
  const ded = draft.deductions.find((x) => x.ruleId === lineKey);
  if (ded) return { label: `控除「${ded.name}」`, amount: ded.amount };
  const adj = /^adj:(\d+)$/.exec(lineKey);
  const a = adj ? draft.adjustments[Number(adj[1])] : undefined;
  if (a) return { label: `調整「${a.label}」`, amount: Math.abs(a.amount) };
  return { label: "前の版の行", amount: null };
}

/** この月の明細に、まだ解決にしていないドライバーの質問がある（人ごとにまとめる） */
export function openQuestions(ctx: WatchContext): IssueDraft[] {
  const byDriver = new Map<string, { statementId: string; items: NonNullable<WatchContext["questions"]> }>();
  for (const q of ctx.questions ?? []) {
    const g = byDriver.get(q.driverId) ?? { statementId: q.statementId, items: [] };
    g.items.push(q);
    byDriver.set(q.driverId, g);
  }
  const out: IssueDraft[] = [];
  for (const [driverId, g] of byDriver) {
    // 同じ行への質問は 1 行として数える（金額を二重に足さない）
    const lines = new Map<string, { label: string; amount: number | null }>();
    for (const q of g.items) lines.set(q.lineKey ?? "", q.line);
    const amounts = [...lines.values()].filter((l) => l.amount !== null);
    const first = g.items.map((q) => q.askedOn).sort()[0];
    const name = driverName(ctx, driverId);
    const days = first ? daysBetween(first, ctx.today) : 0;
    out.push({
      code: "open_questions",
      severity: "yellow",
      subjectId: driverId,
      subjectLabel: name,
      title: "明細への質問に、まだ答えていません",
      detail:
        `${name}さんから${monthOf(ctx)}の明細への質問が ${g.items.length}件あり、まだ「解決」にしていません（${[...lines.values()].map((l) => l.label).join("・")}）。` +
        (first ? `いちばん古い質問は${jpDate(first)}${days > 0 ? `（${days}日前）` : ""}です。` : "") +
        "答えてから締めると、あとで明細を作り直す手間が減ります。答え終わったら、明細の画面で「解決」にしてください。",
      fixHref: FIX.statement(g.statementId),
      impact: impactOf(amounts.length ? amounts.reduce((a, l) => a + (l.amount ?? 0), 0) : null, amounts.length ? "質問の行の金額" : "明細全体への質問のため出せません"),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 一覧

export type RuleDoc = {
  code: string;
  severities: WatchSeverity[];
  label: string;
  what: string;
  basis?: string;
  sourceUrl?: string;
  /** ルールのもとにした情報の時点（YYYY-MM）。画面に「2026年9月時点の情報」と出す */
  asOf: string;
  /** もとにした法律・制度が始まった日（これより前の月には当てない） */
  effectiveFrom?: string;
};

type RuleFn = (ctx: WatchContext) => IssueDraft[];

const AS_OF = WATCH_RULES_AS_OF_MONTH;
const FL = EFFECTIVE.freelance;

/** 並び順（重さと影響額が同じなら、この順に出す）と、画面の「見張り番が確かめていること」 */
export const RULES: { fn: RuleFn; doc: RuleDoc }[] = [
  { fn: termsMissing, doc: { code: "terms_missing", severities: ["red", "yellow"], label: "取引条件の明示", what: "稼働や差し引きがある人に、取引条件を明示した日の記録（取引条件の記録・ドライバーの設定）があるか。明示が仕事を始めたあとになっていないか", basis: BASIS.terms, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: sixtyDays, doc: { code: "sixty_days", severities: ["red", "yellow", "info"], label: "60日（2か月）の期限", what: `締め日・支払日の設定で、支払日が仕事の日から60日（2か月）を超えないか。再委託の3項目の記録がある人は、元委託の支払期日から${SUBCONTRACT_DAYS}日で数える`, basis: BASIS.payDate, sourceUrl: SOURCES.flGuidelines, asOf: AS_OF, effectiveFrom: FL } },
  { fn: paidLate, doc: { code: "paid_late", severities: ["red", "yellow"], label: "支払の遅れ", what: "振り込んだ日が明細の支払期日より後になっていないか。支払期日を過ぎても振り込んだ日の記録が無い人はいないか", basis: BASIS.payDate, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: latePaymentPrev, doc: { code: "late_payment_prev", severities: ["red"], label: "前の月の支払の遅れ", what: "前の月の振込が、その月の明細の支払期日より後になっていないか", basis: BASIS.payDate, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: feeDeducted, doc: { code: "fee_deducted", severities: ["red"], label: "振込手数料の差し引き", what: "振込手数料をドライバーの負担にしていないか（設定・控除・調整）", basis: BASIS.fee, sourceUrl: SOURCES.toritekiLeaflet, asOf: AS_OF, effectiveFrom: FL } },
  { fn: deductionNoAgreement, doc: { code: "deduction_no_agreement", severities: ["red", "yellow"], label: "控除・差し引きの合意", what: "差し引いている控除に、書面での合意と合意した日の記録があるか。事故・破損などの負担に根拠があるか", basis: BASIS.reduction, sourceUrl: SOURCES.flGuidelines, asOf: AS_OF, effectiveFrom: FL } },
  { fn: exemptOnlyCut, doc: { code: "exempt_only_cut", severities: ["red"], label: "登録の無い方だけの単価の変化", what: "同じ案件で、インボイスの登録が無い方だけ前の月より単価が下がっていないか", basis: BASIS.exemptCut, sourceUrl: SOURCES.exemptQa, asOf: AS_OF, effectiveFrom: EFFECTIVE.invoice } },
  { fn: duplicateRows, doc: { code: "duplicate_rows", severities: ["red"], label: "稼働の重なり", what: "同じ人・同じ案件・同じ日付の稼働が2行以上ないか（二重の取り込み）", asOf: AS_OF } },
  { fn: negativeTotal, doc: { code: "negative_total", severities: ["red"], label: "振込額がマイナス", what: "控除が委託料を上回って、振込額がマイナスになっていないか", asOf: AS_OF } },
  { fn: paymentWording, doc: { code: "payment_wording", severities: ["yellow", "info"], label: "支払期日の書き方", what: "取引条件の支払期日を「まで」「以内」や、請求書・検収から数える書き方にしていないか", basis: BASIS.payDate, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: rateChangedWithoutRecord, doc: { code: "rate_changed_without_record", severities: ["yellow"], label: "単価を変えた記録", what: "取引条件を明示したあとに変えた単価に、合意した日の記録があるか", basis: BASIS.terms, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: termsOutdated, doc: { code: "terms_outdated", severities: ["yellow"], label: "取引条件の記録が古い", what: "取引条件を明示した記録のあとで、単価・控除・支払期日・振込手数料の負担が変わっていないか", basis: BASIS.terms, sourceUrl: SOURCES.flQa, asOf: AS_OF, effectiveFrom: FL } },
  { fn: dedNewOrUp, doc: { code: "ded_new_or_up", severities: ["yellow"], label: "控除の追加・増額", what: "前の月の明細と比べて、新しく加わった控除・増えた控除はないか", basis: BASIS.reduction, sourceUrl: SOURCES.flGuidelines, asOf: AS_OF, effectiveFrom: FL } },
  { fn: dedPenalty, doc: { code: "ded_penalty", severities: ["yellow"], label: "違約金・ペナルティ", what: "違約金・ペナルティ・罰金の名目の控除や調整はないか", basis: BASIS.penalty, sourceUrl: SOURCES.flGuidelines, asOf: AS_OF, effectiveFrom: FL } },
  { fn: dedWithoutWork, doc: { code: "ded_without_work", severities: ["yellow"], label: "稼働の無い月の控除", what: "稼働が無い月に、控除（車両リースなど）だけを差し引いていないか", asOf: AS_OF } },
  { fn: rateDown, doc: { code: "rate_down", severities: ["yellow"], label: "単価の変化", what: "前月より単価が下がっている行（協議した記録の確認のため）", basis: BASIS.rateDown, sourceUrl: SOURCES.flGuidelines, asOf: AS_OF, effectiveFrom: FL } },
  { fn: contractEnd, doc: { code: "contract_end", severities: ["yellow"], label: "終了の予告", what: "6か月以上続いた委託を終えるとき、30日前までに予告した記録があるか", basis: BASIS.endNotice, sourceUrl: SOURCES.mhlwFl, asOf: AS_OF, effectiveFrom: FL } },
  { fn: openQuestions, doc: { code: "open_questions", severities: ["yellow"], label: "明細への質問", what: "ドライバーからの明細への質問が、答えないまま残っていないか", asOf: AS_OF } },
  { fn: noBank, doc: { code: "no_bank", severities: ["yellow"], label: "振込先の口座", what: "振込額がある人の口座がそろっていて、全銀の振込データに入るか", asOf: AS_OF } },
  { fn: qtyJump, doc: { code: "qty_jump", severities: ["yellow"], label: "数量の急な変化", what: `前月より数量の合計が ±${Math.round(QTY_JUMP_RATIO * 100)}% 以上変わった人はいないか（取り込みの漏れ・重なり）`, asOf: AS_OF } },
  { fn: statementsStale, doc: { code: "statements_stale", severities: ["yellow"], label: "明細が最新か", what: "保存した明細が、今の稼働・設定と同じか", asOf: AS_OF } },
  { fn: transitionalSpan, doc: { code: "transitional_span", severities: ["yellow"], label: "経過措置の境目", what: "締めの期間が経過措置の境目をまたぐとき、登録の無い方の稼働に日付があるか", basis: BASIS.transitional, sourceUrl: SOURCES.invoiceTransitional, asOf: AS_OF, effectiveFrom: EFFECTIVE.invoice } },
  { fn: invoiceNumber, doc: { code: "invoice_number", severities: ["yellow", "info"], label: "登録番号", what: `登録番号の形（T＋13桁）と、公表サイトで確かめた日（${REGISTRATION_CHECK_DAYS}日以内）`, basis: BASIS.invoiceNumber, sourceUrl: SOURCES.invoiceRegistry, asOf: AS_OF, effectiveFrom: EFFECTIVE.invoice } },
  { fn: invoiceBurden, doc: { code: "invoice_burden", severities: ["info"], label: "経過措置の負担", what: "インボイスの登録が無い方への支払で、会社が控除できない消費税の見込みと、次の段階", basis: BASIS.transitional, sourceUrl: SOURCES.invoiceTransitional, asOf: AS_OF, effectiveFrom: EFFECTIVE.invoice } },
  { fn: transitionalNext, doc: { code: "transitional_next", severities: ["info"], label: "経過措置の次の段", what: `経過措置の次の段が${TRANSITIONAL_NEXT_MONTHS}か月以内に始まるとき、同じ支払額での月の負担増の見込み`, basis: BASIS.transitional, sourceUrl: SOURCES.invoiceTransitional, asOf: AS_OF, effectiveFrom: EFFECTIVE.invoice } },
  { fn: toriteki, doc: { code: "toriteki", severities: ["info"], label: "取適法の目安", what: `資本金・従業員の数から、取適法の対象になる可能性があるかの目安（運送の委託：${TORITEKI_THRESHOLD_TEXT}）`, basis: BASIS.toriteki, sourceUrl: SOURCES.toritekiOverview, asOf: AS_OF, effectiveFrom: EFFECTIVE.toriteki } },
  { fn: workMissing, doc: { code: "work_missing", severities: ["info"], label: "稼働の入れ忘れ", what: "前月に稼働があった人に、その月の稼働が入っているか", asOf: AS_OF } },
];

const SEVERITY_RANK: Record<WatchSeverity, number> = { red: 0, yellow: 1, info: 2 };
const CODE_RANK = new Map(RULES.map((r, i) => [r.doc.code, i]));
const NO_IMPACT = "金額で出す指摘ではありません";

/** 影響額の大きい順（出せないものは後ろ） */
function byImpact(a: { impact?: WatchImpact | null }, b: { impact?: WatchImpact | null }): number {
  const x = a.impact?.yen ?? null;
  const y = b.impact?.yen ?? null;
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

/** 重い順 → 影響額の大きい順 → ルールの順 → 対象の名前の順 */
export function sortIssues<T extends { severity: WatchSeverity; code: string; subjectLabel: string; impact?: WatchImpact | null }>(issues: T[]): T[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      byImpact(a, b) ||
      (CODE_RANK.get(a.code) ?? 99) - (CODE_RANK.get(b.code) ?? 99) ||
      a.subjectLabel.localeCompare(b.subjectLabel, "ja"),
  );
}

/**
 * すべてのルールを当てて、重い順に並べる（確認済みの印は付けない）。
 * どの指摘にも影響額（出せないものは null）と、ルールの時点を付ける。法律が始まる前の月には、その法律のルールを当てない
 */
export function evaluateRules(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  const end = monthEnd(ctx.month.slice(0, 7));
  for (const r of RULES) {
    if (r.doc.effectiveFrom && end < r.doc.effectiveFrom) continue;
    const asOf = jpMonth(r.doc.asOf);
    for (const i of r.fn(ctx)) out.push({ ...i, asOf: i.asOf ?? asOf, impact: i.impact ?? impactOf(null, NO_IMPACT) });
  }
  // 同じ種類・同じ対象は 1 つに（重い方を残す）
  const seen = new Map<string, IssueDraft>();
  for (const i of sortIssues(out)) {
    const key = `${i.code}\u0000${i.subjectId}`;
    if (!seen.has(key)) seen.set(key, i);
  }
  return sortIssues([...seen.values()]);
}
