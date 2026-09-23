/**
 * 稼働・調整・取り込みの入力の確かめ（zod）。全角の数字・カンマ・円も読める。
 * Server Action で使う（テストからも読める純粋なもの）。
 */
import { z } from "zod";
import { parseAmount } from "@/lib/payroll/money";
import { COLUMN_ROLES, type ColumnRole } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const idSchema = (message: string) => z.string().trim().regex(UUID, message);

export const monthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "月の形が正しくありません");

/** 画面の「2026-10」も DB の「2026-10-01」も受ける */
export const monthInputSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, "月を選んでください")
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}は ${max} 文字までにしてください`)
    .optional()
    .transform((v) => (v ? v : null));

export const optionalDateSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .refine(
    (v) =>
      v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)),
    "日付の形が正しくありません（例：2026-10-05）",
  );

/** 数量：0 より大きい数（小数 4 桁まで） */
export const qtyInputSchema = z
  .string()
  .trim()
  .min(1, "数量を入れてください")
  .transform((v, ctx) => {
    const n = parseAmount(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "数量は数で入れてください（例：2,310）" });
      return z.NEVER;
    }
    return n;
  })
  .refine((n) => n > 0, "数量は 0 より大きい数にしてください。無しにするときは「消す」を押してください")
  .refine((n) => n <= 1_000_000, "数量が大きすぎます。桁を確かめてください")
  .refine((n) => Math.abs(n * 1e4 - Math.round(n * 1e4)) < 1e-6, "小数は 4 桁までにしてください");

export const workEntrySchema = z.object({
  driverId: idSchema("ドライバーを選んでください"),
  projectId: idSchema("案件を選んでください"),
  qty: qtyInputSchema,
  workDate: optionalDateSchema,
  note: optionalText(200, "備考"),
});
export type WorkEntryParsed = z.infer<typeof workEntrySchema>;

/** 円（1 円単位の正の整数） */
const yenInputSchema = z
  .string()
  .trim()
  .min(1, "金額を入れてください")
  .transform((v, ctx) => {
    const n = parseAmount(v.replace(/^[+＋]/, ""));
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "金額は数で入れてください（例：3,300）" });
      return z.NEVER;
    }
    return n;
  })
  .refine((n) => Number.isInteger(n), "金額は 1 円単位で入れてください")
  .refine((n) => n !== 0, "0 円の調整は入れられません")
  .refine((n) => Math.abs(n) <= 10_000_000, "金額が大きすぎます。桁を確かめてください");

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

/** 調整：向き（足す・引く）と金額（正の数）。マイナスを打たなくてよいように分ける */
export const adjustmentSchema = z
  .object({
    driverId: idSchema("ドライバーを選んでください"),
    label: z.string().trim().min(1, "内容を入れてください（例：駐車場代の立替）").max(60, "内容は 60 文字までにしてください"),
    direction: z.enum(["plus", "minus"], { error: "足すか引くかを選んでください" }),
    amount: yenInputSchema,
    taxable: checkbox,
    agreedInWriting: checkbox,
    basis: optionalText(200, "根拠"),
  })
  .transform((v) => ({
    driverId: v.driverId,
    label: v.label,
    // 「引く」を選んだら、入れた金額の符号にかかわらずマイナスにする
    amount: v.direction === "minus" ? -Math.abs(v.amount) : Math.abs(v.amount),
    taxable: v.taxable,
    agreedInWriting: v.agreedInWriting,
    basis: v.basis,
  }));
export type AdjustmentParsed = z.infer<typeof adjustmentSchema>;

export const roleSchema = z.enum(COLUMN_ROLES as [ColumnRole, ...ColumnRole[]]);

export const quickDriverSchema = z.object({
  name: z.string().trim().min(1, "名前を入れてください").max(60, "名前は 60 文字までにしてください"),
  kana: optionalText(60, "フリガナ"),
  code: optionalText(30, "番号"),
});

const rateSchema = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return 0;
      const n = parseAmount(v);
      if (n === null || n < 0) {
        ctx.addIssue({ code: "custom", message: `${label}は 0 以上の数で入れてください` });
        return z.NEVER;
      }
      return n;
    })
    .refine((n) => n <= 10_000_000, `${label}が大きすぎます`);

export const quickProjectSchema = z.object({
  name: z.string().trim().min(1, "案件の名前を入れてください").max(60, "案件の名前は 60 文字までにしてください"),
  unit: z.string().trim().min(1, "単位を入れてください（例：個・日・時間）").max(10, "単位は 10 文字までにしてください"),
  billRate: rateSchema("受注単価"),
  payRate: rateSchema("支払単価"),
  clientId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || UUID.test(v), "元請を選び直してください"),
});
