/**
 * PDF 用フォント（Noto Sans JP）の登録と日本語の改行処理
 * - public/fonts/NotoSansJP-{Regular,Bold}.ttf を同梱（Vercel では next.config.ts の outputFileTracingIncludes で含める）
 * - react-pdf は空白でしか行を折り返さないため、日本語は 1 文字ずつ折り返し候補にする（簡略化した禁則処理付き）
 */
import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const PDF_FONT_FAMILY = "NotoSansJP";

/** 行頭に置かない文字（直前の文字にくっつける） */
const NO_BREAK_BEFORE = new Set(Array.from("、。，．・：；？！ー〜～）」』】〕〉》〙〟ヽヾゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ%％℃"));
/** 行末に置かない文字（直後の文字にくっつける） */
const NO_BREAK_AFTER = new Set(Array.from("（「『【〔〈《〘〝¥￥$＄#＃"));

/** CJK（和文）文字か */
function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3000 && cp <= 0x30ff) || // 記号・ひらがな・カタカナ
    (cp >= 0x3400 && cp <= 0x9fff) || // 漢字
    (cp >= 0xf900 && cp <= 0xfaff) || // 互換漢字
    (cp >= 0xff00 && cp <= 0xffef) || // 全角英数・半角カナ
    (cp >= 0x20000 && cp <= 0x2ffff) // 拡張漢字
  );
}

/** 英数の連続がこの長さを超える場合は ASCII_CHUNK 文字ごとに折り返し候補を入れる（URL など） */
const ASCII_CHUNK_THRESHOLD = 16;
const ASCII_CHUNK = 8;

/**
 * 単語を折り返し単位に分ける（Font.registerHyphenationCallback 用）。
 * react-pdf は文字種（漢字／かな／英数／記号）ごとの run に分けてから空白で区切り、その 1 つ 1 つを「単語」として渡してくる
 * （例：「備考が長い場合」→「備考」「が」「長」「い」「場合」。句読点・閉じ括弧は直前の run に付く）。
 * 和文は 1 文字ずつ、英数は連続したまま 1 単位にし、**すべての単位の後ろに空文字列を置く**。
 * textkit は空文字列の要素を幅 0 のグルーとして扱うため、ハイフンを挿入せずにそこで改行できる。
 * 逆に末尾に空文字列が無い単位の後ろにはハイフネーション用のペナルティ（改行時に "-" を挿入）が置かれてしまうため、
 * 1 文字だけの単語でも必ず空文字列を付ける。
 */
export function splitJapaneseWord(word: string): string[] {
  // 空白はそのまま返す（textkit が空白グルーとして扱う）
  if (word.trim() === "") return [word];
  const chars = Array.from(word);
  const chunks: string[] = [];
  let ascii = "";
  const flushAscii = () => {
    if (ascii.length > ASCII_CHUNK_THRESHOLD) {
      for (let i = 0; i < ascii.length; i += ASCII_CHUNK) chunks.push(ascii.slice(i, i + ASCII_CHUNK));
    } else if (ascii) {
      chunks.push(ascii);
    }
    ascii = "";
  };
  for (const ch of chars) {
    if (isCjk(ch) || NO_BREAK_BEFORE.has(ch) || NO_BREAK_AFTER.has(ch)) {
      flushAscii();
      chunks.push(ch);
    } else {
      ascii += ch;
    }
  }
  flushAscii();
  // 禁則：行頭禁止文字は前に、行末禁止文字は後ろに結合する
  const merged: string[] = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    const first = Array.from(c)[0] ?? "";
    const prevLast = prev ? (Array.from(prev).at(-1) ?? "") : "";
    if (prev !== undefined && (NO_BREAK_BEFORE.has(first) || NO_BREAK_AFTER.has(prevLast))) merged[merged.length - 1] = prev + c;
    else merged.push(c);
  }
  return merged.flatMap((c) => [c, ""]);
}

declare global {
  var __rootivePdfFontsRegistered: boolean | undefined;
}

/** フォント登録（プロセス内で 1 回だけ。HMR でモジュールが再評価されても二重登録しない） */
export function ensurePdfFonts(): void {
  if (globalThis.__rootivePdfFontsRegistered) return;
  globalThis.__rootivePdfFontsRegistered = true;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(dir, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansJP-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(splitJapaneseWord);
}
