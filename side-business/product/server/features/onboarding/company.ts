/**
 * 会社の基本（締め日・支払日・振込手数料・インボイスの登録番号・消費税の計算方法）の入力の確かめと、
 * 支払日が 60 日（2 か月）を超えないかの目安（純関数。画面からも読む）。
 * 60 日の数え方は、サイトと共有する部品（@/lib/tools/torihiki-joken）を使う。
 */
import { payRuleLabel, paymentDeadlineCheck, type DayOfMonth, type PayMonthOffset } from "@/lib/tools/torihiki-joken";
import { normalizeRegistrationNo } from "./normalize";

/** lib（invoice-cost・payroll）と同じ 2 つ。原則課税のときだけ、免税の方への支払で差し引けない消費税が出る */
export type TaxMethod = "general" | "simplified";

export const TAX_METHODS: { value: TaxMethod; label: string; hint: string }[] = [
  { value: "general", label: "原則課税（本則課税）", hint: "仕入の消費税を差し引いて納める方法。免税の方への支払で、差し引けない消費税が出ます" },
  { value: "simplified", label: "簡易課税・2割特例", hint: "売上の消費税から納める額を出す方法。免税の方への支払による負担は計算しません" },
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
};

export type CompanyBasics = {
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  transferFeeBearer: "company" | "driver";
  registrationNo: string | null;
  taxMethod: TaxMethod;
  paymentTermsText: string | null;
};

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
