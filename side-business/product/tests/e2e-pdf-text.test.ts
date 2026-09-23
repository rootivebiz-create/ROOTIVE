import * as React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";
import { pdfText } from "../e2e/pdf-text";

/**
 * E2E で PDF の数字を確かめる小さな読み取り（e2e/pdf-text.ts）が、合字でずれないこと。
 * 明細の「目印」は 16 進のハッシュなので、ff・fi が入ると字形が合字になり、ToUnicode は <0066 0066> と空白を挟んで書かれる。
 * それを読み飛ばすと、そのあとの字形がすべて 1 つずつずれて、数字が別の文字になる（入る・入らないはハッシュしだいで、E2E がときどき落ちた）
 */
describe("E2E の PDF の読み取り", () => {
  it("合字（ff・fi）があっても、あとの数字がずれない", async () => {
    registerPdfFonts();
    const line = "目印 ff50c19f4140 fi 委託料 374,500円 × 10% 37,450円";
    const doc = React.createElement(
      Document,
      null,
      React.createElement(Page, { size: "A4", style: { fontFamily: PDF_FONT, fontSize: 10, padding: 40 } }, React.createElement(Text, null, line)),
    );
    const text = pdfText(Buffer.from(await renderToBuffer(doc))).replace(/\n/g, "");
    expect(text).toContain("374,500円");
    expect(text).toContain("37,450円");
    expect(text).toContain("ff50c19f4140");
    expect(text.replace(/\s+/g, "")).toBe(line.replace(/\s+/g, ""));
  });
});
