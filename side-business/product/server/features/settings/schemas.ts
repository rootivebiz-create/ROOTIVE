/**
 * 設定の入力の確かめ（zod）。純粋なもの（DB に触らない）なので、テストからも直接使える。
 *
 * - 数は全角・カンマ・「円」つきでも読む（NFKC で半角にしてからカンマを外す）
 * - 登録番号は「T＋13 桁」。数字 13 桁だけなら頭に T を付ける
 * - 口座は 金融機関 4 桁・支店 3 桁・口座番号 7 桁まで（保存するときは 7 桁に 0 で埋める）
 * - 振込データに入るカナは toZenginKana で半角にして保存する（使えない文字はその字を出して止める）
 */
import { z } from "zod";
import { WITHHOLDING_CATEGORY_ORDER, type WithholdingCategory } from "@/lib/engine/withholding";
import { toZenginKana } from "@/lib/payroll/zengin";
import { isDateString, validateDeadlineInput } from "@/lib/tools/torihiki-joken";
import { looseKey, percentToRate, plainSizeText, rateToPercent, readNumber, toDayOfMonth, toHalfNumber, toPayMonthOffset } from "./format";

// ---------------------------------------------------------------- 小さな部品

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REG_NO_RE = /^T\d{13}$/;

export { looseKey, percentToRate, rateToPercent, readNumber, toHalfNumber };

/** 登録番号をそろえる（全角・空白・ハイフンを外し、数字 13 桁なら T を付ける） */
export function normalizeRegNo(value: string): string {
  const s = value.normalize("NFKC").toUpperCase().replace(/[\s\-‐−ー]/g, "");
  return /^\d{13}$/.test(s) ? `T${s}` : s;
}

/** 数字だけの項目（銀行コードなど）：全角・空白・ハイフンを外す */
export function digitsOnly(value: string): string {
  return value.normalize("NFKC").replace(/[\s\-‐−ー]/g, "");
}

/** 別名：カンマ・読点・改行で区切る。空・重複・名前と同じものは外す */
export function splitAliases(value: string, name = ""): string[] {
  const own = looseKey(name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,、，\n]/)) {
    const a = raw.trim();
    const key = looseKey(a);
    if (!a || !key || key === own || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

const text = (label: string, max: number) =>
  z
    .string({ error: `${label}を入れてください` })
    .trim()
    .min(1, `${label}を入れてください`)
    .max(max, `${label}は ${max} 文字までにしてください`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v.length <= max, `${label}は ${max} 文字までにしてください`)
    .transform((v) => (v ? v : null));

/** チェックボックス（送られてくるのは "on"。無ければ false） */
export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const idSchema = (message: string) => z.string().trim().regex(UUID, message);

export const optionalIdSchema = (message: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v === "" || UUID.test(v), message)
    .transform((v) => (v ? v : null));

export const optionalDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .refine((v) => v === "" || isDateString(v), `${label}は日付で入れてください（例：2026-10-01）`)
    .transform((v) => (v ? v : null));

type NumberOpts = { min?: number; max?: number; decimals?: number; example?: string };

function checkNumber(label: string, n: number, o: NumberOpts): string | null {
  const ex = o.example ? `（例：${o.example}）` : "";
  if (Number.isNaN(n)) return `${label}は数で入れてください${ex}`;
  const decimals = o.decimals ?? 0;
  if (decimals === 0 && !Number.isInteger(n)) return `${label}は整数で入れてください${ex}`;
  if (decimals > 0 && Math.abs(n * 10 ** decimals - Math.round(n * 10 ** decimals)) > 1e-6) return `${label}の小数は ${decimals} 桁までにしてください`;
  if (o.min !== undefined && n < o.min) return `${label}は ${o.min.toLocaleString("ja-JP")} 以上にしてください`;
  if (o.max !== undefined && n > o.max) return `${label}が大きすぎます（${o.max.toLocaleString("ja-JP")} まで）。桁を確かめてください`;
  return null;
}

/** 必ず入れる数 */
export const requiredNumber = (label: string, o: NumberOpts = {}) =>
  z
    .string({ error: `${label}を入れてください` })
    .transform((raw, ctx) => {
      const n = readNumber(raw);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: `${label}を入れてください` });
        return z.NEVER;
      }
      const problem = checkNumber(label, n, o);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return n;
    });

