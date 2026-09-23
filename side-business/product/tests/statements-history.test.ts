import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { confirmFromPortal } from "~/server/features/portal";
import { getStatementDetail, getStatementRow, loadVersionHistory, staffLinkToken } from "~/server/features/statements";
import { buildVersionHistory, type HistoryVersionInput } from "~/server/features/statements/history";
import type { DriverStatementView } from "~/server/features/statements/view";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 版の履歴：どの版も写しから並べ、となりの版の違いと、どの版をいつ確認したかを結びつける。
 * 会社の画面（1 人の明細・前の版の中身）にも出ることを、ログインと DB を差し替えて確かめる。
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
    clientIpHash: async () => "ip-history-test",
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

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ctx = { ipHash: "ip-hash-history", userAgent: IPHONE };
const pause = () => new Promise((r) => setTimeout(r, 5));

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

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

function asUser(role: SessionUser["role"], userId: string): SessionUser {
  return { id: userId, tenantId, email: `${role}@demo.example`, name: `デモ ${role}`, role };
}

/** 青木さん（D01）の明細を 3 つの版にする：版 1 を確認 → 調整を足す（版 2・事務が作る）→ 宅配の数量を直す（版 3）→ 版 3 を確認 */
async function threeVersions() {
  const [staff] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  const { st, driver } = await statementOf("D01");
  const token = staffLinkToken(st).token;
  await confirmFromPortal(db, token, { version: 1 }, ctx);
  await pause();
  await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "高速代の立替", amount: 1200, agreedInWriting: true });
  await generateStatements(db, tenantId, DEMO_MONTH, staff.id);
  await pause();
  const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
  await db
    .update(s.workEntries)
    .set({ qty: 2320 })
    .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, driver.id), eq(s.workEntries.projectId, takuhai.id)));
  await generateStatements(db, tenantId, DEMO_MONTH, staff.id);
  await confirmFromPortal(db, token, { version: 3 }, ctx);
  return { st: (await getStatementRow(db, tenantId, st.id))!, staff };
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("版の履歴（DB）", () => {
  it("3 つの版：新しい順・となりの版の違い・作った人・どの版をいつ確認したか（デモの数字）", async () => {
    const { st } = await threeVersions();
    expect(st).toMatchObject({ version: 3, total: 360_240 });
    const history = await loadVersionHistory(db, tenantId, st);
    expect(history.map((h) => [h.version, h.total, h.current, h.prevVersion, h.createdByName])).toEqual([
      [3, 360_240, true, 2, "デモ 事務"],
      [2, 358_755, false, 1, "デモ 事務"],
      [1, 357_555, false, null, null],
    ]);
    expect(history[0].changes).toEqual([
      "宅配（個建て）：数量 2,310 → 2,320個、金額 346,500円 → 348,000円",
      "引かれているもの「ロイヤリティ」：37,450円 → 37,600円",
      "消費税：37,450円 → 37,600円",
      "お振込額：358,755円 → 360,240円（＋1,485円）",
    ]);
    expect(history[1].changes).toEqual(["調整「高速代の立替」＋1,200円 が加わりました", "お振込額：357,555円 → 358,755円（＋1,200円）"]);
    expect(history[2].changes).toEqual([]);
    // 確認は版ごと。確認したときの振込額と、目印が写しと同じか
    expect(history[2].confirmations).toHaveLength(1);
    expect(history[2].confirmations[0]).toMatchObject({ total: 357_555, hashMatches: true });
    expect(history[1].confirmations).toEqual([]);
    expect(history[0].confirmations[0]).toMatchObject({ total: 360_240, hashMatches: true });
    // 目印（ハッシュの頭 12 文字）は版の写しのもの
    const versions = await db.select().from(s.statementVersions).where(and(eq(s.statementVersions.tenantId, tenantId), eq(s.statementVersions.statementId, st.id)));
    expect(new Set(history.map((h) => h.hashShort))).toEqual(new Set(versions.map((v) => v.hash.slice(0, 12))));
    expect(history.every((h) => !h.missing && h.createdAtText?.startsWith("20"))).toBe(true);

    // 1 人の明細の中身にも入る
    const detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.history.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(detail.status.key).toBe("confirmed");
  });

  it("他社の明細の行を渡しても何も返さない。B 社の版は A 社の履歴に混ざらない", async () => {
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const { st: bSt } = await statementOf("D01", b.tenantId);
    expect(await loadVersionHistory(db, tenantId, bSt)).toEqual([]);
    expect((await loadVersionHistory(db, b.tenantId, bSt)).map((h) => h.version)).toEqual([1]);
    const { st } = await statementOf("D01");
    const mine = await loadVersionHistory(db, tenantId, st);
    expect(mine).toHaveLength(1);
    expect(mine[0].hashShort).toBe(st.hash.slice(0, 12));
  });
});

