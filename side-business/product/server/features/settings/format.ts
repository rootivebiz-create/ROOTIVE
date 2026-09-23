/**
 * 設定の画面で使う、言葉と小さな計算（純関数。DB に触らない。画面の部品からも読める）。
 * - 支払日の言い方と 60 日の目安は @/lib/tools/torihiki-joken を使う（日付の数え方を自前で持たない）
 * - 控除の例の金額は roundYen（独自の丸めを書かない）
 */
import { yenText } from "@/lib/format";
import { num, percent } from "@/lib/engine/types";
import { pct, roundYen } from "@/lib/payroll/money";
import type { Rounding } from "@/lib/payroll/types";
import { TAX_RATE } from "~/server/calc/statement";
import {
  latestSafePayRule,
  paymentDeadlineCheck,
  payRuleLabel,
  type DayOfMonth,
  type DeadlineStatus,
  type PayMonthOffset,
} from "@/lib/tools/torihiki-joken";

// ---------------------------------------------------------------- 数の読み取り

/** 全角の数字・カンマ・空白・円記号を外して、半角の数の文字にする */
export function toHalfNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[,\s円¥]/g, "")
    .replace(/[ー−‐―]/g, "-");
}

/** 数として読む（空なら null、読めなければ NaN） */
export function readNumber(value: string | null | undefined): number | null {
  const s = toHalfNumber(value ?? "");
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

/** 名前を比べるための形（全角と半角・大文字と小文字・空白の違いを無視する） */
export function looseKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, "");
}

/** 画面の「10（%）」→ 保存する率 0.1（小数 4 桁まで。浮動小数の誤差を消す） */
export function percentToRate(percent: number): number {
  return Math.round(percent * 100) / 10000;
}

/** 保存した率 0.1 → 画面の「10」 */
export function rateToPercent(rate: number): number {
  return Math.round(rate * 1_000_000) / 10_000;
}

// ---------------------------------------------------------------- 言葉

export const TAX_METHODS = [
  {
    id: "general",
    label: "原則課税",
    help: "売上の消費税から、仕入れ（委託料など）の消費税を引いて納める方法。免税の方への支払で控除できない消費税（経過措置の負担）を計算します。",
  },
  {
    id: "simplified",
    label: "簡易課税",
    help: "売上の消費税から、業種ごとの割合で納める額を出す方法。経過措置の負担は計算しません。",
  },
  {
    id: "exempt",
    label: "免税（消費税を納めていない）",
    help: "会社が消費税を納めていない場合。経過措置の負担は計算しません。",
  },
] as const;

export const ROUNDING_CHOICES: { id: Rounding; label: string }[] = [
  { id: "floor", label: "切り捨て（1円未満を捨てる）" },
  { id: "round", label: "四捨五入" },
  { id: "ceil", label: "切り上げ（1円未満を1円にする）" },
];

