import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { confirmationRecordRows, deemedClauseMap, getStatementDetail, listMonthStatements } from "~/server/features/statements";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * みなし確認は 3 つ（日数・質問なし・取引条件の条項）がそろったときだけ。
 * 条項が無いときは未確認のままにし、会社の画面に「取引条件にみなし確認の条項がありません（/terms で入れられます）」と出す。
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
    requireUser: async () => state.user,
    currentUser: async () => null,
    clientIpHash: async () => "ip-deemed",
    AuthError,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "shimebi.example", "x-forwarded-proto": "https" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const DAY = 86_400_000;
const BLOCKED = "取引条件にみなし確認の条項がありません（";

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, tid = tenantId) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

/** 8 日前に送った（中身は 9 日前に作った）ことにする */
async function sentEightDaysAgo(statementId: string) {
  const now = Date.now();
  await db
    .update(s.statements)
    .set({ updatedAt: new Date(now - 9 * DAY), sentAt: new Date(now - 8 * DAY) })
    .where(eq(s.statements.id, statementId));
}

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

async function detail(id: string) {
  const { default: Page } = await import("~/app/(app)/statements/[id]/page");
  return html((await Page({ params: Promise.resolve({ id }) })) as ReactElement);
}

async function list() {
  const { default: Page } = await import("~/app/(app)/statements/page");
  return html((await Page({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement);
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId)).limit(1);
  state.user = { id: u.id, tenantId, email: u.email, name: u.name, role: "staff" };
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("みなし確認の 3 つの条件", () => {
  it("取引条件の記録が無い：8 日たっても未確認のまま。画面に理由と /terms への案内", async () => {
    const { st } = await statementOf("D01");
    await sentEightDaysAgo(st.id);
    const d = (await getStatementDetail(db, tenantId, st.id))!;
    expect(d.terms).toBeNull();
    expect(d.status).toMatchObject({ key: "sent", deemedBlockedByClause: true, deemedDays: null });
    expect(d.status.deemedCheck).toEqual({ sent: true, daysSinceSent: 8, daysPassed: true, noQuestion: true, clause: false });

    const h = await detail(st.id);
    expect(h).toContain(`${BLOCKED}<a href="/terms">/terms</a> で入れられます）`);
    expect(h).toContain("条項なし（みなし確認にしません）");
    expect(h).toContain("取引条件の記録がありません");
    expect(h).toContain("3 つのうち 2 つ");
    // 一覧：件数にも数えない・誰が止まっているかを出す
    const all = await listMonthStatements(db, tenantId, DEMO_MONTH);
    expect(all.counts.deemed).toBe(0);
    const l = await list();
    expect(l).toContain("取引条件にみなし確認の条項が無いため、未確認のままの人がいます（1人：");
    expect(l).toContain("青木 翔太）");
    // 確認の記録（CSV）の状態も同じ
    const rows = await confirmationRecordRows(db, tenantId, DEMO_MONTH);
    expect(rows.find((r) => r[2] === "青木 翔太")![6]).toBe("送付済み");
  });

  it("記録はあるが条項なし → 未確認。条項を入れた新しい版 → みなし確認（8日経過）", async () => {
    const { st, driver } = await statementOf("D01");
    await sentEightDaysAgo(st.id);
    await db.insert(s.termsRecords).values({ tenantId, driverId: driver.id, version: 1, issuedOn: "2026-04-01", content: {}, deemedClause: false });
    let h = await detail(st.id);
    expect(h).toContain(BLOCKED);
    expect(h).toContain("取引条件の記録（版 1・2026年4月1日）に、みなし確認の条項がありません");

    await db.insert(s.termsRecords).values({ tenantId, driverId: driver.id, version: 2, issuedOn: "2026-09-01", content: {}, deemedClause: true });
    const d = (await getStatementDetail(db, tenantId, st.id))!;
    expect(d.status).toMatchObject({ key: "deemed", label: "みなし確認（8日経過）", deemedBlockedByClause: false });
    h = await detail(st.id);
    expect(h).not.toContain(BLOCKED);
    expect(h).toContain("3 つがそろったため「みなし確認」と表示しています");
    expect(h).toContain("取引条件の記録（版 2・2026年9月1日）に条項があります");
    expect((await listMonthStatements(db, tenantId, DEMO_MONTH)).counts.deemed).toBe(1);
    expect(await list()).not.toContain("未確認のままの人がいます");
  });

  it("送ったばかりのときは、条項が無くても止まっている扱いにしない（まだ関係ない）", async () => {
    const { st } = await statementOf("D02");
    await db.update(s.statements).set({ sentAt: new Date(Date.now() + 1_000) }).where(eq(s.statements.id, st.id));
    const d = (await getStatementDetail(db, tenantId, st.id))!;
    expect(d.status).toMatchObject({ key: "sent", deemedBlockedByClause: false });
    const h = await detail(st.id);
    expect(h).not.toContain(BLOCKED);
    expect(h).toContain("送ってから 0日です（7日たつと満たします）");
  });

  it("他社の取引条件の記録は使わない（B 社の同じ人に条項があっても A 社はみなさない）", async () => {
    const { st } = await statementOf("D01");
    await sentEightDaysAgo(st.id);
    const b = await seedDemo(db);
    const [bDriver] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, b.tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.termsRecords).values({ tenantId: b.tenantId, driverId: bDriver.id, version: 1, issuedOn: "2026-09-01", content: {}, deemedClause: true });
    expect((await getStatementDetail(db, tenantId, st.id))!.status.key).toBe("sent");
    // ドライバーごとの条項（ほかの画面から使う）も会社で絞る
    expect(await deemedClauseMap(db, tenantId, [bDriver.id])).toEqual(new Map());
    expect(await deemedClauseMap(db, b.tenantId, [bDriver.id])).toEqual(new Map([[bDriver.id, true]]));
    expect(await deemedClauseMap(db, tenantId, [])).toEqual(new Map());
  });
});
