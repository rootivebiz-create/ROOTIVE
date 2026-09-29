import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PDF_FONT_FILES, PDF_FONT_MISSING_MESSAGE, pdfFontDir, pdfFontStatus } from "@/lib/pdf/fonts";
import { runPdfCheck } from "@/lib/pdf/health";

/**
 * PDF の日本語フォント。Vercel では public/ がサーバーの関数に入らず、支払明細の PDF が
 * 「出力に失敗しました」になった。フォントは assets/fonts に置き、見つからないときは分かる文で失敗させる
 */
describe("PDF のフォントの場所", () => {
  const tmp: string[] = [];
  const makeRoot = (sub?: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-fonts-"));
    tmp.push(root);
    if (sub) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
      for (const f of Object.values(PDF_FONT_FILES)) fs.writeFileSync(path.join(root, sub, f), "x");
    }
    return root;
  };
  afterEach(() => {
    for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("リポジトリの assets/fonts にある（public/ には置かない）", () => {
    expect(pdfFontDir()).toBe(path.join(process.cwd(), "assets", "fonts"));
    expect(fs.existsSync(path.join(process.cwd(), "public", "fonts"))).toBe(false);
    const status = pdfFontStatus();
    expect(status.dir).toBe(path.join("assets", "fonts"));
    for (const f of Object.values(PDF_FONT_FILES)) expect(status.bytes[f]).toBeGreaterThan(1_000_000);
  });

  it("assets/fonts が無ければ以前の public/fonts も探す", () => {
    const root = makeRoot(path.join("public", "fonts"));
    expect(pdfFontDir(root)).toBe(path.join(root, "public", "fonts"));
  });

  it("どこにも無ければ、原因の分かる日本語で失敗する", () => {
    expect(() => pdfFontDir(makeRoot())).toThrow(PDF_FONT_MISSING_MESSAGE);
    // 片方だけでは足りない
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "assets", "fonts"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "fonts", PDF_FONT_FILES[400]), "x");
    expect(() => pdfFontDir(root)).toThrow(PDF_FONT_MISSING_MESSAGE);
  });
});

describe("本番の確認口（/api/health/pdf）", () => {
  it("日本語フォント入りの小さな PDF を実際に描ける", async () => {
    const r = await runPdfCheck();
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(1000);
    expect(r.fonts?.dir).toBe(path.join("assets", "fonts"));
  }, 60_000);
});
