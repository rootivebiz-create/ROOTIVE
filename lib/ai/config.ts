/** AI 月次分析の環境設定（サーバー側でのみ意味を持つ。SDK には依存しない） */

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** ANTHROPIC_API_KEY が設定されているときだけ AI 月次分析を有効にする（§4.1） */
export function isAiInsightsEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** 使用モデル（ANTHROPIC_MODEL で上書き可） */
export function resolveAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
}

/** API キーが無いときのエラーメッセージ（Server Action 共通） */
export const AI_DISABLED_MESSAGE = "ANTHROPIC_API_KEY が設定されていません。設定 → 外部連携 の手順で登録してください。";

/** 画面に出す案内（ボタンは無効にしてエラーにはしない） */
export const AI_SETUP_HINT = "AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です";

/** Claude への 1 回の応答の上限トークン（分析は長め、チャットは短め） */
export const AI_MAX_TOKENS = { analysis: 4096, chat: 2048, draft: 2048 } as const;

/** 応答を待つ上限（ミリ秒）。Server Action の maxDuration（60 秒）に収める */
export const AI_TIMEOUT_MS = 50_000;
