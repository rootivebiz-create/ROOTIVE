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
import { createTransferBatch, deleteTransferBatch, loadTransferReview, setTransferExecutedOn } from "~/server/features/transfer";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 振込の画面：作る前に「口座が変わった人」と「質問・確認の様子」を必ず見せる（役割ごとに） */
const state: { db?: Db; user?: SessionUser } = {};
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

async function render(m: string): Promise<string> {
  const { default: TransferPage } = await import("~/app/(app)/transfer/page");
  const el = (await TransferPage({ searchParams: Promise.resolve({ m }) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("振込の画面：作る前に確かめること", () => {
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
    await generateStatements(t.db, tenantId, DEMO_MONTH);
  });
  afterAll(async () => client.close());

  const as = (role: SessionUser["role"]) => (state.user = users.find((u) => u.role === role)!);

  it("初めての振込：変わった人はいない・7 人は初めて・未確認の明細を知らせる（止めない）", async () => {
    as("staff");
    const html = await render("2026-10");
    const t = text(html);
    expect(t).toContain("作る前に確かめること");
    expect(t).toContain("前回の振込から口座が変わった人");
    expect(t).toContain("振込する 7人の口座を、前に作った振込データのときの口座と比べました。変わった人はいません。");
    expect(t).toContain("初めての振込");
    expect(t).toContain("青木 翔太、井上 美咲、上田 健、遠藤 大輔、岡田 拓也、加藤 由美、佐藤 亮（7人）は、前に振り込んだ記録がありません");
    expect(t).toContain("まだ確認されていない 8人");
    expect(t).toContain("振込データは作れます（止めません）");
    // 確かめる欄は、変わった人がいないので出さない
    expect(t).not.toContain("口座が変わった人を確かめました");
  });

  it("口座が変わった人は、変えた人と日時・前と今（下 3 桁）つきで出し、確かめる欄を出す。作ったあとに変わったデータはダウンロードを止める", async () => {
    const db = state.db!;
    const staff = users.find((u) => u.role === "staff")!;
    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staff.id);
    const [d03] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D03")));
    await db.update(s.drivers).set({ branchCode: "305", accountNumber: "1111111" }).where(eq(s.drivers.id, d03.id));
    await audit(db, {
      tenantId,
      userId: staff.id,
      action: "driver.update",
      entity: "driver",
      entityId: d03.id,
      detail: { name: d03.name, changed: { branchCode: { from: "303", to: "305" }, accountNumber: { from: "3456789", to: "1111111" } } },
    });
    as("staff");
    const html = await render("2026-10");
    const t = text(html);
    expect(t).toContain("上田 健（D03）");
    expect(t).toContain("0009-303 普通 ****789");
    expect(t).toContain("0009-305 普通 ****111");
    expect(t).toContain("変わったところ支店・口座番号");
    expect(t).toMatch(/デモ 事務さんが支店コード・口座番号を変えました/);
    // 作ったあとに口座が変わった振込データは、ダウンロードの代わりに注意を出す
    expect(t).toContain("この振込データを作ったあとに、口座が変わった人がいます（上田 健）");
    expect(html).not.toContain(`/api/transfer/${batch.id}?m=2026-10`);
    // 口座番号そのものは、変わった人の欄に出さない（下 3 桁だけ）
    const reviewPart = t.slice(t.indexOf("作る前に確かめること"), t.indexOf("明細の質問と確認の様子"));
    expect(reviewPart).not.toContain("1111111");
    expect(reviewPart).not.toContain("3456789");

    // 取り消して作り直すときも、取り消したデータと比べて「変わった人」を出し、確かめる欄を出す
    await deleteTransferBatch(db, tenantId, batch.id, staff.id);
    const againHtml = await render("2026-10");
    const again = text(againHtml);
    expect(again).toContain("上田 健（D03）");
    // 確かめた印には、画面で見た「変わった人と口座」の値を添えて送る（見たあとにまた変わったらサーバーが断る）
    const key = /name="bankReviewKey" value="([0-9a-f]{24})"/.exec(againHtml)?.[1];
    expect(key).toBeTruthy();
    expect(key).toBe((await loadTransferReview(db, tenantId, DEMO_MONTH)).bankKeys.all);
    expect(again).toContain("に作った振込データ・あとで取り消したもの");
    expect(again).toContain("口座が変わった人を確かめました（1人）");
    await expect(createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staff.id)).rejects.toThrow("口座が変わった人が 1人");
    await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all", bankChangesConfirmed: true }, staff.id);
  });

  it("振り込んだ日を入れたデータは「期日内」と出す", async () => {
    const db = state.db!;
    const [batch] = await db.select().from(s.transferBatches).where(eq(s.transferBatches.tenantId, tenantId));
    await setTransferExecutedOn(db, tenantId, batch.id, "2026-11-25");
    as("staff");
    const t = text(await render("2026-10"));
    expect(t).toContain("期日内：約束した支払日（11/25(水)）までに振り込んだ記録です（7人）");
    // 確かめたあとなので、もう変わった人はいない
    expect(t).toContain("変わった人はいません");
  });

  it("閲覧の人には、口座の変更も確かめる欄も出さない", async () => {
    as("viewer");
    const t = text(await render("2026-10"));
    expect(t).not.toContain("作る前に確かめること");
    expect(t).not.toContain("0009-305");
    expect(t).not.toContain("上田 健（D03）");
  });
});