export const ROUNDING_LABEL: Record<Rounding, string> = { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" };

export const ACCOUNT_TYPE_LABEL = { ordinary: "普通", checking: "当座" } as const;

export const ROLE_LABEL = { owner: "オーナー", staff: "事務", viewer: "閲覧" } as const;

export const ROLE_HELP = {
  owner: "すべて。利用者の管理・会社の設定・締めの解除もできます",
  staff: "登録・取り込み・明細・振込データ・締め",
  viewer: "見るだけ（変えられません）",
} as const;

export const RULE_KIND_LABEL = { percent: "委託料 × 率", fixed: "毎月の定額", per_unit: "数量 × 単価" } as const;

/** 振込手数料の負担についての注意（見張り番と同じ文） */
export const FEE_BEARER_WARNING = "振込手数料をドライバーの負担にすると、報酬の減額にあたるおそれがあります（合意があっても）。";

/** 控除の合意の記録が無いときの注意 */
export const NO_AGREEMENT_WARNING = "合意の記録が無い控除は、報酬の減額にあたるおそれがあります";

/** 単価を変えたときの注意 */
export const RATE_CHANGE_HINT = "単価を変えたら取引条件の変更を書面等で明示し、合意の日を残してください。";

/** 明細の注記（何日以内に連絡が無ければ確認とみなすか）。明細の計算と同じ文を使う */
export { deemedNote } from "~/server/calc/statement";

/** 決まった形の注記（日数だけ違う）か。そうなら保存しない（明細の計算が「確認とみなすまでの日数」から同じ形の文を作る） */
export function isStandardNote(text: string): boolean {
  return /^記載内容に誤りがある場合は、受け取りから\d+日以内にご連絡ください。ご連絡がない場合は、内容を確認いただいたものとします。$/.test(text.trim());
}

// ---------------------------------------------------------------- 支払日

/** DB の日（0＝末日）→ 道具の日（"末"） */
export function toDayOfMonth(day: number): DayOfMonth {
  return day >= 1 && day <= 30 ? day : "末";
}

export function toPayMonthOffset(n: number): PayMonthOffset {
  return n <= 0 ? 0 : n >= 2 ? 2 : 1;
}

/** 「毎月末日締め・翌月25日払い」 */
export function payRuleSentence(closingDay: number, payMonthOffset: number, payDay: number): string {
  return payRuleLabel(toDayOfMonth(closingDay), toPayMonthOffset(payMonthOffset), toDayOfMonth(payDay));
}

export type DeadlineHint = { status: DeadlineStatus | "error"; text: string; safer: string | null };

/**
 * 60 日（2 か月）の目安。これから 12 か月の支払日を、締め期間の最初の日・締め日から数えた期限と比べる。
 * 銀行の休みの日（土日・年末年始）は前の営業日にずらして数える（祝日は入れていない）。
 */
export function deadlineHint(closingDay: number, payMonthOffset: number, payDay: number, today: string): DeadlineHint {
  const closing = toDayOfMonth(closingDay);
  const r = paymentDeadlineCheck({
    closingDay: closing,
    payMonthOffset: toPayMonthOffset(payMonthOffset),
    payDay: toDayOfMonth(payDay),
    holidayRule: "before",
    serviceFrom: today,
    months: 12,
  });
  if (r.error) return { status: "error", text: r.error, safer: null };
  const n = r.rows.length;
  const safe = r.status === "ok" ? null : latestSafePayRule({ closingDay: closing, holidayRule: "before", serviceFrom: today, months: 12 });
  const safer = safe ? `「${safe.ruleLabel}」までなら、12か月すべてで締め期間の最初の日から60日（2か月）以内です。` : null;
  if (r.status === "ok") {
    return {
      status: "ok",
      text: `これから${n}か月の支払日は、締め期間の最初の日の仕事の分も、受け取った日から60日（2か月）以内です。`,
      safer: null,
    };
  }
  if (r.status === "caution") {
    return {
      status: "caution",
      text: `締め期間の最初の日から数えると、${n}か月のうち${r.counts.caution}か月で支払日が60日（2か月）を超えます（締め日から数えれば60日以内です）。締め日から数えられるのは、月ごとに締めてまとめて払うことと報酬の額（算定方法）を取引条件に書いている場合です。取引条件の確認をおすすめします。`,
      safer,
    };
  }
  return {
    status: "ng",
    text: `締め日から数えても、${n}か月のうち${r.counts.ng}か月で支払日が60日（2か月）を超えます。フリーランス法では、支払期日は仕事を受け取った日から60日以内のできるだけ早い日に定めることになっています。支払日の設定の確認をおすすめします。`,
    safer,
  };
}

/** 取引条件の支払期日の文言に、見張り番が気にする言葉が入っているか */
export function wordingWarnings(text: string, periodWords: readonly string[], startWords: readonly string[]): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  const period = periodWords.filter((w) => t.includes(w));
  const start = startWords.filter((w) => t.includes(w));
  if (period.length) {
    out.push(`「${period.join("」「")}」のように期間で書くと、支払う日が一つに決まらず、支払期日を定めたことにならないおそれがあります。「毎月末日締め・翌月25日払い」のように日を特定できる書き方の確認をおすすめします。`);
  }
  if (start.length) {
    out.push(`「${start.join("」「")}」から数える書き方は、請求書や検収が遅れると、仕事を受け取った日から60日を超えるおそれがあります。`);
  }
  return out;
}

// ---------------------------------------------------------------- 単価と控除

/** 単価の表示（小数を残す）：155.5 → 155.5円 */
export function rateText(value: number): string {
  return `${num(value)}円`;
}

