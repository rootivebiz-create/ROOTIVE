import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { closeMonth, reopenMonth } from "~/server/features/close";
import { createTransferBatch } from "~/server/features/transfer";
import { runWatch } from "~/server/features/watch";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 締め・振込の画面を HTML にしてみる（ログインと DB だけ差し替える）。
 * 役割ごとに、出してよいもの・隠すものが正しいかを文字で確かめる。
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

async function render(page: (props: { searchParams: Promise<{ m?: string }> }) => Promise<ReactElement>, m = "2026-10"): Promise<string> {
  const el = await page({ searchParams: Promise.resolve({ m }) });
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("締め・振込の画面", () => {
  let client: PGlite;
  let tenantId: string;
  let users: SessionUser[];

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    const rows = await t.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    users = rows.map((u) => ({ id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role as SessionUser["role"] }));
    users.push({ id: rows[0].id, tenantId, email: "viewer@demo.example", name: "閲覧の人", role: "viewer" });
  });
  afterAll(async () => client.close());

  const as = (role: SessionUser["role"]) => {
    state.user = users.find((u) => u.role === role)!;
  };

  it("振込：明細が無いうちは明細の画面へ案内する", async () => {
    as("staff");
    const { default: TransferPage } = await import("~/app/(app)/transfer/page");
    const html = await render(TransferPage);
    expect(html).toContain("まだ振込データを作れません");
    expect(html).toContain("/statements?m=2026-10");
    expect(html).toContain("この月の振込データはまだありません");
  });

  it("振込：事務は作る画面と、入らない人（D07・口座が未登録）を見る", async () => {
    await generateStatements(state.db!, tenantId, DEMO_MONTH);
    as("staff");
    const { default: TransferPage } = await import("~/app/(app)/transfer/page");
    const html = await render(TransferPage);
    expect(html).toContain("2026年10月分の振込データを作る");
    expect(html).toContain("振込データを作る（7人・2,171,664円）");
    expect(html).toContain("木村 誠");
    expect(html).toContain("口座が未登録です");
    // 口座を入れる画面へ、その人のページに直接つなぐ
    const [d07] = await state.db!.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D07")));
    expect(html).toContain(`/settings/drivers/${d07.id}`);
    expect(html).toContain("ｱｵｷ ｼﾖｳﾀ");
    expect(html).not.toContain("振込手数料はドライバーの負担");
  });

  it("振込：閲覧の人には作る画面も口座も出さず、記録だけ見せる", async () => {
    await createTransferBatch(state.db!, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, users[0].id);
    as("viewer");
    const { default: TransferPage } = await import("~/app/(app)/transfer/page");
    const html = await render(TransferPage);
    expect(html).toContain("振込_2026年10月分_20261125.txt");
    expect(html).toContain("振込データを作れるのは事務・オーナーの方です");
    expect(html).not.toContain("振込データを作る（");
    expect(html).not.toContain("1234567");
    expect(html).not.toContain("/api/transfer/");
  });

  it("振込：手数料をドライバーの負担にしていると赤い注意を出す", async () => {
    const db = state.db!;
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    await db.update(s.tenants).set({ settings: { ...t.settings, transferFeeBearer: "driver" } }).where(eq(s.tenants.id, tenantId));
    as("staff");
    const { default: TransferPage } = await import("~/app/(app)/transfer/page");
    const html = await render(TransferPage);
    expect(html).toContain("振込手数料はドライバーの負担");
    expect(html).toContain("/watch?m=2026-10");
    expect(html).toContain("/api/transfer/");
    await db.update(s.tenants).set({ settings: t.settings }).where(eq(s.tenants.id, tenantId));
  });

  it("締め：6 つの確かめ。見張り番の赤が残っている間は締められず、確認済みにすると締めるボタンが出る（事務）", async () => {
    as("staff");
    const { default: ClosePage } = await import("~/app/(app)/close/page");
    let html = await render(ClosePage);
    for (const title of ["稼働が入っている", "明細が最新", "見張り番の赤い指摘", "Excel との比べ合わせ", "振込データ（参考）", "ドライバーの確認"]) expect(html).toContain(title);
    // タグを外した文字で確かめる
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("稼働 11 件（8人）・調整 2 件");
    expect(text).toContain("1 件・7人・今の明細で合計 2,171,664円（振り込んだ日の記録 0 件）");
    // 架空の会社の 10 月は、見張り番の赤（取引条件の明示の記録・合意の記録が無い控除）がある
    const red = (await runWatch(state.db!, tenantId, DEMO_MONTH)).filter((i) => i.severity === "red" && !i.acked);
    expect(red.length).toBeGreaterThan(0);
    expect(html).toContain("まだ締められません");
    expect(html).toContain(`見張り番の赤い指摘が ${red.length} 件あります`);
    expect(html).not.toContain("2026年10月を締める…");

    // 内容を確かめて「確認済み」にすると締められる
    await state.db!.insert(s.watchAcks).values(red.map((i) => ({ tenantId, month: DEMO_MONTH, code: i.code, subjectId: i.subjectId, note: "内容を確かめた" })));
    html = await render(ClosePage);
    expect(html).not.toContain("まだ締められません");
    expect(html).toContain("2026年10月を締める…");
    expect(html).toContain("2026年10月の操作の記録");
    expect(html).toContain("振込データを作った");
  });

  it("締め：締めたあとは、次にすることと、オーナーだけの「締めを外す」", async () => {
    await closeMonth(state.db!, tenantId, DEMO_MONTH, users.find((u) => u.role === "staff")!.id, { runWatch: async () => [] });
    as("staff");
    const { default: ClosePage } = await import("~/app/(app)/close/page");
    let html = await render(ClosePage);
    expect(html).toContain("締めました。この月の稼働・調整・明細は変えられません。");
    expect(html).toContain("明細をドライバーへ送る");
    expect(html).toContain("締めを外せるのはオーナーの方だけです");
    expect(html).not.toContain("締めを外す理由");
    as("owner");
    html = await render(ClosePage);
    expect(html).toContain("締めを外す理由");
  });

  it("締め：外したあとは、外した理由を見せる", async () => {
    const owner = users.find((u) => u.role === "owner")!;
    await reopenMonth(state.db!, tenantId, DEMO_MONTH, { id: owner.id, role: "owner" }, "スポット便の入れ漏れ");
    as("staff");
    const { default: ClosePage } = await import("~/app/(app)/close/page");
    const html = await render(ClosePage);
    expect(html).toContain("締めを外しています（理由：スポット便の入れ漏れ）");
    expect(html).toContain("2026年10月を締める…");
  });
});
