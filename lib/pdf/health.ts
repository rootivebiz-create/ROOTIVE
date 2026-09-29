/**
 * 本番で PDF が描けるかの確認（/api/health/pdf）。サーバー専用。
 *
 * 明細・請求書と同じ日本語フォントで 1 行だけの小さな PDF を実際に描く。
 * 会社やドライバーの情報は一切使わない（ログインなしで呼ばれるため）。
 */
import { createElement as h } from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { ensurePdfFonts, pdfFontStatus, PDF_FONT_FAMILY } from "./fonts";

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
