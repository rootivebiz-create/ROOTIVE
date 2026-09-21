/**
 * 日本語のあいまい検索・あいまい一致のための正規化。
 * 全角 → 半角、大文字 → 小文字、カタカナ → ひらがな、空白と長音・中黒を除去する。
 * （「ドライバー」「どらいば」「ﾄﾞﾗｲﾊﾞｰ」をすべて同じ文字列にする）
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　ー・･-]/g, "");
}
