import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import { monthPdfSources, type PdfSource } from "~/server/features/statements";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * PDF の文字が重ならないか。react-pdf が組んだ配置（ページ・枠・文字の行）を受け取り、
 * ① どの行も、その行の文字の大きさ以上の高さがある（大きい文字の行の高さが足りずに、次の行と重ならない）
 * ② 行の合計の高さが、文字の枠からはみ出さない
 * ③ 文字の幅が、枠の幅からはみ出さない（となりの列にかからない）
 * ④ 同じページの文字の枠どうしが重ならない（下の欄・ページ番号とも）
 * ⑤ 実際に字が並ぶ範囲（左・右・中央そろえを考える）どうしが、同じ高さで 2pt より近づかない（くっついて 1 つの語に見えない）
 * ⑥ 見出しがそれぞれ決まった回数だけ出る
 * を、デモの 8 人分（1 か月分の PDF）と、長い名前・行の多い明細で確かめる。
 */

type Box = { top: number; left: number; width: number; height: number };
type LayoutNode = { type?: string; box?: Box; lines?: LayoutLine[]; children?: LayoutNode[] };
type LayoutLine = { string: string; height: number; xAdvance: number; runs?: { attributes?: { fontSize?: number; align?: string } }[] };
type Ink = { text: string; x1: number; x2: number; y1: number; y2: number; owner: number };
type PlacedText = { text: string; x: number; y: number; width: number; height: number; lines: LayoutLine[] };

const EPS = 0.5;
/** 同じ高さに並ぶ字と字の、いちばん狭い間（pt） */
const MIN_GAP = 2;

/** 1 ページの文字の枠を、ページの左上からの位置にして集める */
function placedTexts(page: LayoutNode): PlacedText[] {
  const out: PlacedText[] = [];
  const walk = (n: LayoutNode, x: number, y: number) => {
    const bx = x + (n.box?.left ?? 0);
    const by = y + (n.box?.top ?? 0);
    if (n.type === "TEXT" && n.lines && n.box) {
      out.push({ text: n.lines.map((l) => l.string).join(""), x: bx, y: by, width: n.box.width, height: n.box.height, lines: n.lines });
      return; // 文字の中の文字（入れ子）は、外の枠で数える
    }
    for (const c of n.children ?? []) walk(c, bx, by);
  };
  for (const c of page.children ?? []) walk(c, 0, 0);
  return out.filter((t) => t.text.trim().length > 0);
}

/** 行ごとに、実際に字が並ぶ範囲（そろえ方で左右の位置が変わる） */
function inkOf(texts: PlacedText[]): Ink[] {
  const out: Ink[] = [];
  texts.forEach((t, owner) => {
    let y = t.y;
    for (const l of t.lines) {
      const align = l.runs?.[0]?.attributes?.align ?? "left";
      const x1 = align === "right" ? t.x + t.width - l.xAdvance : align === "center" ? t.x + (t.width - l.xAdvance) / 2 : t.x;
      if (l.string.trim()) out.push({ text: l.string, x1, x2: x1 + l.xAdvance, y1: y, y2: y + l.height, owner });
      y += l.height;
    }
  });
  return out;
}

function overlap(a: PlacedText, b: PlacedText): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > EPS && h > EPS ? w * h : 0;
}

function problems(layout: LayoutNode): string[] {
  const out: string[] = [];
  (layout.children ?? []).forEach((page, p) => {
    const texts = placedTexts(page);
    for (const t of texts) {
      const total = t.lines.reduce((n, l) => n + l.height, 0);
      if (total > t.height + EPS) out.push(`p${p + 1}「${t.text}」行が枠より高い ${total} > ${t.height}`);
      for (const l of t.lines) {
        const size = Math.max(0, ...(l.runs ?? []).map((r) => r.attributes?.fontSize ?? 0));
        if (l.height + EPS < size) out.push(`p${p + 1}「${l.string}」行の高さ ${l.height} < 文字 ${size}`);
        if (l.xAdvance > t.width + EPS) out.push(`p${p + 1}「${l.string}」幅がはみ出す ${l.xAdvance} > ${t.width}`);
      }
      if (t.y + t.height > (page.box?.height ?? Infinity) + EPS) out.push(`p${p + 1}「${t.text}」ページの下にはみ出す`);
      if (t.y < -EPS) out.push(`p${p + 1}「${t.text}」ページの上にはみ出す`);
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (overlap(texts[i], texts[j]) > 0) out.push(`p${p + 1}「${texts[i].text}」と「${texts[j].text}」が重なる`);
      }
    }
    const ink = inkOf(texts);
    for (let i = 0; i < ink.length; i++) {
      for (let j = i + 1; j < ink.length; j++) {
        const a = ink[i];
        const b = ink[j];
        if (a.owner === b.owner) continue;
        const sameRow = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > EPS;
        const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
        if (sameRow && gap < MIN_GAP) out.push(`p${p + 1}「${a.text}」と「${b.text}」がくっつく（間 ${gap.toFixed(1)}pt）`);
      }
    }
  });
  return out;
}