describe("版の履歴（純関数）", () => {
  const base = {
    title: "支払明細書",
    month: "2026-10-01",
    period: { from: "2026-10-01", to: "2026-10-31" },
    payDate: "2026-11-25",
    company: { name: "サンプル", registrationNo: null },
    driver: { name: "上田 健", code: "D03", registrationNo: null, invoiceRegistered: false },
    isPurchaseStatement: false,
    lines: [{ key: "p1", project: "宅配", client: null, unit: "個", qty: 100, rate: 150, amount: 15_000 }],
    subtotal: 15_000,
    tax: 1_500,
    taxLabel: "消費税相当額",
    taxRatePercent: 10,
    deductions: [],
    deductionTotal: 0,
    deductionTax: 0,
    adjustments: [],
    adjustmentTotal: 0,
    adjustmentTax: 0,
    withholding: null,
    total: 16_500,
    note: "",
    version: 1,
    hashShort: "",
  } satisfies DriverStatementView;
  const v = (version: number, qty: number, hash: string): HistoryVersionInput => {
    const amount = qty * 150;
    return {
      version,
      hash,
      createdAt: new Date(`2026-11-0${version}T00:00:00Z`),
      total: amount + amount / 10,
      createdByName: null,
      view: { ...base, version, lines: [{ ...base.lines[0], qty, amount }], subtotal: amount, tax: amount / 10, total: amount + amount / 10 },
    };
  };

  it("写しが欠けている版をとばして、近い古い版と比べる。確認だけが残る版も 1 行にする", () => {
    const items = buildVersionHistory(
      [v(1, 100, "h1"), v(3, 120, "h3")],
      [
        { version: 2, hash: "h2", createdAt: new Date("2026-11-02T01:00:00Z"), totalAtConfirm: 17_600 },
        { version: 3, hash: "other", createdAt: new Date("2026-11-03T01:00:00Z"), totalAtConfirm: 19_800 },
      ],
      3,
    );
    expect(items.map((i) => [i.version, i.missing, i.prevVersion, i.current])).toEqual([
      [3, false, 1, true],
      [2, true, null, false],
      [1, false, null, false],
    ]);
    expect(items[0].changes[0]).toBe("宅配：数量 100 → 120個、金額 15,000円 → 18,000円");
    // 目印が違う確認は、そうと分かるように
    expect(items[0].confirmations).toEqual([{ at: "2026年11月3日 10:00", total: 19_800, hashMatches: false }]);
    expect(items[1]).toMatchObject({ total: 17_600, hashShort: "h2", createdAtText: null });
    expect(items[1].confirmations).toEqual([{ at: "2026年11月2日 10:00", total: 17_600, hashMatches: false }]);
  });

  it("版が 1 つだけなら、違いも前の版も無い", () => {
    const [only] = buildVersionHistory([v(1, 100, "h1")], [], 1);
    expect(only).toMatchObject({ version: 1, current: true, prevVersion: null, changes: [], confirmations: [], total: 16_500 });
  });
});

describe("会社の画面", () => {
  it("1 人の明細に「版の履歴」、前の版の中身は /versions/<版> で開ける（口座は出さない）", async () => {
    const { st, staff } = await threeVersions();
    state.user = asUser("staff", staff.id);
    const { default: Detail } = await import("~/app/(app)/statements/[id]/page");
    const h = html((await Detail({ params: Promise.resolve({ id: st.id }) })) as ReactElement);
    expect(h).toContain("版の履歴");
    expect(h).toContain("版 2 から変わったところ");
    expect(h).toContain("宅配（個建て）：数量 2,310 → 2,320個");
    expect(h).toContain(`/statements/${st.id}/versions/1`);
    expect(h).toContain("（デモ 事務）");

    const { default: Version } = await import("~/app/(app)/statements/[id]/versions/[version]/page");
    const v1 = html((await Version({ params: Promise.resolve({ id: st.id, version: "1" }) })) as ReactElement);
    expect(v1).toContain("青木 翔太さんの支払明細・版 1");
    expect(v1).toContain("これは前の版の写しです（いまの版は 版 3）");
    expect(v1).toContain("357,555円");
    expect(v1).toContain("この版から、いまの版（版 3）までに変わったところ");
    expect(v1).toContain("に確認しています");
    expect(v1).not.toContain("口座番号の下3桁");
    // 無い版・形の違う版・他社の明細は開けない
    await expect(Version({ params: Promise.resolve({ id: st.id, version: "9" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(Version({ params: Promise.resolve({ id: st.id, version: "x" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const { st: bSt } = await statementOf("D01", b.tenantId);
    await expect(Version({ params: Promise.resolve({ id: bSt.id, version: "1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
