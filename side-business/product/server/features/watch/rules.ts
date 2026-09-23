/**
 * 見張り番のルール（純関数。DB に触らない）。材料は WatchContext（context.ts が集める）。
 *
 * 決まり：
 * - 記録から分かること（日付・金額・名前）と「〜のおそれがあります」「確認をおすすめします」までを書く。
 *   法令に合っているかの判定、税や法律の結論、ドライバーの報酬を下げる話は書かない。
 * - 60 日の数え方は @/lib/tools/torihiki-joken、経過措置の割合は @/lib/payroll/tax を使う（日付の計算を自前で持たない）。
 * - 金額は明細（StatementDraft）の値をそのまま使う。独自の丸めを書かない。
 */
import { jpDate, jpMonth, yenText } from "@/lib/format";
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
import type { IssueDraft, WatchContext, WatchDriver, WatchImpact, WatchSeverity, WatchSubcontract, WatchTerms } from "~/server/features/watch/types";

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
/** 経過措置の次の段が、この月数のうちに始まるならお知らせする */
export const TRANSITIONAL_NEXT_MONTHS = 6;
/** 再委託の特例：元委託の支払期日から数える日数 */
export const SUBCONTRACT_DAYS = 30;

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
    const limit = addDays(orig, SUBCONTRACT_DAYS);
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
        fixHref: FIX.drivers,
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
          `会社の設定では ${facts}です。取適法の対象になる可能性があります。支払期日・手形の禁止・書面の保存などを弁護士等にご確認ください。` +
          "（目安です。対象になるかは、取引の内容と、相手の資本金・従業員の数で決まり、取引の区分ごとに基準が違います）",
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
      });
      continue;
    }
    const checked = drv.registrationCheckedOn;
    if (!checked || daysBetween(checked, ctx.today) > REGISTRATION_CHECK_DAYS) stale.push(drv);
  }
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
    });
  }
  return out;
}

export function statementsStale(ctx: WatchContext): IssueDraft[] {
  const st = ctx.statementsStatus;
  if (ctx.closed || !st || st.upToDate) return [];
  const changed = st.missing + st.stale + st.orphan;
  if (changed === 0) return [];
  const base = { code: "statements_stale", severity: "yellow" as const, subjectId: "statements", subjectLabel: "支払明細", fixHref: FIX.statements(monthQuery(ctx)) };
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
    });
  }
  return out;
}

// ---------------------------------------------------------------- 一覧

export type RuleDoc = { code: string; severities: WatchSeverity[]; label: string; what: string; basis?: string; sourceUrl?: string };

type RuleFn = (ctx: WatchContext) => IssueDraft[];

