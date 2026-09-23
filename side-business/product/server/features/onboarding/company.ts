/**
 * 会社の基本（締め日・支払日・振込手数料・インボイスの登録番号・消費税の計算方法）の入力の確かめと、
 * 支払日が 60 日（2 か月）を超えないかの目安（純関数。画面からも読む）。
 * 60 日の数え方は、サイトと共有する部品（@/lib/tools/torihiki-joken）を使う。
 */
import { parseAmount } from "@/lib/payroll/money";
import { payRuleLabel, paymentDeadlineCheck, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";
import { normalizeRegistrationNo } from "./normalize";

/**
 * 設定の画面（会社）と同じ 3 つ。原則課税のときだけ、免税の方への支払で差し引けない消費税が出る。
 * 設定で「免税」にしてある会社が、ここで保存して原則課税に変わってしまわないよう、3 つとも選べるようにする。
 */
export type TaxMethod = "general" | "simplified" | "exempt";

export const TAX_METHODS: { value: TaxMethod; label: string; hint: string }[] = [
  { value: "general", label: "原則課税（本則課税）", hint: "仕入の消費税を差し引いて納める方法。免税の方への支払で、差し引けない消費税が出ます" },
  { value: "simplified", label: "簡易課税・2割特例", hint: "売上の消費税から納める額を出す方法。免税の方への支払による負担は計算しません" },
  { value: "exempt", label: "免税（会社が消費税を納めていない）", hint: "免税の方への支払による負担は計算しません" },
];

export const CLOSING_CHOICES = [0, 5, 10, 15, 20, 25] as const;
export const PAY_DAY_CHOICES = [5, 10, 15, 20, 25, 0] as const;

/** 0 は末日 */
export function dayText(day: number): string {
  return day <= 0 ? "末日" : `${day}日`;
}

export const OFFSET_LABEL: Record<number, string> = { 0: "当月", 1: "翌月", 2: "翌々月" };

export type CompanyBasicsInput = {
  closingDay: string;
  payMonthOffset: string;
  payDay: string;
  transferFeeBearer: string;
  registrationNo: string;
  taxMethod: string;
  paymentTermsText: string;
  /** 資本金（円）と常時使用する従業員の数。空なら「分からない・入れない」。渡さなければ今の値を変えない */
  capitalYen?: string;
  employees?: string;
};

/** 資本金・従業員の数を聞く理由（画面に 1 行で出す） */
export const SIZE_REASON = "取適法の対象かの目安に使います";
export const MAX_CAPITAL_YEN = 1_000_000_000_000;
export const MAX_EMPLOYEES = 1_000_000;

export type CompanyBasics = {
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  transferFeeBearer: "company" | "driver";
  registrationNo: string | null;
  taxMethod: TaxMethod;
  paymentTermsText: string | null;
  /** undefined は「変えない」、null は「入れない（消す）」 */
  capitalYen?: number | null;
  employees?: number | null;
};

/**
 * 資本金・従業員の数を読む（全角・カンマ・「円」「人」「万円」入りでも読む）。
 * undefined は聞いていない、null は空、number は読めた数、"error" は読めなかった
 */
function sizeNumber(raw: string | undefined, max: number, unit: "円" | "人"): number | null | undefined | "error" {
  if (raw === undefined) return undefined;
  let v = raw.normalize("NFKC").trim().replace(/[\s,，]/g, "");
  if (!v) return null;
  if (unit === "円") {
    // 「1億5000万円」「1.1万」「3億」「1000万円」「¥50,000,000」
    v = v.replace(/^[¥￥]/, "").replace(/円$/, "");
    const m = /^(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(\d+)?$/.exec(v);
    if (m && (m[1] || m[2])) {
      // 小数の掛け算は 1.1 × 10000 = 11000.000000000002 のようにずれるので、1 円未満のずれは丸める
      const exact = Number(m[1] ?? 0) * 100_000_000 + Number(m[2] ?? 0) * 10_000 + Number(m[3] ?? 0);
      const value = Math.round(exact);
      if (Math.abs(exact - value) > 1e-6 || value > max) return "error";
      return value;
    }
  } else {
    v = v.replace(/人$/, "");
  }
  const n = parseAmount(v);
  if (n === null || n < 0 || !Number.isInteger(n) || n > max) return "error";
  return n;
}

function intIn(raw: string, min: number, max: number): number | null {
  const v = raw.normalize("NFKC").trim();
  if (!/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

/** 入力を確かめる。fieldErrors が空なら value を使える */
export function checkCompanyBasics(input: CompanyBasicsInput): { value: CompanyBasics | null; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const closingDay = intIn(input.closingDay, 0, 30);
  if (closingDay === null) fieldErrors.closingDay = "締め日を選んでください";
  const payMonthOffset = intIn(input.payMonthOffset, 0, 2);
  if (payMonthOffset === null) fieldErrors.payMonthOffset = "支払う月を選んでください";
  const payDay = intIn(input.payDay, 0, 30);
  if (payDay === null) fieldErrors.payDay = "支払日を選んでください";
  if (closingDay !== null && payMonthOffset === 0 && payDay !== null) {
    const c = closingDay === 0 ? 31 : closingDay;
    const p = payDay === 0 ? 31 : payDay;
    if (p < c) fieldErrors.payDay = "当月払いにするときは、支払日を締め日と同じか後の日にしてください";
  }
  const fee = input.transferFeeBearer;
  if (fee !== "company" && fee !== "driver") fieldErrors.transferFeeBearer = "振込手数料をどちらが持つかを選んでください";
  const reg = normalizeRegistrationNo(input.registrationNo);
  if (reg.error) fieldErrors.registrationNo = reg.error;
  const tax = input.taxMethod as TaxMethod;
  if (!TAX_METHODS.some((t) => t.value === tax)) fieldErrors.taxMethod = "消費税の計算方法を選んでください";
  const terms = input.paymentTermsText.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (terms.length > 200) fieldErrors.paymentTermsText = "支払期日の文言は 200 文字までにしてください";
  const capitalYen = sizeNumber(input.capitalYen, MAX_CAPITAL_YEN, "円");
  if (capitalYen === "error") fieldErrors.capitalYen = "資本金は円の数で入れてください（例：10,000,000 または 1000万）。分からなければ空のままで構いません";
  const employees = sizeNumber(input.employees, MAX_EMPLOYEES, "人");
  if (employees === "error") fieldErrors.employees = "従業員の数は人数（整数）で入れてください。分からなければ空のままで構いません";
  if (Object.keys(fieldErrors).length) return { value: null, fieldErrors };
  return {
    value: {
      closingDay: closingDay!,
      payMonthOffset: payMonthOffset!,
      payDay: payDay!,
      transferFeeBearer: fee as "company" | "driver",
      registrationNo: reg.value,
      taxMethod: tax,
      paymentTermsText: terms || null,
      ...(capitalYen !== undefined ? { capitalYen: capitalYen as number | null } : {}),
      ...(employees !== undefined ? { employees: employees as number | null } : {}),
    },
    fieldErrors,
  };
}

function toDay(day: number): DayOfMonth {
  return day <= 0 ? "末" : day;
}

/** 「毎月末日締め・翌月25日払い」 */
export function payRuleText(closingDay: number, payMonthOffset: number, payDay: number): string {
  const offset = (Math.min(2, Math.max(0, payMonthOffset)) as PayMonthOffset);
  return payRuleLabel(toDay(closingDay), offset, toDay(payDay));
}

export type DeadlineHint = { tone: "ok" | "caution" | "ng"; text: string; maxDays: number };

/**
 * 支払日が、仕事を受け取った日から 60 日（2 か月）を超えないかの目安（記録から分かることだけを書く）。
 * today から 12 か月ぶんを数え、締め期間の最初の日の仕事がいちばん長く待つ。
 */
export function deadlineHint(closingDay: number, payMonthOffset: number, payDay: number, today: string): DeadlineHint | null {
  if (payMonthOffset < 0 || payMonthOffset > 2) return null;
  const r = paymentDeadlineCheck({ closingDay: toDay(closingDay), payMonthOffset: payMonthOffset as PayMonthOffset, payDay: toDay(payDay), serviceFrom: today });
  if (r.error) return null;
  if (r.status === "ok") {
    return { tone: "ok", maxDays: r.maxDaysFromStart, text: `締め期間の最初の日の仕事でも、支払まで最長 ${r.maxDaysFromStart}日です（60日・2か月の中に入ります）。` };
  }
  if (r.status === "caution") {
    return {
      tone: "caution",
      maxDays: r.maxDaysFromStart,
      text: `締め期間の最初の日の仕事は、支払まで最長 ${r.maxDaysFromStart}日で、受け取りから60日（2か月）を超える月があります。フリーランス法 第4条（報酬の支払期日）の数え方の確認をおすすめします。`,
    };
  }
  return {
    tone: "ng",
    maxDays: r.maxDaysFromStart,
    text: `締め日から数えても、支払まで最長 ${r.maxDaysFromEnd}日で、60日（2か月）を超える月があります。フリーランス法 第4条（報酬の支払期日）にあたるおそれがあるため、支払日の確認をおすすめします。`,
  };
}
