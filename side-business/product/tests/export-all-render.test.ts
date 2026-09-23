import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { strFromU8, unzipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 全データの画面・書き出し（GET /api/data/export）・読み戻しの Server Action（オーナーだけ） */
const state: { db?: Db; user?: SessionUser; invites: { tenantId: string; email: string; name: string; role: string }[] } = { invites: [] };
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
    createInvite: async (tenantId: string, email: string, name: string, role: string) => {
      state.invites.push({ tenantId, email, name, role });
      return `token-${state.invites.length}`;
    },
    AuthError,
  };
});
vi.mock("~/server/features/statements/request", () => ({ requestOrigin: async () => "https://example.test" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");

function form(values: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("全データの画面・書き出し・読み戻し", () => {
  let source: { db: Db; client: PGlite };
  let target: { db: Db; client: PGlite };
  let tenantId: string;
  let users: SessionUser[];
  let zip: Uint8Array;

  beforeAll(async () => {
    source = await createTestDb();
    target = await createTestDb();
    state.db = source.db;
    ({ tenantId } = await seedDemo(source.db));
    await generateStatements(source.db, tenantId, DEMO_MONTH);
    const rows = await source.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    users = rows.map((u) => ({ id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role as SessionUser["role"] }));
  });
  afterAll(async () => {
    await source.client.close();
    await target.client.close();
  });

  const as = (role: SessionUser["role"], list = users) => (state.user = list.find((u) => u.role === role)!);

  it("画面：件数と中身の説明・書き出しのボタン・読み戻しの欄", async () => {
    as("owner");
    const { default: DataPage } = await import("~/app/(app)/data/page");
    const html = renderToString((await DataPage()) as ReactElement);
    const t = text(html);
    expect(t).toContain("全データの書き出し");
    expect(t).toContain("8人");
    expect(t).toContain("2か月");
    expect(t).toContain("2026年9月〜2026年10月");
    expect(t).toContain("明細の版8件");
    expect(t).toContain("まだ書き出したことはありません。");
    expect(html).toContain('href="/api/data/export"');
    expect(t).toContain("別の場所へ移す（読み戻し）");
    expect(t).toContain("中身を確かめる（まだ読み込みません）");
    expect(t).toContain("保存期間を過ぎたデータを自動で消しません");
  });

  it("書き出し：オーナーだけ。ZIP を返し、書き出したことを記録に残す", async () => {
    const { GET } = await import("~/app/api/data/export/route");
    as("staff");
    expect((await GET()).status).toBe(403);
    as("owner");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("しめ日ラボ_全データ_"));
    zip = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(zip);
    expect(Object.keys(files)).toContain("manifest.json");
    expect(JSON.parse(strFromU8(files["manifest.json"])).tenantId).toBe(tenantId);
    const [log] = await source.db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "data.export")));
    expect(log.userId).toBe(users.find((u) => u.role === "owner")!.id);
    expect(log.detail).toMatchObject({ versions: 8 });
    // 画面に「前に書き出した日時」が出る
    const { default: DataPage } = await import("~/app/(app)/data/page");
    expect(text(renderToString((await DataPage()) as ReactElement))).toContain("前に書き出した日時：");
  });

  it("読み戻し：事務は使えない。確かめる → 印が無ければ読み込まない → 読み込んでオーナーの招待を作る", async () => {
    const { restoreAction } = await import("~/app/(app)/data/actions");
    // 移した先：最初の設定で作った仮の会社のオーナーとして読み込む
    state.db = target.db;
    const { tenantId: hostTenant } = await seedDemo(target.db);
    const hostUsers = (await target.db.select().from(s.users).where(eq(s.users.tenantId, hostTenant))).map((u) => ({
      id: u.id,
      tenantId: u.tenantId,
      email: u.email,
      name: u.name,
      role: u.role as SessionUser["role"],
    }));
    const file = new File([zip.slice().buffer as ArrayBuffer], "export.zip", { type: "application/zip" });

    as("staff", hostUsers);
    expect(await restoreAction(undefined, form({ file, mode: "check" }))).toMatchObject({ ok: false, error: "この操作をする権限がありません" });

    as("owner", hostUsers);
    const checked = await restoreAction(undefined, form({ file, mode: "check" }));
    expect(checked?.ok).toBe(true);
    expect(checked?.ok && checked.data?.summary).toMatchObject({ tenantId, versions: 8 });
    expect(await target.db.select().from(s.tenants).where(eq(s.tenants.id, tenantId))).toHaveLength(0);

    expect(await restoreAction(undefined, form({ file, mode: "apply" }))).toMatchObject({ ok: false, error: "「この内容で読み込みます」に印を付けてください" });
    const wrongType = new File([new Uint8Array([1, 2, 3])], "export.txt");
    expect(await restoreAction(undefined, form({ file: wrongType, mode: "check" }))).toMatchObject({ ok: false, error: "ZIP のファイル（.zip）を選んでください" });

    const done = await restoreAction(undefined, form({ file, mode: "apply", confirm: "on" }));
    expect(done?.ok).toBe(true);
    const data = done?.ok ? done.data! : null;
    expect(data?.invites).toEqual([{ name: "デモ 社長", email: "owner@demo.example", url: "https://example.test/invite/token-1" }]);
    expect(state.invites).toEqual([{ tenantId, email: "owner@demo.example", name: "デモ 社長", role: "owner" }]);
    expect(await target.db.select().from(s.statementVersions).where(eq(s.statementVersions.tenantId, tenantId))).toHaveLength(8);
    // 読み込んだ人の会社にも「読み込んだ」記録が残る（読み込んだ会社の中身は、読み込んだ人の会社に混ざらない）
    const [log] = await target.db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, hostTenant), eq(s.auditLog.action, "data.import")));
    expect(log.detail).toMatchObject({ restoredTenantId: tenantId, versions: 8 });
    expect(await target.db.select().from(s.drivers).where(eq(s.drivers.tenantId, hostTenant))).toHaveLength(8);
    // 2 回目は読み込まない
    const again = await restoreAction(undefined, form({ file, mode: "check" }));
    expect(again?.ok).toBe(false);
    expect(again && !again.ok && again.error).toContain("すでにこの場所にあります");
  });
});
