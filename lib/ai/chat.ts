/**
 * AI チャット（経営の相談）。
 * 会社の数字（lib/ai/context.ts のデータパック）だけを根拠に答える。
 */
import "server-only";
import { AI_MAX_TOKENS } from "./config";
import { callClaude } from "./insights";
import { MAX_CHAT_TURNS, trimHistory, type AiChatTurn, type AiContext } from "./context";

export const CHAT_SYSTEM_PROMPT = [
  "あなたはこの軽貨物運送会社の経営パートナーです。渡された JSON の数値だけを根拠に、日本語で簡潔に答えます。",
  "金額は ¥1,234,567 の形式、率は小数 1 桁 % で書きます。",
  "JSON に無いことは「そのデータは渡されていません」と正直に言い、推測しません。",
  "表を使うと分かりやすい場合は簡単な箇条書きにします。",
  "",
  "数値の意味：",
  "- bill＝会社売上、pay＝ドライバー売上、margin＝単価差額利益（bill−pay）、royalty＝ロイヤリティ、mgmt_fee＝管理費",
  "- payout＝ドライバーへの支払額（税抜）、profit＝会社利益、expense_total＝経費（税抜）、operating_profit＝営業利益（会社利益−経費）",
  "- bill_target / profit_target＝月次目標（0 は未設定）、forecast＝当月の着地見込み（progress＝月の経過率）",
  "- projects＝案件別の採算、invoices＝未入金の請求書、cash＝今日から先の入金・支払の見込み、alerts＝未対応の注意点",
  "- 支払単価 0・ロイヤリティ 0%・管理費 0 のドライバーはオーナー本人など正常なケースがあります。",
  "",
  "答え方：",
  "- 結論から 1〜2 文で述べ、そのあとに根拠となる数値を挙げます。長くても 400 文字程度にまとめます。",
  "- 断定しすぎず、「〜の可能性があります」「元の数値もご確認ください」といった表現を使います。",
  "- 見出し記号（#）や表組みは使わず、必要なら「・」の箇条書きにします。",
].join("\n");

export interface ChatReplyInput {
  /** その月のデータパック */
  context: AiContext;
  /** これまでのやり取り（古い順。直近 10 往復まで使う） */
  history: readonly { role: string; content: string }[];
  /** 今回の質問 */
  question: string;
}

export interface ChatReplyResult {
  model: string;
  content: string;
}

/** 最後の user メッセージ（データパック ＋ 質問） */
export function buildChatUserMessage(ctx: AiContext, question: string): string {
  return [
    `# 参照できるデータ（${ctx.month_label} 時点の JSON）`,
    JSON.stringify(ctx),
    "",
    "# 質問",
    question.trim(),
  ].join("\n");
}

/** AI チャットの回答を 1 件作る（API キーの有無は呼び出し元で確認済みであること） */
export async function requestChatReply({ context, history, question }: ChatReplyInput): Promise<ChatReplyResult> {
  const past: AiChatTurn[] = trimHistory(history, MAX_CHAT_TURNS);
  const { model, text } = await callClaude({
    system: CHAT_SYSTEM_PROMPT,
    messages: [...past, { role: "user", content: buildChatUserMessage(context, question) }],
    maxTokens: AI_MAX_TOKENS.chat,
    emptyMessage: "AI から回答が返りませんでした。もう一度お試しください。",
  });
  return { model, content: text };
}
