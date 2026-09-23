import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 設定の画面を HTML にしてみる（ログインと DB だけ差し替える）。
 * 役割ごとに、出してよいもの・隠すもの（閲覧の人に編集の部品を出さない・口座番号を伏せる）を文字で確かめる。
 */
const state: { db?: Db; user?: SessionUser } = {};

Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  const roleAtLeast = (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need];
  return {
    roleAtLeast,
    requirePageUser: async (need: keyof typeof RANK = "viewer") => {
      if (!roleAtLeast(state.user!.role, need)) throw new Error("FORBIDDEN");
      return state.user;
    },
    requireUser: async () => state.user,
    currentUser: async () => state.user,
    createInvite: async () => "token",
    clientIpHash: async () => null,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type AnyPage = (props: { searchParams: Promise<Record<string, string>>; params: Promise<Record<string, string>> }) => Promise<ReactElement>;

async function render(page: AnyPage, sp: Record<string, string> = {}, params: Record<string, string> = {}): Promise<string> {
  const el = await page({ searchParams: Promise.resolve(sp), params: Promise.resolve(params) });
  return renderToString(el).replace(/<!-- -->/g, "");
}

/** 製品が言ってはいけない言葉（判定・保証） */
const FORBIDDEN = ["適法です", "違反はありません", "問題ありません", "法令に完全対応", "監査は大丈夫", "必ず合う", "ミスゼロ", "完全自動", "補助金が使えます"];

describe("設定の画面", () => {
  let client: PGlite;
  let tenantId: string;
  let users: Record<SessionUser["role"], SessionUser>;
  const pages: Record<string, () => Promise<{ default: AnyPage }>> = {
    home: () => import("~/app/(app)/settings/page") as unknown as Promise<{ default: AnyPage }>,
    company: () => import("~/app/(app)/settings/company/page") as unknown as Promise<{ default: AnyPage }>,
    drivers: () => import("~/app/(app)/settings/drivers/page") as unknown as Promise<{ default: AnyPage }>,
    driver: () => import("~/app/(app)/settings/drivers/[id]/page") as unknown as Promise<{ default: AnyPage }>,
    newDriver: () => import("~/app/(app)/settings/drivers/new/page") as unknown as Promise<{ default: AnyPage }>,
    clients: () => import("~/app/(app)/settings/clients/page") as unknown as Promise<{ default: AnyPage }>,
    projects: () => import("~/app/(app)/settings/projects/page") as unknown as Promise<{ default: AnyPage }>,
    rates: () => import("~/app/(app)/settings/rates/page") as unknown as Promise<{ default: AnyPage }>,
    rules: () => import("~/app/(app)/settings/rules/page") as unknown as Promise<{ default: AnyPage }>,
    users: () => import("~/app/(app)/settings/users/page") as unknown as Promise<{ default: AnyPage }>,
    ai: () => import("~/app/(app)/settings/ai/page") as unknown as Promise<{ default: AnyPage }>,
  };
  const html = async (name: keyof typeof pages, role: SessionUser["role"], sp: Record<string, string> = {}, params: Record<string, string> = {}) => {
    state.user = users[role];
    const { default: Page } = await pages[name]();
    return render(Page, sp, params);
  };

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    const rows = await t.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    const as = (role: SessionUser["role"]) => {
      const u = rows.find((r) => r.role === role) ?? rows[0];
      return { id: u.id, tenantId, email: u.email, name: u.name, role };
    };
    users = { owner: as("owner"), staff: as("staff"), viewer: as("viewer") };
  });
  afterAll(async () => client.close());

  const aoki = async () => {
    const [d] = await state.db!.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    return d;
  };

  it("はじめ：項目ごとの状態（口座なし 1人・合意の記録なし 1件）。利用者はオーナーだけに出す", async () => {
    const staff = await html("home", "staff");
    expect(staff).toContain("口座なし 1人");
    expect(staff).toContain("取引条件の明示なし 1人");
    expect(staff).toContain("合意の記録なし 1件");
    expect(staff).toContain("毎月末日締め・翌月25日払い");
    expect(staff).not.toContain("/settings/users");
    expect(await html("home", "owner")).toContain("/settings/users");
  });

  it("ドライバー一覧：事務には追加とまとめて登録。閲覧の人には出さず、口座番号を伏せる", async () => {
    const staff = await html("drivers", "staff");
    expect(staff).toContain("/settings/drivers/new");
    expect(staff).toContain("/onboarding/drivers");
    expect(staff).toContain("木村 誠");
    expect(staff).toContain("口座：未登録（振込データに入りません）");
    expect(staff).toContain("1234567");
    const viewer = await html("drivers", "viewer");
    expect(viewer).not.toContain("/settings/drivers/new");
    expect(viewer).not.toContain("/onboarding/drivers");
    expect(viewer).toContain("****567");
    expect(viewer).not.toContain("1234567");
    const filtered = await html("drivers", "staff", { flag: "no_bank" });
    expect(filtered).toContain("木村 誠");
    expect(filtered).not.toContain("青木 翔太");
  });

  it("ドライバー 1 人：事務は入力欄、閲覧の人は読むだけ。記録がある人には「消す」を出さない", async () => {
    const d = await aoki();
    const staff = await html("driver", "staff", {}, { id: d.id });
    expect(staff).toContain('name="holderKana"');
    expect(staff).toContain("無効にする");
    expect(staff).toContain("消せません");
    expect(staff).toContain("稼働 4件");
    expect(staff).toContain("ロイヤリティ（委託料 × 10%）");
    const viewer = await html("driver", "viewer", {}, { id: d.id });
    expect(viewer).not.toContain('name="holderKana"');
    expect(viewer).not.toContain("無効にする");
    expect(viewer).toContain("****567");
    // 別の会社の id・形の違う id は「見つからない」
    await expect(html("driver", "staff", {}, { id: "not-a-uuid" })).rejects.toThrow();
  });

  it("ドライバーの追加は事務から（閲覧の人は開けない）", async () => {
    const staff = await html("newDriver", "staff");
    expect(staff).toContain("登録する");
    expect(staff).toContain("https://www.invoice-kohyo.nta.go.jp/");
    await expect(html("newDriver", "viewer")).rejects.toThrow("FORBIDDEN");
  });

  it("会社：オーナーは保存でき、事務は読むだけ。60 日の目安と出典を出す", async () => {
    const owner = await html("company", "owner", { m: "2026-10" });
    expect(owner).toContain("会社の設定を保存");
    expect(owner).toContain("毎月末日締め・翌月25日払い");
    expect(owner).toContain("2026年11月25日");
    expect(owner).toContain("60日");
    expect(owner).toContain("https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf");
    expect(owner).toContain("記載内容に誤りがある場合は、受け取りから7日以内にご連絡ください。");
    const staff = await html("company", "staff", { m: "2026-10" });
    expect(staff).not.toContain("会社の設定を保存");
    expect(staff).toContain("オーナーだけが変えられます");
  });

  it("元請・案件：粗利を出す。閲覧の人には直す部品を出さない", async () => {
    const clients = await html("clients", "staff");
    expect(clients).toContain("A物流（架空）");
    expect(clients).toContain("元請を追加");
    expect(clients).toContain("案件か支払通知で使われているので消せません");
    expect(await html("clients", "viewer")).not.toContain("元請を追加");

    const projects = await html("projects", "staff");
    expect(projects).toContain("40円（21.1%）");
    expect(projects).toContain("案件を追加");
    expect(projects).toContain("人ごとの単価 1件");
    const viewer = await html("projects", "viewer");
    expect(viewer).toContain("40円（21.1%）");
    expect(viewer).not.toContain("案件を追加");
    expect(viewer).not.toContain("直す・使わない・消す");
  });

  it("人ごとの単価：標準との差と、合意した日の抜け", async () => {
    const staff = await html("rates", "staff");
    expect(staff).toContain("岡田 拓也");
    expect(staff).toContain("+5円");
    expect(staff).toContain("合意した日なし");
    expect(staff).toContain("人ごとの単価を登録");
    expect(await html("rates", "viewer")).not.toContain("人ごとの単価を登録");
  });

  it("控除：10 月の当たり方（ロイヤリティ 8人・241,060円）と、合意の記録が無い控除", async () => {
    const staff = await html("rules", "staff", { m: "2026-10" });
    expect(staff).toContain("8人・合計 241,060円");
    expect(staff).toContain("1人・合計 32,000円");
    expect(staff).toContain("合意の記録が無い控除が 1件 あります");
    expect(staff).toContain("ロイヤリティ 10%");
    expect(staff).toContain("車両リース 定額（稼働が無くても）");
    const viewer = await html("rules", "viewer", { m: "2026-10" });
    expect(viewer).not.toContain("控除を追加");
    expect(viewer).toContain("8人・合計 241,060円");
  });

  it("利用者はオーナーだけ。ただ 1 人のオーナーは外せない", async () => {
    const owner = await html("users", "owner");
    expect(owner).toContain("ただ 1 人のオーナー");
    expect(owner).toContain("招待のリンクを作る");
    expect(owner).toContain("デモ 事務");
    await expect(html("users", "staff")).rejects.toThrow("FORBIDDEN");
  });

  it("AI の同意：既定は使わない。送るもの・送らないものを書く。オーナーだけが変えられる", async () => {
    const owner = await html("ai", "owner");
    expect(owner).toContain("AI を使わない（既定）");
    expect(owner).toContain("列の見出し");
    expect(owner).toContain("送りません");
    expect(owner).toContain("同意して、AI を使えるようにする");
    const staff = await html("ai", "staff");
    expect(staff).not.toContain("同意して、AI を使えるようにする");
    expect(staff).toContain("オーナーだけが変えられます");
  });

  it("どの画面にも、判定・保証の言葉を出さない", async () => {
    const d = await aoki();
    const all = [
      await html("home", "owner"),
      await html("company", "owner", { m: "2026-10" }),
      await html("drivers", "owner"),
      await html("driver", "owner", {}, { id: d.id }),
      await html("newDriver", "owner"),
      await html("clients", "owner"),
      await html("projects", "owner"),
      await html("rates", "owner"),
      await html("rules", "owner", { m: "2026-10" }),
      await html("users", "owner"),
      await html("ai", "owner"),
    ].join("\n");
    for (const word of FORBIDDEN) expect(all).not.toContain(word);
  });
});
