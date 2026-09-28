import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { explainDiff, goLiveGate, loadParallelReport, parallelSummary, saveParallelChecks, type ParallelReport, type ParallelRow } from "~/server/features/parallel";
import { PDF_MAX_DIFF_ROWS, renderParallelPdf } from "~/server/pdf/parallel-pdf";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 並行運用レポートの PDF（A4 1 ページ）と、その出口 GET /api/parallel/pdf。
 * 画面と同じ loadParallelReport から作る。人数が多くても 1 ページ。見るだけの人も受け取れ、持ち出しの記録が残る。
 */
const state: { db?: Db; user?: SessionUser } = {};

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  class AuthError extends Error {}
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async (need: keyof typeof RANK = "viewer") => {
      if (!state.user) throw new AuthError("ログインしてください");
      if (RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    AuthError,
  };
});

function pageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.slice(0, 5)).toBe("%PDF-");
  return Math.max(...[...text.matchAll(/\/Count (\d+)/g)].map((x) => Number(x[1])));
}

let client: PGlite;
let tenantId: string;
let otherId: string;
const userIds = new Map<string, string>();

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  for (const u of await t.db.select({ id: s.users.id, tenantId: s.users.tenantId }).from(s.users)) userIds.set(u.tenantId, u.id);
});
afterAll(async () => client.close());

const asUser = (role: SessionUser["role"], tenant = tenantId): SessionUser => ({ id: userIds.get(tenant)!, tenantId: tenant, email: `${role}@demo.example`, name: `デモ ${role}`, role });

describe("並行運用レポート（PDF）", () => {
  it("デモの 10 月（一致 1・差 2・未入力 5）を A4 の 1 ページにできる", async () => {
    const db = state.db!;
    const rows = await db.select({ id: s.drivers.id, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
    const ids = Object.fromEntries(rows.map((r) => [r.code!, r.id]));
    await saveParallelChecks(db, tenantId, DEMO_MONTH, [
      { driverId: ids.D01, excelTotal: 357_555 },
      { driverId: ids.D02, excelTotal: 372_720, note: "Excel で管理費を引き忘れていた。しめ日ラボに合わせる" },
      { driverId: ids.D03, excelTotal: 256_740 },
    ]);
    const report = await loadParallelReport(db, tenantId, DEMO_MONTH);
    expect(report.gate.ready).toBe(false);
    expect(pageCount(await renderParallelPdf(report, new Date("2026-11-02T09:00:00+09:00")))).toBe(1);
  });

  it("50 人・全員に差があり、長いメモでも 1 ページ（差のある人は上限まで行にし、残りは「ほか n 人」）。切り替え済みの形も 1 ページ", async () => {
    const base = await loadParallelReport(state.db!, tenantId, DEMO_MONTH);
    const parts = base.view.rows.find((r) => r.parts)!.parts!;
    const rows: ParallelRow[] = Array.from({ length: 50 }, (_, i) => {
      const diff = (i % 2 === 0 ? 1 : -1) * (1000 + i * 37);
      return {
        driverId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        name: `架空 ドライバー長い名前${i}`,
        code: `D${100 + i}`,
        ours: 300_000 + diff,
        source: "saved",
        stale: false,
        draftTotal: null,
        excelTotal: 300_000,
        note: i % 3 === 0 ? null : "Excel の計算式が古い単価のままだったため、しめ日ラボの額に合わせることにした。次の月から Excel も直す（事務の山田さんと確認済み）",
        updatedAt: new Date(),
        diff,
        parts,
        explanations: explainDiff(parts, diff),
      };
    });
    const stress: ParallelReport = {
      ...base,
      view: { ...base.view, rows, summary: parallelSummary(rows) },
      gate: goLiveGate(rows, 1),
      totals: { ours: rows.reduce((a, r) => a + (r.ours ?? 0), 0), excel: 300_000 * 50 },
    };
    expect(stress.view.summary.different).toBe(50);
    expect(PDF_MAX_DIFF_ROWS).toBeLessThan(50);
    expect(pageCount(await renderParallelPdf(stress))).toBe(1);
    // いちばん行が多くなる形：差のある人 20・一致 15・未入力 15（名前が長い）・続けての月が足りない
    const mixed = rows.map((r, i) =>
      i < 20 ? r : i < 35 ? { ...r, diff: 0, ours: 300_000, note: null, explanations: explainDiff(parts, 0) } : { ...r, excelTotal: null, diff: null, note: null, explanations: [] },
    );
    const worst: ParallelReport = { ...stress, view: { ...stress.view, rows: mixed, summary: parallelSummary(mixed) }, gate: goLiveGate(mixed, 0) };
    expect(worst.gate.notEntered).toHaveLength(15);
    expect(pageCount(await renderParallelPdf(worst))).toBe(1);
    // 全員一致で切り替え済み
    const matched = rows.map((r) => ({ ...r, diff: 0, ours: 300_000, explanations: explainDiff(parts, 0) }));
    const done: ParallelReport = { ...stress, view: { ...stress.view, rows: matched, summary: parallelSummary(matched) }, gate: goLiveGate(matched, 3), golive: DEMO_MONTH };
    expect(pageCount(await renderParallelPdf(done))).toBe(1);
  });
});

describe("GET /api/parallel/pdf", () => {
  it("見るだけの人も受け取れ、持ち出しの記録が残る（この会社だけ）", async () => {
    state.user = asUser("viewer");
    const { GET } = await import("~/app/api/parallel/pdf/route");
    const res = await GET(new Request("http://localhost/api/parallel/pdf?m=2026-10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("並行運用レポート_2026年10月.pdf"));
    expect(pageCount(new Uint8Array(await res.arrayBuffer()))).toBe(1);
    const logs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.parallel_pdf")));
    expect(logs).toHaveLength(1);
    expect(logs[0].entityId).toBe(DEMO_MONTH);
    expect(logs[0].detail).toMatchObject({ compared: 3, matched: 1, diffTotal: -26_000, ready: false });
    expect(await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, otherId), eq(s.auditLog.action, "export.parallel_pdf")))).toHaveLength(0);
  });

  it("ログインしていなければ 403。比べていない月・ほかの会社（入れていない）は 404 で戻り先を出す", async () => {
    const { GET } = await import("~/app/api/parallel/pdf/route");
    state.user = undefined;
    expect((await GET(new Request("http://localhost/api/parallel/pdf?m=2026-10"))).status).toBe(403);
    state.user = asUser("viewer");
    const res = await GET(new Request("http://localhost/api/parallel/pdf?m=2026-09"));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("まだ Excel の振込額が入っていません");
    expect(html).toContain("/parallel?m=2026-09");
    // ほかの会社の人は、この会社の比べ合わせを受け取れない（その会社は何も入れていない）
    state.user = asUser("viewer", otherId);
    expect((await GET(new Request("http://localhost/api/parallel/pdf?m=2026-10"))).status).toBe(404);
  });
});
