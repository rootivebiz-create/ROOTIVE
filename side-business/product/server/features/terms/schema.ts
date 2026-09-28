/**
 * 取引条件の明示書の入力の形（zod）。Server Action と機能の関数の両方がこれで確かめる（確かめ方を 1 か所に）。
 * 項目の名前は画面のフォームの name と同じ（誤りを欄の下に出せるように）。
 */
import { z } from "zod";
import { isDateString } from "@/lib/tools/torihiki-joken";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const date = (label: string) => z.string().trim().refine(isDateString, `${label}を正しく入れてください（例：2026-10-01）`);
const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isDateString(v), `${label}を正しく入れてください（例：2026-10-01）`);
const text = (label: string, max: number) => z.string().trim().max(max, `${label}は ${max.toLocaleString("ja-JP")} 文字までにしてください`);

/** 1 人の新しい版 */
export function termsVersionSchema(today: string) {
  return z
    .object({
      driverId: z.string().refine(isUuid, "ドライバーが見つかりません。一覧から開き直してください"),
      /** 画面を開いたときの最新の版（0＝まだ無い）。そのあとでほかの人が版を作っていたら止める */
      baseVersion: z.number().int().min(0).nullable().optional(),
      projectIds: z
        .array(z.string().refine(isUuid, "案件が見つかりません"))
        .min(1, "案件を 1 つ以上選んでください（報酬の額は、選んだ案件の単価から書きます）")
        .max(200),
      serviceDescription: text("給付の内容", 500).min(1, "給付の内容（どんな仕事か）を書いてください"),
      place: text("場所", 300).min(1, "給付を受け取る場所を書いてください（例：会社が指定する配送先）"),
      periodFrom: date("業務の期間の始まりの日"),
      periodTo: optionalDate("業務の期間の終わりの日"),
      commissionedOn: optionalDate("委託した日"),
      receipt: text("給付を受け取る日", 300).min(1, "給付を受け取る日（または期間）を書いてください"),
      other: text("その他", 1000).default(""),
      deemed: z.boolean(),
      isSubcontract: z.boolean(),
      originalClient: text("元委託者の名前", 100).default(""),
      originalPayDate: text("元委託の支払期日", 100).default(""),
      documentName: text("書面の名前", 100).default(""),
      issuedOn: date("明示した日"),
    })
    .superRefine((v, ctx) => {
      if (v.issuedOn > today) {
        ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "明示した日は今日より後にできません。ドライバーに渡した日（今日送るなら今日）を入れてください" });
      }
      if (v.issuedOn < "2000-01-01") ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "明示した日を正しく入れてください" });
      if (v.periodTo && v.periodTo < v.periodFrom) {
        ctx.addIssue({ code: "custom", path: ["periodTo"], message: "終わりの日は、始まりの日と同じか後の日にしてください" });
      }
      if (v.commissionedOn && v.commissionedOn > today) {
        ctx.addIssue({ code: "custom", path: ["commissionedOn"], message: "委託した日は今日より後にできません" });
      }
      if (v.isSubcontract && !v.originalClient) {
        ctx.addIssue({ code: "custom", path: ["originalClient"], message: "再委託のときは、元委託者（元請など）の名前を書いてください" });
      }
      if (v.isSubcontract && !v.originalPayDate) {
        ctx.addIssue({ code: "custom", path: ["originalPayDate"], message: "再委託のときは、元委託の支払期日を書いてください（例：毎月末日締め・翌月末日払い）" });
      }
    });
}

export type TermsVersionInput = z.input<ReturnType<typeof termsVersionSchema>>;
export type TermsVersionValues = z.output<ReturnType<typeof termsVersionSchema>>;

/** 未作成の人の明示書をまとめて作る */
export function termsBulkSchema(today: string) {
  return z
    .object({
      issuedOn: date("明示した日"),
      place: text("場所", 300).min(1, "給付を受け取る場所を書いてください（全員に同じ文が入ります）"),
      deemed: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.issuedOn > today) {
        ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "明示した日は今日より後にできません。ドライバーに渡す日（今日送るなら今日）を入れてください" });
      }
      if (v.issuedOn < "2000-01-01") ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "明示した日を正しく入れてください" });
    });
}

export type TermsBulkInput = z.input<ReturnType<typeof termsBulkSchema>>;

export const TERMS_CHANNELS = ["copy", "line", "sms", "mail", "paper"] as const;
export type TermsChannel = (typeof TERMS_CHANNELS)[number];
export const termsChannelSchema = z.enum(TERMS_CHANNELS);
