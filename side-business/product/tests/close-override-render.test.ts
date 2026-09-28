import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 締めの画面：赤が残っているとき、事務には「締められない」、オーナーには「理由を書いて締める」を出す。
 * Server Action も、事務の理由つきの締めは断る（画面を信じない）。
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
    requireUser: async (need: keyof typeof RANK = "viewer") => {
      if (!state.user || RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    AuthError,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

async function render(): Promise<string> {
  const { default: ClosePage } = await import("~/app/(app)/close/page");
  const el = (await ClosePage({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
}

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("締めの画面：オーナーの理由つきの締め・分数・操作の記録へのリンク", () => {
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
  });
  afterAll(async () => client.close());

  const as = (role: SessionUser["role"]) => (state.user = users.find((u) => u.role === role)!);

  it("事務：赤が残っている間は締められず、オーナーに相談するよう案内する", async () => {
    as("staff");
    const t = await render();
    expect(t).toContain("まだ締められません");
    expect(t).toContain("オーナーが理由を書いて締めることもできます");
    expect(t).not.toContain("赤い指摘が残ったまま2026年10月を締める");
    expect(t).toContain("2026年10月の操作の記録をすべて見る");
    expect(t).not.toContain("全データの書き出し（オーナー）");
  });

  it("オーナー：赤が残っていても、理由を書いて締めるボタンを出す", async () => {
    as("owner");
    const t = await render();
    expect(t).not.toContain("まだ締められません");
    expect(t).toMatch(/見張り番の赤い指摘が \d+ 件残っています/);
    expect(t).toContain("赤い指摘が残ったまま2026年10月を締める…");
    expect(t).toContain("全データの書き出し（オーナー）");
  });

  it("Server Action：事務の理由つきの締めは断る。短い理由・おかしな分数も断る", async () => {
    const { closeMonthAction } = await import("~/app/(app)/close/actions");
    as("staff");
    let res = await closeMonthAction(undefined, form({ month: DEMO_MONTH, overrideReason: "急いで締めたいので先に締めます", minutesSpent: "" }));
    expect(res).toMatchObject({ ok: false, error: "赤い指摘が残ったまま締められるのはオーナーだけです" });
    res = await closeMonthAction(undefined, form({ month: DEMO_MONTH, overrideReason: "", minutesSpent: "" }));
    expect(res?.ok).toBe(false);
    expect(res && !res.ok && res.error).toContain("見張り番の赤い指摘");
    as("owner");
    res = await closeMonthAction(undefined, form({ month: DEMO_MONTH, overrideReason: "短い理由", minutesSpent: "" }));
    expect(res).toMatchObject({ ok: false, error: "理由を 10 文字以上で書いてください（操作の記録に残ります）" });
    res = await closeMonthAction(undefined, form({ month: DEMO_MONTH, overrideReason: "取引条件の書面は来週渡すため先に締める", minutesSpent: "1時間" }));
    expect(res?.ok).toBe(false);
    expect(res && !res.ok && res.fieldErrors?.minutesSpent).toContain("分の数");
    const [mc] = await state.db!.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(mc).toBeUndefined();
  });

  it("オーナーが理由と分数（全角）を書いて締めると、締めた画面に理由と分数を出す", async () => {
    const { closeMonthAction } = await import("~/app/(app)/close/actions");
    as("owner");
    const res = await closeMonthAction(undefined, form({ month: DEMO_MONTH, overrideReason: "取引条件の書面は来週渡すため先に締める", minutesSpent: "９０" }));
    expect(res).toMatchObject({ ok: true, data: { drivers: 8, total: 2206094 } });
    as("staff");
    const t = await render();
    expect(t).toContain("2026年10月は締めました");
    expect(t).toContain("締めにかかった時間 90分");
    expect(t).toContain("見張り番の赤い指摘が残ったまま締めました");
    expect(t).toContain("デモ 社長さん　理由：取引条件の書面は来週渡すため先に締める");
    expect(t).toContain("赤い指摘が残ったまま締めた（理由：取引条件の書面は来週渡すため先に締める）");
  });
});
