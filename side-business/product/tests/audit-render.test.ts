import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { audit } from "~/server/audit";
import { closeMonth } from "~/server/features/close";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 操作の記録の画面と CSV（事務・オーナー）。閲覧の人は CSV を出せない */
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

async function render(sp: Record<string, string>): Promise<string> {
  const { default: AuditPage } = await import("~/app/(app)/audit/page");
  const el = (await AuditPage({ searchParams: Promise.resolve(sp) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("操作の記録の画面と CSV", () => {
  let client: PGlite;
  let tenantId: string;
  let users: SessionUser[];

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    await seedDemo(t.db);
    const rows = await t.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    users = rows.map((u) => ({ id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role as SessionUser["role"] }));
    users.push({ id: rows[0].id, tenantId, email: "viewer@demo.example", name: "閲覧の人", role: "viewer" });
    const staff = users.find((u) => u.role === "staff")!;
    await generateStatements(t.db, tenantId, DEMO_MONTH, staff.id);
    const [d01] = await t.db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    const [st] = await t.db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, d01.id)));
    await audit(t.db, { tenantId, action: "statement.confirm", entity: "statement", entityId: st.id, detail: { by: "driver", month: DEMO_MONTH, driverId: st.driverId, version: 1, total: st.total } });
    await closeMonth(t.db, tenantId, DEMO_MONTH, staff.id, { runWatch: async () => [], minutesSpent: 60 });
  });
  afterAll(async () => client.close());

  const as = (role: SessionUser["role"]) => (state.user = users.find((u) => u.role === role)!);

  it("この月の記録を、読める言葉・した人・絞り込み・CSV のリンクつきで出す", async () => {
    as("staff");
    const html = await render({ m: "2026-10" });
    const t = text(html);
    expect(t).toContain("操作の記録");
    expect(t).toContain("月を締めた");
    expect(t).toContain("8人・振込額の合計 2,206,094円・かかった時間 60分");
    expect(t).toContain("ドライバーが明細を確認した");
    expect(t).toContain("青木 翔太さん（ドライバー）");
    expect(t).toContain("明細を作った・作り直した");
    expect(t).toContain("デモ 事務さん");
    expect(html).toContain('href="/api/data/audit?m=2026-10"');
    expect(t).toContain("締めと解除（1）");
    expect(t).toContain("ドライバー（1）");
    expect(t).toContain("2026年10月分の締めに関わる操作");
  });

  it("絞り込み：種類「締めと解除」だけ。CSV のリンクにも絞り込みを付ける", async () => {
    as("owner");
    const html = await render({ m: "2026-10", kind: "month" });
    const t = text(html);
    expect(t).toContain("月を締めた");
    expect(t).not.toContain("ドライバーが明細を確認した");
    expect(html).toContain('href="/api/data/audit?m=2026-10&amp;kind=month"');
    expect(t).toContain("絞り込みを外す");
  });

  it("記録の無い月は、空の案内を出す", async () => {
    as("staff");
    const t = text(await render({ m: "2026-12" }));
    expect(t).toContain("この月の操作の記録はまだありません");
  });

  it("CSV：事務は出せて、出したことも記録に残る。閲覧の人は 403", async () => {
    const { GET } = await import("~/app/api/data/audit/route");
    as("staff");
    const res = await GET(new Request("http://localhost/api/data/audit?m=2026-10&who=driver"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("操作の記録_2026年10月分.csv"));
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(await res.arrayBuffer()));
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("青木 翔太さん（ドライバー）");
    const [log] = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.audit_csv")));
    expect(log.detail).toMatchObject({ month: DEMO_MONTH, who: "driver", rows: 1 });

    as("viewer");
    const denied = await GET(new Request("http://localhost/api/data/audit?m=2026-10"));
    expect(denied.status).toBe(403);
    as("staff");
    expect((await GET(new Request("http://localhost/api/data/audit?m=2026-13"))).status).toBe(400);
  });
});
