import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

/** PDF の日本語フォント（Noto Sans JP・OFL。fonts/ に同梱）。PDF を作る前に 1 回呼ぶ */
export const PDF_FONT = "NotoSansJP";

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  const dir = path.join(process.cwd(), "fonts");
  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: path.join(dir, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansJP-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 日本語は 1 文字ずつ折り返せるようにする（英語向けのハイフン処理をしない）
  // 空文字を挟むと、折り返した所に「-」が入らない
  Font.registerHyphenationCallback((word) => (/[^\x00-\x7f]/.test(word) ? Array.from(word).flatMap((c) => [c, ""]) : [word]));
}