function allLines(layout: LayoutNode): string[] {
  return (layout.children ?? []).flatMap((page) => placedTexts(page).flatMap((t) => t.lines.map((l) => l.string)));
}

async function layoutOf(sources: PdfSource[]): Promise<LayoutNode> {
  let layout: unknown;
  const bytes = await renderStatementsPdf(sources, new Date("2026-11-01T09:00:00+09:00"), { onLayout: (l) => (layout = l) });
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  return layout as LayoutNode;
}

let db: Db;
let client: PGlite;
let tenantId: string;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
});

afterAll(async () => {
  await client.close();
});

describe("PDF の文字が重ならない", () => {
  it("デモの 8 人分（1 人 1 ページ）", async () => {
    const sources = await monthPdfSources(db, tenantId, DEMO_MONTH);
    const layout = await layoutOf(sources);
    expect(layout.children).toHaveLength(8);
    expect(problems(layout)).toEqual([]);
  });

  it("見出しは 1 人につき決まった回数だけ出る（抜けも二重もない）", async () => {
    const sources = await monthPdfSources(db, tenantId, DEMO_MONTH);
    const layout = await layoutOf(sources);
    const lines = allLines(layout);
    const count = (w: string) => lines.filter((l) => l === w).length;
    // 見出し（どの人にもある）
    for (const w of ["お支払先", "作成者", "取引の期間", "振込予定日", "振込先", "委託料の内容", "お振込額の計算"]) expect(count(w)).toBe(8);
    // お振込額は、上の大きな枠と、計算のいちばん下の 2 か所
    expect(count("お振込額")).toBe(16);
    // 控除のある人（全員）・調整のある人（青木さん・上田さん）
    expect(count("引かれているもの（控除）")).toBe(8);
    // 調整は、見出しと計算の行の 2 か所ずつ
    expect(count("調整（立替の精算など）")).toBe(4);
    // ページ番号は各ページに 1 つ（下の欄の中。ページの外に押し出されていない：重なりの試験でページの中にあることも確かめる）
    expect(lines.filter((l) => /^\d+ \/ \d+$/.test(l))).toEqual(["1 / 8", "2 / 8", "3 / 8", "4 / 8", "5 / 8", "6 / 8", "7 / 8", "8 / 8"]);
  });

  it("長い名前・長い案件名・行の多い明細・大きな金額でも重ならない（2 ページ目に送る）", async () => {
    const base = (await monthPdfSources(db, tenantId, DEMO_MONTH)).find((x) => x.view.driver.code === "D01")!;
    const long = "とても長い名前の株式会社サンプル運送ホールディングス（架空）関東第二営業所";
    const lines = Array.from({ length: 30 }, (_, i) => ({
      key: `p${i}`,
      project: `長い案件名の配送業務 その${i + 1}（午前便・午後便・夜間便の組み合わせ）`,
      client: "とても長い元請の名前の物流株式会社（架空）",
      unit: "個",
      qty: 12_345.5,
      rate: 152.5,
      amount: 1_882_689,
    }));
    const deductions = Array.from({ length: 8 }, (_, i) => ({
      key: `r${i}`,
      name: `控除の名前がとても長い場合の例 ${i + 1}`,
      amount: 123_456,
      taxable: i % 2 === 0,
      agreedInWriting: i % 3 === 0,
      how: "委託料 56,480,670円 × 10%（取引条件の第 8 条の 2 に定める率）",
    }));
    const source: PdfSource = {
      ...base,
      view: {
        ...base.view,
        company: { name: long, registrationNo: "T1234567890123" },
        driver: { ...base.view.driver, name: "長谷川 左右衛門之助 アレクサンダー 太郎" },
        lines,
        subtotal: 56_480_670,
        tax: 5_648_067,
        deductions,
        deductionTotal: 987_648,
        deductionTax: 49_382,
        total: 61_091_707,
      },
    };
    const layout = await layoutOf([source]);
    expect((layout.children ?? []).length).toBeGreaterThanOrEqual(2);
    expect(problems(layout)).toEqual([]);
  });
});
