import * as React from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { StatementView } from "~/components/statements/statement-view";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { statementPdfSource, type PdfSource } from "~/server/features/statements";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 明細の記載事項（SPEC P0-4.1）：ドライバーに見せる画面と PDF の両方に、仕入明細書の記載事項がそろっているか。
 * 作成者の名前・相手方の氏名と登録番号・取引の期間・内容（案件 × 数量 × 単価）・税率ごとの合計と適用税率・税率ごとの消費税額。
 * 登録の無い方には「消費税相当額」と書く。口座番号は下 3 桁だけ。
 * （記載事項は国税庁の資料で確かめる：https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6498.htm）
 */
Object.assign(globalThis, { React });

let db: Db;
let client: PGlite;
let tenantId: string;
const sources = new Map<string, PdfSource>();
const pdfText = new Map<string, string>();

/** PDF の配置から、描いた文字を行ごとに集める */
function collectLines(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as { lines?: { string?: string }[]; children?: unknown[] };
    for (const l of o.lines ?? []) if (typeof l.string === "string") out.push(l.string);
    for (const c of o.children ?? []) walk(c);
  };
  walk(node);
  return out;
}

function screen(code: string): string {
  const src = sources.get(code)!;
  return renderToString(React.createElement(StatementView, { view: src.view, account: src.account })).replace(/<!-- -->/g, "");
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  for (const code of ["D01", "D03"]) {
    const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
    const [st] = await db
      .select({ id: s.statements.id })
      .from(s.statements)
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, d.id)));
    const src = (await statementPdfSource(db, tenantId, st.id))!;
    sources.set(code, src);
    let layout: unknown;
    await renderStatementsPdf([src], new Date("2026-11-01T09:00:00+09:00"), { onLayout: (l) => (layout = l) });
    pdfText.set(code, collectLines(layout).join("\n"));
  }
});

afterAll(async () => {
  await client.close();
});

describe("登録番号のある方（青木さん）：仕入明細書の記載事項", () => {
  const items: [string, string[]][] = [
    ["書類の名前", ["支払明細書（仕入明細書）"]],
    ["作成者の名前", ["作成者", "サンプル運送株式会社（架空）"]],
    ["相手方の氏名と登録番号", ["青木 翔太 様", "登録番号 T9876543210987"]],
    ["取引の期間", ["取引の期間", "2026年10月1日〜2026年10月31日"]],
    ["内容（案件）", ["宅配（個建て）", "スポット便"]],
    ["税率ごとの合計と適用税率", ["税率ごとの合計", "10%対象", "374,500円"]],
    ["税率ごとの消費税額", ["消費税（10%）", "37,450円"]],
  ];

  it.each(items)("画面：%s", (_label, words) => {
    const h = screen("D01");
    for (const w of words) expect(h).toContain(w);
  });

  it.each(items)("PDF：%s", (_label, words) => {
    const t = pdfText.get("D01")!;
    for (const w of words) expect(t).toContain(w);
  });

  it("内容は案件 × 数量 × 単価 ＝ 金額（画面は 1 行に、PDF は列に）", () => {
    const h = screen("D01");
    expect(h).toContain("2,310個 × 150円");
    expect(h).toContain("346,500円");
    expect(h).toContain("4件 × 7,000円");
    const lines = pdfText.get("D01")!.split("\n");
    // PDF の表：内容・数量・単位・単価（税抜）・金額（税抜）
    for (const w of ["内容", "数量", "単位", "単価（税抜）", "金額（税抜）", "2,310", "個", "150円", "346,500円", "4", "件", "7,000円", "28,000円"]) expect(lines).toContain(w);
  });

  it("消費税は 1 明細・税率ごとに 1 回（委託料の合計 × 10%）", () => {
    const v = sources.get("D01")!.view;
    expect(v.tax).toBe(Math.floor(v.subtotal * 0.1));
    expect(v.lines.reduce((n, l) => n + l.amount, 0)).toBe(v.subtotal);
  });
});

describe("登録番号の無い方（上田さん）", () => {
  it("「消費税相当額」と書き、仕入明細書とは書かない", () => {
    const h = screen("D03");
    const t = pdfText.get("D03")!;
    for (const x of [h, t]) {
      expect(x).toContain("消費税相当額（10%）");
      expect(x).toContain("27,600円");
      expect(x).toContain("登録番号 なし");
      expect(x).toContain("支払明細書");
      expect(x).not.toContain("仕入明細書）");
      expect(x).not.toMatch(/消費税（10%）\s*27,600/);
    }
  });
});

describe("口座番号は下 3 桁だけ", () => {
  it("画面・PDF とも、下 3 桁のほかは出さない", () => {
    // 会社の登録番号 T1234567890123 に同じ数字の並びがあるので、それを除いて探す
    const h = screen("D01").replaceAll("T1234567890123", "");
    const t = pdfText.get("D01")!.replaceAll("T1234567890123", "");
    expect(h).toContain("口座番号の下3桁 567");
    expect(t).toContain("下3桁 567");
    for (const x of [h, t]) expect(x).not.toMatch(/1234567|234567/);
    expect(JSON.stringify(sources.get("D01")!.account)).toBe(JSON.stringify({ bank: "ﾐｽﾞﾎ", branch: "ｻﾝﾌﾟﾙ", type: "普通", last3: "567" }));
  });
});
