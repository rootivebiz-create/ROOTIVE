import * as React from "react";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { applyBatch, createDraftFromFile, readSampleFile } from "~/server/features/import/service";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取り込み・稼働の画面を HTML にしてみる（ログインと DB だけ差し替える）。
 * 役割ごと・締めた月で、出すもの・隠すものを文字で確かめる。
 */
const state: { db?: Db; user?: SessionUser } = {};

// テストの変換は JSX を React.createElement にするので、React を見えるところに置く
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/** 非同期の部品（サーバーで描く部品）も待って、文字にする */
async function html(el: ReactElement): Promise<string> {
  let failed: unknown = null;
  const stream = await renderToReadableStream(el, { onError: (e) => void (failed = e) });
  await stream.allReady;
  const out = await new Response(stream).text();
  if (failed) throw failed;
  return out.replace(/<!-- -->/g, "");
}

function text(h: string): string {
  return h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

let client: PGlite;
let tenantId = "";
let otherTenant = "";

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  tenantId = (await seedDemo(t.db)).tenantId;
  otherTenant = (await seedDemo(t.db)).tenantId;
});
afterAll(async () => {
  await client.close();
});

function as(role: SessionUser["role"], tenant = tenantId) {
  state.user = { id: "00000000-0000-4000-8000-000000000001", tenantId: tenant, email: "x@example.com", name: "テスト", role };
}

async function importPage(m: string) {
  const Page = (await import("~/app/(app)/import/page")).default;
  return text(await html(await Page({ searchParams: Promise.resolve({ m }) })));
}

async function batchPage(id: string, sp: Record<string, string> = {}) {
  const Page = (await import("~/app/(app)/import/[id]/page")).default;
  return text(await html(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })));
}

async function workPage(sp: Record<string, string>) {
  const Page = (await import("~/app/(app)/work/page")).default;
  return text(await html(await Page({ searchParams: Promise.resolve(sp) })));
}

describe("取り込みの画面", () => {
  it("事務はファイルを置ける。閲覧は履歴だけ", async () => {
    as("staff");
    const staff = await importPage("2026-10");
    expect(staff).toContain("ファイルを置く");
    expect(staff).toContain("読み込む");
    as("viewer");
    const viewer = await importPage("2026-10");
    expect(viewer).not.toContain("読み込む");
    expect(viewer).toContain("取り込みの履歴だけ見られます");
  });

  it("確認の画面：合計の一致・おすすめの入れ替え方・明細が変わらないこと。閲覧には反映のボタンを出さない", async () => {
    const { fileName, bytes } = await readSampleFile("long");
    const draft = await createDraftFromFile(state.db!, tenantId, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    as("staff");
    const page = await batchPage(draft.id);
    expect(page).toContain("このまま反映できます");
    expect(page).toContain("ファイルの合計（17行目） 5,205 と一致しました");
    expect(page).toContain("おすすめ");
    expect(page).toContain("明細の金額は全員（8人）変わりません");
    expect(page).toContain("反映する（11件を2026年10月分へ）");
    expect(page).toContain("木村 誠");
    as("viewer");
    const viewer = await batchPage(draft.id);
    expect(viewer).not.toContain("反映する（11件");
    expect(viewer).not.toContain("この読み方で読み直す");

    // 別の会社からは見えない
    as("staff", otherTenant);
    await expect(batchPage(draft.id)).rejects.toThrow();

    // 反映したあと：取り消しのボタン（締めていない月だけ）
    as("staff");
    await applyBatch(state.db!, tenantId, { id: null }, draft.id, { mode: "replaceAll", confirmDuplicates: false });
    const applied = await batchPage(draft.id, { done: "applied" });
    expect(applied).toContain("反映しました。11 件");
    expect(applied).toContain("この取り込みを取り消す");
    expect(applied).toContain("明細を作る・作り直す");
  });

  it("締めた月に向けた下書きは、反映のボタンを出さずに理由を出す", async () => {
    const { fileName, bytes } = await readSampleFile("wide");
    const draft = await createDraftFromFile(state.db!, tenantId, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await state
      .db!.update(s.importBatches)
      .set({ month: DEMO_PREV_MONTH })
      .where(and(eq(s.importBatches.id, draft.id), eq(s.importBatches.tenantId, tenantId)));
    as("staff");
    const page = await batchPage(draft.id);
    expect(page).toContain("2026年9月は締め済みなので");
    expect(page).not.toContain("反映へ進む");
    expect(page).not.toMatch(/反映する（\d+件/);
  });
});

describe("稼働と調整の画面", () => {
  it("事務は開いている月で足す・直すができる。締めた月と閲覧は見るだけ", async () => {
    as("staff");
    const open = await workPage({ m: "2026-10" });
    expect(open).toContain("稼働を手で足す");
    expect(open).toContain("調整を足す");
    expect(open).toContain("駐車場代の立替");
    const closed = await workPage({ m: "2026-09" });
    expect(closed).toContain("締め済みです。見るだけできます");
    expect(closed).not.toContain("稼働を手で足す");
    as("viewer");
    const viewer = await workPage({ m: "2026-10" });
    expect(viewer).not.toContain("稼働を手で足す");
    expect(viewer).not.toContain("調整を足す");
  });

  it("「直す」を押すと、その行の直す欄が出る（別の会社の行は出ない）", async () => {
    const [entry] = await state
      .db!.select()
      .from(s.workEntries)
      .where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH)));
    const [adj] = await state.db!.select().from(s.adjustments).where(eq(s.adjustments.tenantId, tenantId));
    as("staff");
    expect(await workPage({ m: "2026-10", edit: entry.id })).toContain("稼働を直す");
    expect(await workPage({ m: "2026-10", adj: adj.id })).toContain("調整を直す");
    as("staff", otherTenant);
    const other = await workPage({ m: "2026-10", edit: entry.id });
    expect(other).not.toContain("稼働を直す");
    expect(other).toContain("直そうとした稼働が見つかりません");
  });
});
