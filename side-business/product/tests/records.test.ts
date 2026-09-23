import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { parseRecordsQuery, recordsCsvRows, recordsQueryString, searchStatementRecords } from "~/server/features/statements/records";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 明細の検索（/records・SPEC P0-7）：月をまたいで、期間・振込額の範囲・ドライバーで探し、どの版も開ける。索引は CSV。
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
    requireUser: async () => {
      if (!state.user) throw new AuthError("ログインしてください");
      return state.user;
    },
    AuthError,
  };
});

let client: PGlite;
let tenantId: string;
let otherId: string;
let d01: string;
let d02: string;

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  await generateStatements(t.db, tenantId, DEMO_MONTH);
  await generateStatements(t.db, otherId, DEMO_MONTH);
  const drivers = await t.db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
  d01 = drivers.find((d) => d.code === "D01")!.id;
  d02 = drivers.find((d) => d.code === "D02")!.id;
  // D01 の稼働を直して作り直す → 版 2
  const [entry] = await t.db
    .select()
    .from(s.workEntries)
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, d01)))
    .limit(1);
  await t.db.update(s.workEntries).set({ qty: Number(entry.qty) + 1 }).where(eq(s.workEntries.id, entry.id));
  await generateStatements(t.db, tenantId, DEMO_MONTH);
  // D02 の稼働・調整をすべて消して作り直す → 明細は消えるが、版の写しは残る
  await t.db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, d02)));
  await t.db.delete(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, DEMO_MONTH), eq(s.adjustments.driverId, d02)));
  await generateStatements(t.db, tenantId, DEMO_MONTH);
});
afterAll(async () => client.close());

const all = { driverId: null, from: null, to: null, min: null, max: null };

describe("明細の検索", () => {
  it("会社で絞る。前の版も並び、作り直しで消えた明細も版の写しから見つかる", async () => {
    const r = await searchStatementRecords(state.db!, tenantId, all);
    const mine = await state.db!.select({ id: s.statements.id }).from(s.statements).where(eq(s.statements.tenantId, tenantId));
    // いまある明細 ＋ 消えた D02 の明細
    expect(r.total).toBe(mine.length + 1);
    const a = r.rows.find((x) => x.driverId === d01)!;
    expect(a.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(a.exists).toBe(true);
    const b = r.rows.find((x) => x.driverId === d02)!;
    expect(b.exists).toBe(false);
    // ほかの会社の明細は出ない
    const other = await searchStatementRecords(state.db!, otherId, all);
    expect(other.rows.some((x) => r.rows.some((y) => y.statementId === x.statementId))).toBe(false);
  });

  it("ドライバー・期間・振込額の範囲（最新の版の額）で絞れる", async () => {
    const byDriver = await searchStatementRecords(state.db!, tenantId, { ...all, driverId: d01 });
    expect(byDriver.rows.map((x) => x.driverId)).toEqual([d01]);
    expect((await searchStatementRecords(state.db!, tenantId, { ...all, from: "2026-11-01" })).total).toBe(0);
    expect((await searchStatementRecords(state.db!, tenantId, { ...all, from: DEMO_MONTH, to: DEMO_MONTH })).total).toBeGreaterThan(0);
    const latest = byDriver.rows[0].latest.total;
    expect((await searchStatementRecords(state.db!, tenantId, { ...all, driverId: d01, min: latest, max: latest })).total).toBe(1);
    expect((await searchStatementRecords(state.db!, tenantId, { ...all, driverId: d01, min: latest + 1 })).total).toBe(0);
    // 件数の上限
    const one = await searchStatementRecords(state.db!, tenantId, all, 1);
    expect(one.rows).toHaveLength(1);
    expect(one.truncated).toBe(true);
  });

  it("URL の値の読み方：全角・カンマの額、逆にした範囲、読めない値は指定なし", () => {
    const q = parseRecordsQuery({ driver: "not-a-uuid", from: "2026-12", to: "2026-01", min: "３００,０００円", max: "100000" });
    expect(q).toEqual({ driverId: null, from: "2026-01-01", to: "2026-12-01", min: 100000, max: 300000 });
    expect(parseRecordsQuery({ from: "2026-13", min: "abc" })).toEqual(all);
    expect(recordsQueryString(q)).toBe("from=2026-01&to=2026-12&min=100000&max=300000");
  });

  it("索引の CSV は版ごとに 1 行", async () => {
    const r = await searchStatementRecords(state.db!, tenantId, all);
    const rows = recordsCsvRows(r);
    expect(rows[0][0]).toBe("月");
    expect(rows.length - 1).toBe(r.rows.reduce((n, x) => n + x.versions.length, 0));
  });

  it("画面：前の版へのリンク・消えた明細の印。CSV は会社で絞り、持ち出しを記録する", async () => {
    const [owner] = await state.db!.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
    state.user = { id: owner.id, tenantId, email: owner.email, name: owner.name, role: "viewer" };
    const { default: Page } = (await import("~/app/(app)/records/page")) as unknown as {
      default: (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>;
    };
    const html = renderToString(await Page({ searchParams: Promise.resolve({ from: "2026-10", to: "2026-10" }) })).replace(/<!-- -->/g, "");
    const a = (await searchStatementRecords(state.db!, tenantId, { ...all, driverId: d01 })).rows[0];
    expect(html).toContain(`/statements/${a.statementId}/versions/1`);
    expect(html).toContain("作り直しで消えた明細");
    expect(html).toContain("/api/records/csv?from=2026-10&amp;to=2026-10");

    const { GET } = await import("~/app/api/records/csv/route");
    const res = await GET(new Request("https://shimebi.example/api/records/csv?from=2026-10&to=2026-10"));
    expect(res.status).toBe(200);
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text).toContain("月,コード,ドライバー");
    expect(text).not.toContain(otherId);
    const logs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.records_csv")));
    expect(logs).toHaveLength(1);

    state.user = undefined;
    expect((await GET(new Request("https://shimebi.example/api/records/csv"))).status).toBe(403);
  });
});