/** 入れなくてもよい数（空なら null） */
export const optionalNumber = (label: string, o: NumberOpts = {}) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const n = readNumber(raw);
      if (n === null) return null;
      const problem = checkNumber(label, n, o);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return n;
    });

/** 振込データに入れるカナ（半角にして返す）。max は半角の文字数 */
export const zenginKana = (label: string, max: number, hint = "") =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const v = (raw ?? "").trim();
      if (!v) return null;
      const { value, invalid } = toZenginKana(v);
      if (invalid.length) {
        ctx.addIssue({ code: "custom", message: `${label}に振込データで使えない文字があります：「${[...new Set(invalid)].join("")}」。カナ・英大文字・数字で入れてください` });
        return z.NEVER;
      }
      if (!value) return null;
      if (value.length > max) {
        ctx.addIssue({ code: "custom", message: `${label}は振込データに入るのが半角 ${max} 文字までです（いまは ${value.length} 文字）。${hint}` });
        return z.NEVER;
      }
      return value;
    });

const regNoField = z
  .string()
  .optional()
  .transform((v) => normalizeRegNo(v ?? ""))
  .refine((v) => v === "" || REG_NO_RE.test(v), "登録番号は「T」と 13 桁の数字です（例：T1234567890123）")
  .transform((v) => (v ? v : null));

const rounding = z.enum(["floor", "round", "ceil"], { error: "端数の扱いを選んでください" });

const dayOfMonth = (label: string) =>
  requiredNumber(label, { min: 0, max: 31 }).transform((n) => (n >= 31 ? 0 : n));

// ---------------------------------------------------------------- 会社

export const companySchema = z
  .object({
    name: text("会社名", 100),
    registrationNo: regNoField,
    taxMethod: z.enum(["general", "simplified", "exempt"], { error: "消費税の計算のしかたを選んでください" }),
    payTaxToExempt: checkbox,
    taxRounding: rounding,
    amountRounding: rounding,
    closingDay: dayOfMonth("締め日"),
    payMonthOffset: requiredNumber("支払う月", { min: 0, max: 2 }),
    payDay: dayOfMonth("支払日"),
    paymentTermsText: optionalText("支払期日の文言", 300),
    transferFeeBearer: z.enum(["company", "driver"], { error: "振込手数料をどちらが持つか選んでください" }),
    // 「1,000万円」「12人」の書き方でも読む（最初の設定の案内と同じ）
    capitalYen: z.preprocess((v) => (typeof v === "string" ? plainSizeText(v, "円") : v), optionalNumber("資本金", { min: 0, max: 1_000_000_000_000, example: "10,000,000" })),
    employees: z.preprocess((v) => (typeof v === "string" ? plainSizeText(v, "人") : v), optionalNumber("従業員の数", { min: 0, max: 1_000_000 })),
    deemedConfirmDays: optionalNumber("確認とみなすまでの日数", { min: 1, max: 60 }).transform((v) => v ?? 7),
    statementNote: optionalText("明細の注記", 400),
    requesterCode: z
      .string()
      .optional()
      .transform((v) => digitsOnly(v ?? ""))
      .refine((v) => v === "" || /^\d{10}$/.test(v), "依頼人コードは 10 桁の数字です（銀行から知らされる番号）"),
    requesterName: zenginKana("依頼人名", 40, "「株式会社」は「ｶ)」のように略して入れてください"),
    requesterBankCode: z
      .string()
      .optional()
      .transform((v) => digitsOnly(v ?? ""))
      .refine((v) => v === "" || /^\d{4}$/.test(v), "金融機関コードは 4 桁の数字です"),
    requesterBankName: zenginKana("金融機関名", 15),
    requesterBranchCode: z
      .string()
      .optional()
      .transform((v) => digitsOnly(v ?? ""))
      .refine((v) => v === "" || /^\d{3}$/.test(v), "支店コードは 3 桁の数字です"),
    requesterBranchName: zenginKana("支店名", 15),
    requesterAccountType: z.enum(["ordinary", "checking"], { error: "預金の種類を選んでください" }),
    requesterAccountNumber: z
      .string()
      .optional()
      .transform((v) => digitsOnly(v ?? ""))
      .refine((v) => v === "" || /^\d{1,7}$/.test(v), "口座番号は 7 桁までの数字です"),
  })
  .superRefine((v, ctx) => {
    // 当月払いで、支払日が締め日より前になっていないか（サイトの道具と同じ確かめ方）
    const problem = validateDeadlineInput({
      closingDay: toDayOfMonth(v.closingDay),
      payMonthOffset: toPayMonthOffset(v.payMonthOffset),
      payDay: toDayOfMonth(v.payDay),
    });
    if (problem) ctx.addIssue({ code: "custom", path: ["payDay"], message: problem });
    // 振込依頼人：どれか 1 つでも入れたら、振込データに要るものはそろえる
    const parts = {
      requesterCode: v.requesterCode,
      requesterName: v.requesterName,
      requesterBankCode: v.requesterBankCode,
      requesterBranchCode: v.requesterBranchCode,
      requesterAccountNumber: v.requesterAccountNumber,
    };
    // 金融機関名・支店名だけを入れた場合も「入れ始めた」とみなす（黙って捨てないように）
    const filled = Object.values(parts).some((x) => !!x) || !!v.requesterBankName || !!v.requesterBranchName;
    if (filled) {
      const labels: Record<string, string> = {
        requesterCode: "依頼人コード",
        requesterName: "依頼人名",
        requesterBankCode: "金融機関コード",
        requesterBranchCode: "支店コード",
        requesterAccountNumber: "口座番号",
      };
      for (const [key, val] of Object.entries(parts)) {
        if (!val) ctx.addIssue({ code: "custom", path: [key], message: `振込データを作るには${labels[key]}も要ります` });
      }
    }
  });
