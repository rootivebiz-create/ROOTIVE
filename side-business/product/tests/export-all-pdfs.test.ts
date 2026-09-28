import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildTenantExport } from "~/server/features/export-all";
import { buildPdfArchive, pdfArchiveYears } from "~/server/features/export-all/pdfs";
import { bulkCreateTerms } from "~/server/features/terms";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * やめるときに人が読める控え：支払明細と取引条件の明示書の「全部の版」を、年ごとの PDF の ZIP で持ち帰れる。
 */
const state: { db?: Db; user?: SessionUser } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  class AuthError extends Error {}
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async (need: keyof typeof RANK = "viewer") => {
      if (!state.user || RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    AuthError,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const NOW = new Date("2026-11-30T03:00:00Z");

/** PDF の中の文字は圧縮されているので、ページの数（/Type /Page）で中身の数を確かめる */
function pageCount(pdf: Uint8Array): number {
  return (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("読むための PDF（年ごとの ZIP）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherId: string;
  let owner: SessionUser;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    state.db = db;
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    const o = users.find((u) => u.role === "owner")!;
    owner = { id: o.id, tenantId, email: o.email, name: o.name, role: "owner" };
    // 10 月分：第 1 版を作り、青木さんだけ直して第 2 版
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [aoki] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: aoki.id, label: "スポット便の追加", amount: 3_000 });
    await generateStatements(db, tenantId, DEMO_MONTH);
    await bulkCreateTerms(db, tenantId, { userId: o.id, role: "owner" }, { issuedOn: "2026-10-20", place: "会社が指定する配送先", deemed: true }, NOW);
  }, 60_000);
  afterAll(async () => client.close());

  it("年を選ぶ：版のある年だけ（会社ごと）", async () => {
    expect(await pdfArchiveYears(db, tenantId)).toEqual([2026]);
    await expect(buildPdfArchive(db, tenantId, 2019)).rejects.toThrow("2019年の明細・取引条件の記録はありません");
  });

  it("明細の全部の版（前の版も）と取引条件の明示書を PDF にし、目録と README を付ける", async () => {
    const a = await buildPdfArchive(db, tenantId, 2026, { now: NOW });
    const versions = await db.select().from(s.statementVersions).where(and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.month, DEMO_MONTH)));
    const terms = await db.select().from(s.termsRecords).where(eq(s.termsRecords.tenantId, tenantId));
    expect(versions.length).toBe(9); // 8 人の第 1 版 ＋ 青木さんの第 2 版
    expect(a.statementVersions).toBe(9);
    expect(a.termsVersions).toBe(terms.length);
    expect(a.fileName).toMatch(/^しめ日ラボ_PDF_2026年_.+\.zip$/);

    const files = unzipSync(a.bytes);
    const names = Object.keys(files).sort();
    expect(names).toContain("支払明細/2026-10_支払明細_全部の版.pdf");
    expect(names).toContain("取引条件/2026年_取引条件の明示書_全部の版.pdf");
    expect(names).toContain("目録.csv");
    expect(names).toContain("README.txt");

    const statementsPdf = files["支払明細/2026-10_支払明細_全部の版.pdf"];
    expect(strFromU8(statementsPdf.slice(0, 5))).toBe("%PDF-");
    // 1 版 1 ページ以上（9 版）
    expect(pageCount(statementsPdf)).toBeGreaterThanOrEqual(9);
    expect(strFromU8(files["取引条件/2026年_取引条件の明示書_全部の版.pdf"].slice(0, 5))).toBe("%PDF-");

    const index = strFromU8(files["目録.csv"]);
    // 青木さんの第 1 版と第 2 版の両方が入る（版のハッシュで全データの書き出しと照らし合わせられる）
    const aoki = versions.filter((v) => (v.snapshot as { driver?: { code?: string } }).driver?.code === "D01").sort((x, y) => x.version - y.version);
    expect(aoki.map((v) => v.version)).toEqual([1, 2]);
    for (const v of aoki) expect(index).toContain(v.hash);
    expect(index).toContain("取引条件の明示書");
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("2026-10分の支払明細（9版）");
    expect(readme).toContain("全部の版");
    for (const word of ["適法", "問題ありません", "完全対応", "対応済み"]) expect(readme).not.toContain(word);

    // ほかの会社の明細は入らない
    const otherNames = (await db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherId))).map((d) => d.id);
    expect(otherNames.some((id) => index.includes(id))).toBe(false);
  }, 60_000);

  it("全データの書き出しの README に、PDF は別に書き出せることを書く", async () => {
    const ex = await buildTenantExport(db, tenantId, { now: NOW });
    const readme = strFromU8(unzipSync(ex.bytes)["README.txt"]);
    expect(readme).toContain("読むための PDF（支払明細・取引条件の明示書）");
    expect(readme).toContain("「読むための PDF を書き出す」");
  });

  it("ダウンロード（GET /api/data/pdfs?year=）：オーナーだけ。書き出したことを操作の記録に残す。画面に年ごとのボタン", async () => {
    const { GET } = await import("~/app/api/data/pdfs/route");
    state.user = { ...owner, role: "staff" };
    expect((await GET(new Request("https://example.test/api/data/pdfs?year=2026"))).status).toBe(403);
    state.user = owner;
    expect((await GET(new Request("https://example.test/api/data/pdfs?year=abc"))).status).toBe(400);
    expect((await GET(new Request("https://example.test/api/data/pdfs?year=2019"))).status).toBe(404);
    const res = await GET(new Request("https://example.test/api/data/pdfs?year=2026"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/zip");
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "data.export_pdfs")));
    expect(log.detail).toMatchObject({ year: 2026, statementVersions: 9 });

    const { default: DataPage } = await import("~/app/(app)/data/page");
    const html = renderToString((await DataPage()) as ReactElement).replace(/<!-- -->/g, "");
    expect(html).toContain("読むための PDF を書き出す（年ごと）");
    expect(html).toContain('href="/api/data/pdfs?year=2026"');
  }, 60_000);
});
