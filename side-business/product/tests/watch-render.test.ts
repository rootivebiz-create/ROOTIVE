import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { ackWatchIssue } from "~/server/features/watch/acks";
import { SOURCES } from "~/server/features/watch/sources";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 見張り番の画面を HTML にしてみる（ログインと DB だけ差し替える）。
 * 役割・締めた月で、出してよいもの・隠すものが正しいかを文字で確かめる。
 */
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

const FOOTER = "見張り番は、記録から分かることをお知らせするものです。法令に合っているかの判断は、弁護士・税理士などにご確認ください。";

async function render(m: string): Promise<string> {
  const { default: WatchPage } = await import("~/app/(app)/watch/page");
  const el = (await WatchPage({ searchParams: Promise.resolve({ m }) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("見張り番の画面", () => {
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

  it("事務：赤 2 件と、確認済みにする欄・直す画面・出典・根拠が出る", async () => {
    as("staff");
    const html = await render("2026-10");
    expect(html).toContain("締めを止める指摘が 2 件あります");
    expect(html).toContain("取引条件を明示した記録がありません");
    expect(html).toContain("遠藤 大輔");
    expect(html).toContain("書面で合意した記録が無い控除があります");
    expect(html).toContain("根拠：フリーランス法 第3条（取引条件の明示）");
    expect(html).toContain(`href="${SOURCES.flQa}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/settings/drivers"');
    expect(html).toContain("直す（ドライバーの設定）");
    expect(html).toContain("直す（控除のルール）");
    expect(html).toContain('name="note"');
    expect(html).toContain("何を確かめたか（10 文字以上）");
    expect(html).toContain("何を確かめたか（4 文字以上）");
    expect(html).toContain("見張り番が確かめていること");
    expect(html).toContain('href="/close?m=2026-10"');
    expect(html).toContain(FOOTER);
    // 判定の言葉を出さない
    expect(html).not.toMatch(/(?<!取)適法|違反です|違反はありません|問題ありません/);
  });

  it("閲覧の人：確認済みにする欄は出さず、設定の画面へのリンクも出さない", async () => {
    as("viewer");
    const html = await render("2026-10");
    expect(html).toContain("締めを止める指摘が 2 件あります");
    expect(html).not.toContain('name="note"');
    expect(html).not.toContain("確認済みを外す");
    expect(html).toContain("確認済みにするのは、事務・オーナーの方です");
    expect(html).not.toContain('href="/settings/drivers"');
    expect(html).toContain("直すのは事務・オーナーの方です");
    // 稼働の画面は開ける
    expect(html).toContain('href="/work?m=2026-10"');
    expect(html).toContain("直す（稼働と調整）");
    expect(html).not.toContain("直す（ドライバーの設定）");
    expect(html).toContain(FOOTER);
  });

  it("確認済みにすると、メモ・誰が付けたか・「確認済みを外す」が出て、締めを止める赤が減る", async () => {
    const staff = users.find((u) => u.role === "staff")!;
    const [d04] = await state.db!.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D04")));
    await ackWatchIssue(state.db!, tenantId, { month: DEMO_MONTH, code: "terms_missing", subjectId: d04.id, note: "業務委託契約書（2026年5月1日）を確認した" }, staff.id);
    await ackWatchIssue(state.db!, tenantId, { month: DEMO_MONTH, code: "payment_wording", subjectId: "tenant", note: "契約書の支払期日は翌月25日" }, staff.id);
    as("staff");
    const html = await render("2026-10");
    expect(html).toContain("締めを止める指摘が 1 件あります");
    expect(html).toContain("確認済み 1");
    expect(html).toContain("業務委託契約書（2026年5月1日）を確認した");
    expect(html).toContain("デモ 事務さん");
    expect(html).toContain("確認済みを外す");
  });

  it("前の月に確認済みにした指摘は、翌月の欄に下書きとして入る", async () => {
    as("staff");
    const html = await render("2026-11");
    expect(html).toContain("2026年10月にも同じ指摘を確認済みにしています");
    expect(html).toContain("契約書の支払期日は翌月25日</textarea>");
    expect(html).toContain("前の月のメモを下書きに入れています");
  });

  it("稼働の無い月：取り込みへの案内を出す", async () => {
    as("staff");
    const html = await render("2026-12");
    expect(html).toContain("2026年12月の稼働がまだありません");
    expect(html).toContain('href="/import?m=2026-12"');
  });

  it("締めた 9 月：見るだけ（確認済みの欄も外すボタンも出さない）", async () => {
    as("owner");
    const html = await render("2026-09");
    expect(html).toContain("2026年9月は締め済みです");
    expect(html).toContain("取引条件を明示した記録がありません");
    expect(html).not.toContain('name="note"');
    expect(html).not.toContain("確認済みを外す");
    expect(html).not.toContain('href="/close?m=2026-09"');
    expect(html).toContain(FOOTER);
  });
});