export type CompanyInput = z.output<typeof companySchema>;

// ---------------------------------------------------------------- ドライバー

const bankCode = z
  .string()
  .optional()
  .transform((v) => digitsOnly(v ?? ""))
  .refine((v) => v === "" || /^\d{4}$/.test(v), "金融機関コードは 4 桁の数字です（例：ゆうちょ銀行は 9900）")
  .transform((v) => (v ? v : null));

const branchCode = z
  .string()
  .optional()
  .transform((v) => digitsOnly(v ?? ""))
  .refine((v) => v === "" || /^\d{3}$/.test(v), "支店コードは 3 桁の数字です")
  .transform((v) => (v ? v : null));

const accountNumber = z
  .string()
  .optional()
  .transform((v) => digitsOnly(v ?? ""))
  .refine((v) => v === "" || /^\d{1,7}$/.test(v), "口座番号は 7 桁までの数字です（ゆうちょ銀行は、振込用の店名・口座番号を入れてください）")
  .transform((v) => (v ? v.padStart(7, "0") : null));

const withholding = z
  .string()
  .optional()
  .transform((v) => (v ? v : "none"))
  .refine((v): v is WithholdingCategory => (WITHHOLDING_CATEGORY_ORDER as string[]).includes(v), "源泉徴収の区分を選び直してください");

