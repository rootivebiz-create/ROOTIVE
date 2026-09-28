import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { findStatementByToken, loadPortal } from "~/server/features/portal";
import { staffLinkToken } from "~/server/features/statements";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * リンクの作り直し（会社の画面から）。ドライバーのページからは同じ人のほかの月の明細へも行けるので、
 * 画面では「この人のほかの月の明細のリンクも作り直す」を最初から選んでおき、Server Action もそれを受け取る。
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
    // 役割が足りなければ断る（本物と同じ）
    requireUser: async (need: keyof typeof RANK) => {
      if (!state.user || RANK[state.user.role as keyof typeof RANK] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    currentUser: async () => null,
    clientIpHash: async () => "ip-relink",
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

let db: Db;
let client: PGlite;
let tenantId: string;
let staff: SessionUser;

async function statementOf(code: string, tid = tenantId, month = DEMO_MONTH) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, month), eq(s.statements.driverId, d.id)));
  return st;
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  // 9 月（締め済み）と 10 月の明細
  await db.update(s.monthCloses).set({ status: "open" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
  await generateStatements(db, tenantId, DEMO_PREV_MONTH);
  await db.update(s.monthCloses).set({ status: "closed" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId)).limit(1);
  staff = { id: u.id, tenantId, email: u.email, name: u.name, role: "staff" };
  state.user = staff;
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("リンクの作り直し（Server Action と画面）", () => {
  it("「ほかの月も」を選ぶと、締めた 9 月のリンクも作り直す。外すと 10 月だけ", async () => {
    const { recreateLinkAction } = await import("~/app/(app)/statements/actions");
    const oct = await statementOf("D01");
    const sepToken = tokenFromPortal((await loadPortal(db, staffLinkToken(oct).token))!.others[0].href);

    // 外したとき：10 月だけ。9 月のリンクは使えるまま
    let r = await recreateLinkAction(undefined, form({ id: oct.id }));
    expect(r).toMatchObject({ ok: true, message: "リンクを作り直しました。今までのリンクは使えません。新しいリンクを送ってください" });
    expect(await findStatementByToken(db, sepToken)).not.toBeNull();

    // 選んだとき：ほかの月（9 月）も
    r = await recreateLinkAction(undefined, form({ id: oct.id, allMonths: "1" }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toContain("この人のほかの月の明細 1件のリンクも作り直しました");
    expect(await findStatementByToken(db, sepToken)).toBeNull();
  });

  it("見るだけの人は作り直せない（リンクはそのまま）。他社の明細の id も断る", async () => {
    const { recreateLinkAction } = await import("~/app/(app)/statements/actions");
    const oct = await statementOf("D01");
    const before = oct.linkNonce;
    state.user = { ...staff, role: "viewer" };
    const r = await recreateLinkAction(undefined, form({ id: oct.id, allMonths: "1" }));
    expect(r.ok).toBe(false);
    expect((await statementOf("D01")).linkNonce).toBe(before);

    state.user = staff;
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const bOct = await statementOf("D01", b.tenantId);
    const r2 = await recreateLinkAction(undefined, form({ id: bOct.id, allMonths: "1" }));
    expect(r2).toMatchObject({ ok: false, error: "明細が見つかりません。一覧から開き直してください" });
    expect((await statementOf("D01", b.tenantId)).linkNonce).toBe(bOct.linkNonce);
  });

  it("明細の画面：作り直しの確かめの箱に「ほかの月も」の選択（最初から選んである）。見るだけの人には出さない", async () => {
    const { default: Page } = await import("~/app/(app)/statements/[id]/page");
    const oct = await statementOf("D01");
    // 確かめの箱は押してから開くので、中身の部品を直接描いて確かめる
    const { RecreateConfirm } = await import("~/components/statements/link-panel");
    const confirm = renderToString(React.createElement(RecreateConfirm, { statementId: oct.id, action: () => undefined, pending: false, onCancel: () => undefined })).replace(/<!-- -->/g, "");
    expect(confirm).toContain("この人のほかの月の明細のリンクも作り直す（おすすめ）");
    const box = /<input type="checkbox"[^>]*>/.exec(confirm)?.[0] ?? "";
    expect(box).toContain('name="allMonths"');
    expect(box).toContain('value="1"');
    expect(box).toContain('checked=""');
    expect(confirm).toContain(`name="id" value="${oct.id}"`);
    const page = renderToString((await Page({ params: Promise.resolve({ id: oct.id }) })) as ReactElement);
    expect(page).toContain("リンクを作り直す");

    state.user = { ...staff, role: "viewer" };
    const viewerPage = renderToString((await Page({ params: Promise.resolve({ id: oct.id }) })) as ReactElement);
    expect(viewerPage).not.toContain("リンクを作り直す");
  });
});

function tokenFromPortal(href: string): string {
  expect(href.startsWith("/s/")).toBe(true);
  return href.slice(3);
}
