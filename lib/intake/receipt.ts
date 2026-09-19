/**
 * レシート・領収書の読み取り（サーバー専用。Claude に画像を渡す）
 *
 * - 有効になるのは ANTHROPIC_API_KEY があるときだけ（lib/ai/config.ts の isAiInsightsEnabled）
 * - 画像は Server Action が Storage（receipts）に保存してから渡す（読み取りに失敗しても画像は残る）
 * - 応答の取り出しは lib/intake/helpers.ts の extractReceipt（純関数）に任せる
 * - 渡すのは画像と経費カテゴリの一覧だけ（他の社内データは渡さない）
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ActionError } from "@/lib/actions/result";
import { AI_DISABLED_MESSAGE, AI_MAX_TOKENS, AI_TIMEOUT_MS, resolveAnthropicModel } from "@/lib/ai/config";
import { translateAnthropicError } from "@/lib/ai/insights";
import { extractReceipt, resolveCategoryId, type AiReadableMediaType, type CategoryChoice, type ReceiptDraft } from "./helpers";

export const RECEIPT_SYSTEM_PROMPT = [
  "あなたは日本のレシート・領収書を読み取る担当者です。画像に写っている内容だけを根拠にしてください。",
  "推測で数値を作らず、読めない項目は null にしてください。",
  "",
  "読み取る項目：",
  "- amount：支払った金額（数字のみ。カンマ・「¥」・「円」は付けない）。合計（税込合計があればその金額）を読む",
  "- tax_included：amount が税込なら true、税抜なら false、判断できなければ null",
  "- incurred_on：支払った日付。必ず YYYY-MM-DD 形式（例 2026-09-18）。年が書かれていなければ null",
  "- vendor：支払先（店名・会社名）。ロゴや発行者名から読む",
  "- label：何を買ったかを 20 文字以内でまとめた内容（例「ガソリン代」「高速道路料金」「事務用品」）",
  "- category_id：渡した経費カテゴリの一覧から最も近いものの id をそのまま返す。決められなければ null",
  "- confidence：読み取り全体の自信を 0〜1 の小数で返す",
  "",
  "注意：",
  "- レシートでは「合計」「お買上げ計」が税込、「小計」が税抜のことが多い。「内消費税」「(税込)」があれば tax_included は true",
  "- 手書きの領収書は「金額」欄を読む。但し書きがあれば label に使う",
  "- 金額は半角の数字だけにする（全角・カンマ・記号は使わない）",
  "",
  "出力形式：",
  '- JSON オブジェクトだけを返す：{"amount": 1234, "tax_included": true, "incurred_on": "2026-09-18", "vendor": "店名", "label": "内容", "category_id": "…", "confidence": 0.9}',
  "- コードフェンス・前置き・後書きは付けない。文字列はすべて日本語で書く。",
].join("\n");

/** カテゴリの一覧をユーザーメッセージに入れる（id と名前だけ） */
export function buildReceiptUserMessage(categories: CategoryChoice[]): string {
  const list = categories
    .filter((c) => c.is_active !== false)
    .map((c) => ({ id: c.id, name: c.name }));
  return [
    "このレシート（領収書）の画像を読み取って、指定された JSON オブジェクトだけを返してください。",
    "",
    "経費カテゴリの一覧（category_id はこの中の id から選ぶ）：",
    JSON.stringify(list),
  ].join("\n");
}

export interface ReadReceiptResult extends ReceiptDraft {
  /** 使用したモデル */
  model: string;
}

/**
 * レシートの画像を Claude に渡して内容を読み取る。
 * imageBase64 は base64 の文字列（data URI ではない）。API キーが無ければ ActionError を投げる。
 */
export async function readReceipt(imageBase64: string, mediaType: AiReadableMediaType, categories: CategoryChoice[]): Promise<ReadReceiptResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ActionError(AI_DISABLED_MESSAGE);
  const model = resolveAnthropicModel();
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 0 });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: AI_MAX_TOKENS.draft,
      system: RECEIPT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: buildReceiptUserMessage(categories) },
          ],
        },
      ],
    });
  } catch (e) {
    throw translateAnthropicError(e, model);
  }

  if (response.stop_reason === "refusal") throw new ActionError("AI がこの画像を読み取れませんでした。手で入力してください。");
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new ActionError("AI から読み取り結果が返りませんでした。もう一度お試しください。");

  const draft = extractReceipt(text);
  return { ...draft, category_id: resolveCategoryId(draft.category_id, categories), model: response.model || model };
}