export const driverSchema = z
  .object({
    code: optionalText("番号", 20),
    name: text("名前", 60),
    kana: optionalText("フリガナ", 60),
    aliases: z.string().optional().transform((v) => v ?? ""),
    email: z
      .string()
      .optional()
      .transform((v) => (v ?? "").trim().toLowerCase())
      .refine((v) => v === "" || z.email().safeParse(v).success, "メールアドレスの形が正しくありません")
      .transform((v) => (v ? v : null)),
    phone: z
      .string()
      .optional()
      // 「090ー1234ー5678」（長音）や全角のハイフンも「-」にそろえる
      .transform((v) => (v ?? "").normalize("NFKC").replace(/[ー−‐―]/g, "-").trim())
      .refine((v) => v === "" || /^[0-9+\-() ]{6,20}$/.test(v), "電話番号は数字とハイフンで入れてください（例：090-1234-5678）")
      .transform((v) => (v ? v : null)),
    invoiceRegistered: checkbox,
    registrationNo: regNoField,
    registrationCheckedOn: optionalDate("公表サイトで確かめた日"),
    isCorporation: checkbox,
    withholdingCategory: withholding,
    bankCode,
    bankNameKana: zenginKana("金融機関名（カナ）", 15),
    branchCode,
    branchNameKana: zenginKana("支店名（カナ）", 15),
    accountType: z.enum(["ordinary", "checking"], { error: "預金の種類を選んでください" }),
    accountNumber,
    holderKana: zenginKana("口座名義（カナ）", 30, "「株式会社」は「ｶ)」のように略して入れてください"),
    termsIssuedOn: optionalDate("取引条件を明示した日"),
    startedOn: optionalDate("委託を始めた日"),
    endOn: optionalDate("委託の終了日"),
    endNoticedOn: optionalDate("終了を伝えた日"),
    active: checkbox,
    notes: optionalText("メモ", 500),
  })
  .transform((v) => ({ ...v, aliases: splitAliases(v.aliases, v.name) }))
  .superRefine((v, ctx) => {
    if (v.invoiceRegistered && !v.registrationNo) {
      ctx.addIssue({ code: "custom", path: ["registrationNo"], message: "登録している方は、登録番号（T＋13 桁）を入れてください" });
    }
    if (v.aliases.length > 20) ctx.addIssue({ code: "custom", path: ["aliases"], message: "別名は 20 個までにしてください" });
    if (v.aliases.some((a) => a.length > 60)) ctx.addIssue({ code: "custom", path: ["aliases"], message: "別名は 1 つ 60 文字までにしてください" });
    // 口座：どれか 1 つでも入れたら、振込に要る 4 つをそろえる
    const bank = { bankCode: v.bankCode, branchCode: v.branchCode, accountNumber: v.accountNumber, holderKana: v.holderKana };
    if (Object.values(bank).some((x) => !!x) || v.bankNameKana || v.branchNameKana) {
      const labels = { bankCode: "金融機関コード", branchCode: "支店コード", accountNumber: "口座番号", holderKana: "口座名義（カナ）" } as const;
      for (const key of Object.keys(bank) as (keyof typeof bank)[]) {
        if (!bank[key]) ctx.addIssue({ code: "custom", path: [key], message: `口座を入れるときは${labels[key]}も入れてください` });
      }
    }
    if (v.startedOn && v.endOn && v.endOn < v.startedOn) {
      ctx.addIssue({ code: "custom", path: ["endOn"], message: "終了日が、委託を始めた日より前になっています" });
    }
    if (v.endNoticedOn && v.endOn && v.endNoticedOn > v.endOn) {
      ctx.addIssue({ code: "custom", path: ["endNoticedOn"], message: "終了を伝えた日が、終了日より後になっています" });
    }
    if (v.endNoticedOn && !v.endOn) {
      ctx.addIssue({ code: "custom", path: ["endOn"], message: "終了を伝えた日を入れるときは、終了日も入れてください" });
    }
  });
export type DriverInput = z.output<typeof driverSchema>;

// ---------------------------------------------------------------- 元請・案件

export const clientSchema = z
  .object({
    name: text("元請の名前", 100),
    aliases: z.string().optional().transform((v) => v ?? ""),
    closingDay: dayOfMonth("元請の締め日"),
    notes: optionalText("メモ", 500),
  })
  .transform((v) => ({ ...v, aliases: splitAliases(v.aliases, v.name) }))
  .superRefine((v, ctx) => {
    if (v.aliases.length > 20) ctx.addIssue({ code: "custom", path: ["aliases"], message: "別名は 20 個までにしてください" });
  });
export type ClientInput = z.output<typeof clientSchema>;

/** 数量の単位（よく使うもの。ほかの書き方も入れられる） */
export const UNIT_CHOICES = ["個", "件", "日", "時間", "便", "台", "回"] as const;

