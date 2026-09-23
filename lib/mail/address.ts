/**
 * メールアドレスの扱い（純関数。0028 の請求書のメール送付）。
 * 取引先のメールアドレスはカンマ区切りで複数入れられる（経理の担当と上長など）。
 */

/** 1 通で送る宛先の上限 */
export const MAX_RECIPIENTS = 5;

const EMAIL_RE = /^[^\s@,;、]+@[^\s@,;、]+\.[^\s@,;、]+$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** 「a@x.jp, b@y.jp」「a@x.jp、b@y.jp」「a@x.jp b@y.jp」を配列にする（重複は 1 つにする。大文字小文字は同じとみなす） */
export function splitEmails(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (s ?? "").replace(/[＠]/g, "@").split(/[,，、;；\s]+/)) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** 保存する形（「a@x.jp, b@y.jp」） */
export function normalizeEmailList(s: string): string {
  return splitEmails(s).join(", ");
}

/** 入力の誤り（無ければ null） */
export function emailListError(s: string): string | null {
  const list = splitEmails(s);
  const bad = list.find((e) => !isValidEmail(e));
  if (bad) return `メールアドレスの形が正しくありません：${bad}`;
  if (list.length > MAX_RECIPIENTS) return `宛先は ${MAX_RECIPIENTS} 件までです`;
  return null;
}
