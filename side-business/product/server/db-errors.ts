/**
 * DB のエラーを読み解く。Drizzle は「Failed query: …」で包み、元のエラーを cause に入れるので、奥までたどる。
 */
export function pgErrorMessage(error: unknown): string {
  let cur: unknown = error;
  const seen = new Set<unknown>();
  let last = "";
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === "string") last = msg;
    cur = (cur as { cause?: unknown }).cause;
  }
  return last || String(error);
}

export function isMonthClosedError(error: unknown): boolean {
  return pgErrorMessage(error).includes("MONTH_CLOSED");
}

/** 画面に出す日本語（DB の中身をそのまま見せない） */
export function friendlyDbError(error: unknown): string {
  const msg = pgErrorMessage(error);
  if (msg.includes("MONTH_CLOSED")) return "この月は締め済みです。直すときは、オーナーが「締め」の画面で締めを外してください。";
  if (msg.includes("AUDIT_APPEND_ONLY")) return "操作の記録は変更できません。";
  if (/duplicate key|unique/i.test(msg)) return "同じものがすでに登録されています。";
  if (/violates foreign key/i.test(msg)) return "ほかのデータから使われているため、変更できません。";
  if (/violates check constraint/i.test(msg)) return "入力の値が正しくありません。";
  return "保存できませんでした。時間をおいてもう一度お試しください。";
}