/** 並び順（重さが同じなら、この順に出す）と、画面の「見張り番が確かめていること」 */
export const RULES: { fn: RuleFn; doc: RuleDoc }[] = [
  { fn: termsMissing, doc: { code: "terms_missing", severities: ["red", "yellow"], label: "取引条件の明示", what: "稼働や差し引きがある人に、取引条件を明示した日の記録があるか。明示が仕事を始めたあとになっていないか", basis: BASIS.terms, sourceUrl: SOURCES.flQa } },
  { fn: sixtyDays, doc: { code: "sixty_days", severities: ["red", "yellow"], label: "60日（2か月）の期限", what: "締め日・支払日の設定で、支払日が仕事の日から60日（2か月）を超えないか", basis: BASIS.payDate, sourceUrl: SOURCES.flGuidelines } },
  { fn: paidLate, doc: { code: "paid_late", severities: ["red", "yellow"], label: "支払の遅れ", what: "振り込んだ日が明細の支払期日より後になっていないか。支払期日を過ぎても振り込んだ日の記録が無い人はいないか", basis: BASIS.payDate, sourceUrl: SOURCES.flQa } },
  { fn: feeDeducted, doc: { code: "fee_deducted", severities: ["red"], label: "振込手数料の差し引き", what: "振込手数料をドライバーの負担にしていないか（設定・控除・調整）", basis: BASIS.fee, sourceUrl: SOURCES.toritekiLeaflet } },
  { fn: deductionNoAgreement, doc: { code: "deduction_no_agreement", severities: ["red", "yellow"], label: "控除・差し引きの合意", what: "差し引いている控除に、書面での合意と合意した日の記録があるか。事故・破損などの負担に根拠があるか", basis: BASIS.reduction, sourceUrl: SOURCES.flGuidelines } },
  { fn: negativeTotal, doc: { code: "negative_total", severities: ["red"], label: "振込額がマイナス", what: "控除が委託料を上回って、振込額がマイナスになっていないか" } },
  { fn: paymentWording, doc: { code: "payment_wording", severities: ["yellow", "info"], label: "支払期日の書き方", what: "取引条件の支払期日を「まで」「以内」や、請求書・検収から数える書き方にしていないか", basis: BASIS.payDate, sourceUrl: SOURCES.flQa } },
  { fn: rateChangedWithoutRecord, doc: { code: "rate_changed_without_record", severities: ["yellow"], label: "単価を変えた記録", what: "取引条件を明示したあとに変えた単価に、合意した日の記録があるか", basis: BASIS.terms, sourceUrl: SOURCES.flQa } },
  { fn: rateDown, doc: { code: "rate_down", severities: ["yellow"], label: "単価の変化", what: "前月より単価が下がっている行（協議した記録の確認のため）", basis: BASIS.rateDown, sourceUrl: SOURCES.flGuidelines } },
  { fn: contractEnd, doc: { code: "contract_end", severities: ["yellow"], label: "終了の予告", what: "6か月以上続いた委託を終えるとき、30日前までに予告した記録があるか", basis: BASIS.endNotice, sourceUrl: SOURCES.mhlwFl } },
  { fn: noBank, doc: { code: "no_bank", severities: ["yellow"], label: "振込先の口座", what: "振込額がある人の口座がそろっていて、全銀の振込データに入るか" } },
  { fn: qtyJump, doc: { code: "qty_jump", severities: ["yellow"], label: "数量の急な変化", what: `前月より数量の合計が ±${Math.round(QTY_JUMP_RATIO * 100)}% 以上変わった人はいないか（取り込みの漏れ・重なり）` } },
  { fn: statementsStale, doc: { code: "statements_stale", severities: ["yellow"], label: "明細が最新か", what: "保存した明細が、今の稼働・設定と同じか" } },
  { fn: invoiceNumber, doc: { code: "invoice_number", severities: ["yellow", "info"], label: "登録番号", what: `登録番号の形（T＋13桁）と、公表サイトで確かめた日（${REGISTRATION_CHECK_DAYS}日以内）`, basis: BASIS.invoiceNumber, sourceUrl: SOURCES.invoiceRegistry } },
  { fn: invoiceBurden, doc: { code: "invoice_burden", severities: ["info"], label: "経過措置の負担", what: "インボイスの登録が無い方への支払で、会社が控除できない消費税の見込みと、次の段階", basis: BASIS.transitional, sourceUrl: SOURCES.invoiceTransitional } },
  { fn: toriteki, doc: { code: "toriteki", severities: ["info"], label: "取適法の目安", what: "資本金・従業員の数から、取適法の対象になる可能性があるかの目安", basis: BASIS.toriteki, sourceUrl: SOURCES.toritekiOverview } },
  { fn: workMissing, doc: { code: "work_missing", severities: ["info"], label: "稼働の入れ忘れ", what: "前月に稼働があった人に、その月の稼働が入っているか" } },
];

const SEVERITY_RANK: Record<WatchSeverity, number> = { red: 0, yellow: 1, info: 2 };
const CODE_RANK = new Map(RULES.map((r, i) => [r.doc.code, i]));

/** 重い順 → ルールの順 → 対象の名前の順 */
export function sortIssues<T extends { severity: WatchSeverity; code: string; subjectLabel: string }>(issues: T[]): T[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (CODE_RANK.get(a.code) ?? 99) - (CODE_RANK.get(b.code) ?? 99) ||
      a.subjectLabel.localeCompare(b.subjectLabel, "ja"),
  );
}

/** すべてのルールを当てて、重い順に並べる（確認済みの印は付けない） */
export function evaluateRules(ctx: WatchContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  for (const r of RULES) out.push(...r.fn(ctx));
  // 同じ種類・同じ対象は 1 つに（重い方を残す）
  const seen = new Map<string, IssueDraft>();
  for (const i of sortIssues(out)) {
    const key = `${i.code}\u0000${i.subjectId}`;
    if (!seen.has(key)) seen.set(key, i);
  }
  return sortIssues([...seen.values()]);
}