/** 1 数量あたりの粗利（受注 − 支払）と、受注単価に対する割合 */
export function marginOf(billRate: number, payRate: number): { perUnit: number; ratio: number | null; label: string; loss: boolean } {
  const perUnit = Math.round((billRate - payRate) * 1e4) / 1e4;
  const ratio = billRate > 0 ? perUnit / billRate : null;
  return {
    perUnit,
    ratio,
    label: ratio === null ? `${num(perUnit)}円` : `${num(perUnit)}円（${pct(ratio)}）`,
    loss: payRate > billRate,
  };
}

/** 控除の例の文。「例：委託料 300,000円 の人は 30,000円」 */
export function rulePreview(
  rule: { kind: "percent" | "fixed" | "per_unit"; rate: number | null; amount: number | null; taxable: boolean; onlyWhenWorked: boolean },
  rounding: { amount: Rounding; tax: Rounding },
): string {
  const taxOf = (x: number) => (rule.taxable ? roundYen(x * TAX_RATE, rounding.tax) : 0);
  const withTax = (x: number) => {
    const t = taxOf(x);
    return t ? `（消費税 ${yenText(t)} も合わせて差し引きます）` : "";
  };
  if (rule.kind === "percent") {
    const x = roundYen(300_000 * (rule.rate ?? 0), rounding.amount);
    return `例：委託料 300,000円 の人は ${yenText(x)}${withTax(x)}`;
  }
  if (rule.kind === "per_unit") {
    const x = roundYen(1_000 * (rule.rate ?? 0), rounding.amount);
    return `例：その月の数量の合計が 1,000 の人は ${yenText(x)}${withTax(x)}`;
  }
  const x = rule.amount ?? 0;
  return `毎月 ${yenText(x)}${withTax(x)}・${rule.onlyWhenWorked ? "稼働がある月だけ" : "稼働が無い月も"}`;
}

/**
 * 控除の名前を比べる形。明細の計算（server/calc/statement.ts の rulesFor）と同じ：NFKC にして空白を外すだけ。
 * これが同じなら、この人だけの控除が全員の控除の代わりになる（テストで rulesFor と同じ結果になることを確かめる）
 */
export function ruleNameKey(name: string): string {
  return name.normalize("NFKC").replace(/\s/g, "");
}

/** 控除の中身を 1 行で。「委託料 × 10%」「毎月 15,000円」「数量 × 10円」 */
export function ruleValueText(rule: { kind: string; rate: number | null; amount: number | null }): string {
  if (rule.kind === "percent") return `委託料 × ${percent(rule.rate ?? 0)}`;
  if (rule.kind === "per_unit") return `数量 × ${rateText(rule.rate ?? 0)}`;
  return `毎月 ${yenText(rule.amount ?? 0)}`;
}

// ---------------------------------------------------------------- ドライバー

/** 口座番号を一部だけ見せる（閲覧の人向け）：1234567 → ****567 */
export function maskAccount(no: string | null): string {
  if (!no) return "";
  return `${"*".repeat(Math.max(0, no.length - 3))}${no.slice(-3)}`;
}

export type DriverFlags = {
  invoiceRegistered: boolean;
  registrationNo: string | null;
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  holderKana: string | null;
  termsIssuedOn: string | null;
  active: boolean;
};

export function hasBank(d: Pick<DriverFlags, "bankCode" | "branchCode" | "accountNumber" | "holderKana">): boolean {
  return !!(d.bankCode && d.branchCode && d.accountNumber && d.holderKana);
}

export type Tone = "red" | "yellow" | "green" | "gray";

/** 一覧のしるし（インボイス・口座・取引条件の明示・無効） */
export function driverBadges(d: DriverFlags): { tone: Tone; label: string }[] {
  const out: { tone: Tone; label: string }[] = [];
  if (!d.active) out.push({ tone: "gray", label: "無効" });
  out.push(d.invoiceRegistered ? { tone: "green", label: "インボイス登録" } : { tone: "gray", label: "インボイス未登録" });
  if (!hasBank(d)) out.push({ tone: "red", label: "口座なし" });
  if (!d.termsIssuedOn) out.push({ tone: "yellow", label: "取引条件の明示なし" });
  return out;
}

/** 2 つの日付の間の日数（b − a） */
export function daysBetweenDates(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 日本の今日（YYYY-MM-DD） */
export function todayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
