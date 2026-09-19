import { z } from "zod";
import { monthSchema, uuidSchema } from "@/lib/schemas/common";

/* ------------------------------------------------------------ AI チャット */

/** 質問（1〜2000 文字） */
export const questionSchema = z
  .string()
  .trim()
  .min(1, "質問を入力してください")
  .max(2000, "2000 文字以内で入力してください");

/** 会話のタイトル（DB は 200 文字まで） */
export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1, "タイトルを入力してください")
  .max(200, "200 文字以内で入力してください");

/** 新しい相談（月 ＋ 最初の質問） */
export const startAiChatSchema = z.object({ month: monthSchema, question: questionSchema });

/** 続けて質問する */
export const sendAiChatSchema = z.object({ conversationId: uuidSchema, question: questionSchema });

/** 会話の名前の変更・削除 */
export const renameAiConversationSchema = z.object({ id: uuidSchema, title: conversationTitleSchema });
export const deleteAiConversationSchema = z.object({ id: uuidSchema });

/** 会話のタイトルに使う質問の先頭の文字数 */
export const CONVERSATION_TITLE_LENGTH = 30;

/** 質問の先頭から会話のタイトルを作る（改行は空白にまとめ、30 文字で切って「…」を付ける） */
export function conversationTitleFrom(question: string): string {
  const flat = (question ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "新しい相談";
  return flat.length > CONVERSATION_TITLE_LENGTH ? `${flat.slice(0, CONVERSATION_TITLE_LENGTH)}…` : flat;
}

/* ------------------------------------------------------------ 月次の分析 */

export const generateAnalysisSchema = z.object({ month: monthSchema });

/* ------------------------------------------------------------ 文章を作る */

/** 作れる文章の種類 */
export const DRAFT_KINDS = ["monthly_report", "driver_notice", "payment_reminder", "statement_notice", "recruit"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  monthly_report: "取引先向けの月次報告",
  driver_notice: "ドライバーへのお知らせ",
  payment_reminder: "入金のお願い",
  statement_notice: "支払明細ができた連絡",
  recruit: "ドライバー募集文",
};

export const DRAFT_KIND_DESCRIPTIONS: Record<DraftKind, string> = {
  monthly_report: "その月の稼働実績と体制を取引先へ報告するメール文です。",
  driver_notice: "稼働中のドライバー全員へ送るお知らせ文です。",
  payment_reminder: "未入金の請求書について、取引先へ入金をお願いする文です。",
  statement_notice: "支払明細を公開したことをドライバーへ伝える文です。",
  recruit: "軽貨物ドライバーの募集文（求人サイト・SNS 向け）です。",
};

export const draftKindSchema = z.enum(DRAFT_KINDS);

/** 文章の調子 */
export const DRAFT_TONES = ["polite", "friendly"] as const;
export type DraftTone = (typeof DRAFT_TONES)[number];
export const DRAFT_TONE_LABELS: Record<DraftTone, string> = { polite: "丁寧（ビジネス）", friendly: "やわらかい" };

/** 文章づくりの補足（宛名・伝えたいこと） */
export const draftParamsSchema = z.object({
  to: z.string().trim().max(100, "100 文字以内で入力してください").default(""),
  tone: z.enum(DRAFT_TONES).default("polite"),
  note: z.string().trim().max(1000, "1000 文字以内で入力してください").default(""),
});

export type DraftParams = z.output<typeof draftParamsSchema>;
export type DraftParamsInput = z.input<typeof draftParamsSchema>;

export const generateDraftSchema = z.object({
  kind: draftKindSchema,
  params: draftParamsSchema,
  month: monthSchema,
});
