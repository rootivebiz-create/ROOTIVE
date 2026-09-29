/**
 * 本番で PDF が描けるかの確認（/api/health/pdf）。サーバー専用。
 *
 * 明細・請求書・月次レポートと同じ道具（日本語フォント・太字・折り返し・画像・図形）で小さな PDF を実際に描く。
 * 会社やドライバーの情報は一切使わない（ログインなしで呼ばれるため）。
 */
import { createElement as h } from "react";
import { Document, Image, Line, Page, Rect, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ensurePdfFonts, pdfFontStatus, PDF_FONT_FAMILY } from "./fonts";

/** 明細のロゴ・認印と同じく data URI で渡す小さな画像（4×4 の PNG と JPEG） */
const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOQj/v/HxkzkC4AACvnJ7HuYHXUAAAAAElFTkSuQmCC";
const SAMPLE_JPEG =
  "data:image/jpeg;base64,/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCEAOWL/9k=";

export interface PdfCheckResult {
  ok: boolean;
  /** 描けた PDF の大きさ（バイト） */
  bytes?: number;
  /** フォントの場所（プロジェクトのフォルダからの相対）とファイルの大きさ */
  fonts?: { dir: string; bytes: Record<string, number> };
  /** かかった時間（ミリ秒） */
  ms: number;
  /** 失敗したときの理由 */
  error?: string;
}

export async function runPdfCheck(): Promise<PdfCheckResult> {
  const started = Date.now();
  try {
    const fonts = pdfFontStatus();
    ensurePdfFonts();
    // JSX を使わずに組み立てる（Vitest からもそのまま呼べるように）
    const doc = h(
      Document,
      { title: "PDF の確認" },
      h(
        Page,
        { size: "A6", style: { padding: 16, fontFamily: PDF_FONT_FAMILY, fontSize: 10 } },
        h(Text, null, "支払明細 PDF の確認（お支払額 ¥1,234）"),
        h(Text, { style: { fontWeight: 700 } }, "太字の確認"),
        h(
          View,
          { style: { width: 120, marginTop: 4 } },
          h(Text, null, "長い備考は日本語でも行の途中で折り返し、句読点は行頭に来ないようにします。"),
        ),
        h(
          View,
          { style: { flexDirection: "row", marginTop: 4 } },
          h(Image, { src: SAMPLE_PNG, style: { width: 12, height: 12, marginRight: 4 } }),
          h(Image, { src: SAMPLE_JPEG, style: { width: 12, height: 12 } }),
        ),
        h(
          Svg,
          { width: 60, height: 20, style: { marginTop: 4 } },
          h(Rect, { x: 0, y: 5, width: 30, height: 10, fill: "#1f5eff" }),
          h(Line, { x1: 0, y1: 19, x2: 60, y2: 19, stroke: "#999999", strokeWidth: 1 }),
        ),
      ),
    );
    const pdf = await renderToBuffer(doc);
    const head = Buffer.from(pdf).subarray(0, 4).toString("latin1");
    if (head !== "%PDF") return { ok: false, fonts, ms: Date.now() - started, error: "PDF の先頭が %PDF ではありません。" };
    return { ok: true, bytes: pdf.length, fonts, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}
