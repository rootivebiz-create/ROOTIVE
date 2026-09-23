/**
 * 単価・控除を変えるときの「まだ締めていない月にも反映する」の印（画面とサーバーの両方で使う純関数。server-only にしない）。
 * サーバーは、変わる月と額の説明（impactMessage）を返す。画面は、その説明から印の値を作って送り返す。
 * サーバーは保存するときの説明から同じ値を作って比べるので、画面で見たあとに影響が変わっていれば保存しない。
 */

/** 印を送る入力欄の名前（fieldErrors のキーにも使う） */
export const OPEN_MONTHS_FIELD = "confirmOpenMonths";

/** fieldErrors に入れて返す案内（入力欄の誤りの一覧にもこの文が出る） */
export const OPEN_MONTHS_HINT = "変わる月と額を確かめて、「上の月の明細にも反映する」に印を付けてから、もう一度押してください。";

/** 説明の文から作る短い値（FNV-1a 32 ビット・16 進 8 桁）。同じ文なら画面でもサーバーでも同じ値になる */
export function messageKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
