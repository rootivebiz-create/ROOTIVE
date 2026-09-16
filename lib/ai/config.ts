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