export const projectSchema = z
  .object({
    clientId: optionalIdSchema("元請を選び直してください"),
    name: text("案件の名前", 100),
    aliases: z.string().optional().transform((v) => v ?? ""),
    unit: text("単位", 10),
    billRate: requiredNumber("受注単価", { min: 0, max: 100_000_000, decimals: 4, example: "190" }),
    payRate: requiredNumber("支払単価", { min: 0, max: 100_000_000, decimals: 4, example: "150" }),
    active: checkbox,
  })
  .transform((v) => ({ ...v, aliases: splitAliases(v.aliases, v.name) }))
  .superRefine((v, ctx) => {
    if (v.aliases.length > 20) ctx.addIssue({ code: "custom", path: ["aliases"], message: "別名は 20 個までにしてください" });
  });
export type ProjectInput = z.output<typeof projectSchema>;

// ---------------------------------------------------------------- ドライバー別の単価

export const overrideSchema = z.object({
  driverId: idSchema("ドライバーを選んでください"),
  projectId: idSchema("案件を選んでください"),
  payRate: requiredNumber("この人の支払単価", { min: 0, max: 100_000_000, decimals: 4, example: "155" }),
  agreedOn: optionalDate("合意した日"),
});
export type OverrideInput = z.output<typeof overrideSchema>;

// ---------------------------------------------------------------- 控除のルール

export const RULE_KINDS = ["percent", "fixed", "per_unit"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const ruleSchema = z
  .object({
    name: text("控除の名前", 60),
    driverId: optionalIdSchema("ドライバーを選び直してください"),
    kind: z.enum(RULE_KINDS, { error: "引き方を選んでください" }),
    /** percent は「10」＝10%、fixed は円／月、per_unit は円／数量 */
    value: z.string({ error: "額か率を入れてください" }),
    onlyWhenWorked: checkbox,
    taxable: checkbox,
    agreedInWriting: checkbox,
    agreedOn: optionalDate("合意した日"),
    basis: optionalText("根拠", 200),
    active: checkbox,
    sort: optionalNumber("並び順", { min: 0, max: 9999 }).transform((v) => v ?? 0),
  })
  .transform((v, ctx) => {
    // 率は「10%」「１０％」と書いても読む（% を外す）
    const n = readNumber(v.kind === "percent" ? v.value.normalize("NFKC").replace(/%/g, "") : v.value);
    const base = { ...v, rate: null as number | null, amount: null as number | null };
    if (n === null) {
      ctx.addIssue({ code: "custom", path: ["value"], message: v.kind === "percent" ? "率を入れてください（例：10）" : "金額を入れてください" });
      return z.NEVER;
    }
    if (v.kind === "percent") {
      const problem = checkNumber("率", n, { min: 0, max: 100, decimals: 2, example: "10" });
      if (problem || n === 0) {
        ctx.addIssue({ code: "custom", path: ["value"], message: problem ?? "率は 0 より大きくしてください" });
        return z.NEVER;
      }
      // 10 → 0.1（小数 4 桁まで。10.25% → 0.1025）
      return { ...base, rate: percentToRate(n) };
    }
    if (v.kind === "per_unit") {
      const problem = checkNumber("1 数量あたりの額", n, { min: 0, max: 10_000_000, decimals: 4, example: "10" });
      if (problem || n === 0) {
        ctx.addIssue({ code: "custom", path: ["value"], message: problem ?? "額は 0 より大きくしてください" });
        return z.NEVER;
      }
      return { ...base, rate: n };
    }
    const problem = checkNumber("毎月の額", n, { min: 0, max: 100_000_000, example: "15,000" });
    if (problem || n === 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: problem ?? "金額は 1 円以上にしてください" });
      return z.NEVER;
    }
    return { ...base, amount: n };
  });
export type RuleInput = z.output<typeof ruleSchema>;

// ---------------------------------------------------------------- 利用者

export const ROLES = ["owner", "staff", "viewer"] as const;
export const roleSchema = z.enum(ROLES, { error: "役割を選んでください" });

export const inviteSchema = z.object({
  name: text("お名前", 50),
  email: z.string({ error: "メールアドレスを入れてください" }).trim().toLowerCase().pipe(z.email("メールアドレスの形が正しくありません")),
  role: roleSchema,
});
export type InviteInput = z.output<typeof inviteSchema>;

/** FormData を 文字の入れ物にする（同じ名前が 2 つあれば最初のもの） */
export function formObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !(key in out)) out[key] = value;
  }
  return out;
}
