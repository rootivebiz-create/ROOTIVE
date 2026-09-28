import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import iconv from "iconv-lite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 会計ソフトへの出力の画面・保存の Server Action・ダウンロードを、ログインと DB だけ差し替えて動かす。
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
      if (!state.user) throw new AuthError("ログインしてください");
      if (RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      // 本物と同じ：保存できないデモでは、閲覧より上の役割を求める処理を止める
      if (need !== "viewer" && process.env.DEMO_MODE === "1" && process.env.DEMO_READONLY === "1") throw new AuthError("デモでは保存できません");
      return state.user;
    },
    AuthError,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const NOTICE = "会計ソフトへの取り込みの前に、勘定科目と税区分を顧問の税理士さんと確かめてください。はじめての月は、数件だけで取り込みを試してください。";
const FORBIDDEN = [/適法/, /違反はありません/, /問題ありません/, /法令に完全対応/, /大丈夫/, /必ず合う/, /ミスゼロ/, /完全自動/, /補助金/, /完全対応/, /互換/];

let client: PGlite;
let tenantId: string;
let otherId: string;
/** 会社ごとの利用者の id（操作の記録の外部キーに使う） */
const userIds = new Map<string, string>();

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(t.db));
  ({ tenantId: otherId } = await seedDemo(t.db));
  for (const u of await t.db.select({ id: s.users.id, tenantId: s.users.tenantId }).from(s.users)) userIds.set(u.tenantId, u.id);
});
afterAll(async () => client.close());

function asUser(role: SessionUser["role"], tenant = tenantId): SessionUser {
  return { id: userIds.get(tenant)!, tenantId: tenant, email: `${role}@demo.example`, name: `デモ ${role}`, role };
}

async function renderPage(sp: Record<string, string>): Promise<string> {
  const { default: Page } = await import("~/app/(app)/export/page");
  const el = (await Page({ searchParams: Promise.resolve(sp) })) as ReactElement;
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("会計ソフトへの出力の画面", () => {
  it("注意書き・弥生会計（既定）・一致の確認・要確認の印・ダウンロードが出る", async () => {
    state.user = asUser("staff");
    const html = await renderPage({ m: "2026-10" });
    expect(html).toContain(NOTICE);
    expect(html).toContain("/api/export/yayoi?m=2026-10");
    expect(html).toContain("/api/export/payments?m=2026-10");
    expect(html).toContain("明細の振込額の合計と一致");
    expect(html).toContain("要確認（既定の値）");
    expect(html).toContain("課対仕入込10%区分70%");
    expect(html).toContain("まだ締めていません");
    expect(html).toContain("青木 翔太 2026年10月分 委託料");
    // 登録の無い方は税額の欄を空けることを知らせる
    expect(html).toContain("インボイスの登録が無い方（上田 健さん・遠藤 大輔さん・木村 誠さん）");
    for (const re of FORBIDDEN) expect(html).not.toMatch(re);
  });

  it("freee を選ぶと、弥生会計の形式で出すと書く", async () => {
    state.user = asUser("staff");
    const html = await renderPage({ m: "2026-10", soft: "freee" });
    expect(html).toContain("弥生会計のインポート形式と同じファイルを出します");
    expect(html).toContain("/api/export/freee?m=2026-10");
    const mf = await renderPage({ m: "2026-10", soft: "mf" });
    expect(mf).toContain("「インボイス」の欄");
    const generic = await renderPage({ m: "2026-10", soft: "generic" });
    expect(generic).toContain("仮払消費税等");
  });

  it("締めの期間が経過措置の境目をまたぐ月（20日締めの 10 月）は、仕訳の税区分が期間の末日の割合だと書く", async () => {
    state.user = asUser("staff", otherId);
    const note = "仕訳の税区分は締めの期間の末日の割合です（会社の控え・利益の画面は日ごとに分けた目安）。";
    expect(await renderPage({ m: "2026-10" })).not.toContain(note);
    await state.db!.update(s.tenants).set({ closingDay: 20 }).where(eq(s.tenants.id, otherId));
    try {
      const html = await renderPage({ m: "2026-10" });
      expect(html).toContain(note);
      // 境目をまたがない月（20日締めの 11 月 ＝ 10/21〜11/20）には出さない
      expect(await renderPage({ m: "2026-11" })).not.toContain(note);
    } finally {
      await state.db!.update(s.tenants).set({ closingDay: 0 }).where(eq(s.tenants.id, otherId));
    }
  });

  it("明細の無い月は、取り込みへの案内", async () => {
    state.user = asUser("staff");
    const html = await renderPage({ m: "2026-05" });
    expect(html).toContain("2026年5月の明細がまだありません");
    expect(html).not.toContain("/api/export/yayoi?m=2026-05");
  });
});

describe("対応の保存（Server Action）", () => {
  it("閲覧の人は保存できない。事務は保存でき、会社の区切りを守る", async () => {
    const { saveAccountingAction } = await import("~/app/(app)/export/actions");
    const form = new FormData();
    form.set("software", "yayoi");
    form.set("account.outsourcing", "外注工賃");
    form.set("tax.purchase", "課対仕入込10%");
    form.set("payableSub", "on");

    state.user = asUser("viewer");
    const denied = await saveAccountingAction(undefined, form);
    expect(denied).toMatchObject({ ok: false, error: "この操作をする権限がありません" });

    state.user = asUser("staff");
    const ok = await saveAccountingAction(undefined, form);
    expect(ok).toMatchObject({ ok: true });
    const [mine] = await state.db!.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(mine.settings.accounting).toMatchObject({ software: "yayoi", accounts: { outsourcing: "外注工賃", payableSub: "driver" }, taxLabels: { "yayoi.purchase": "課対仕入込10%" } });
    expect(mine.settings.requester?.code).toBe("1234567890");
    const [theirs] = await state.db!.select().from(s.tenants).where(eq(s.tenants.id, otherId));
    expect(theirs.settings.accounting).toBeUndefined();
    const logs = await state.db!.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "accounting.settings")));
    expect(logs).toHaveLength(1);

    const html = await renderPage({ m: "2026-10" });
    expect(html).toContain("外注工賃");
    expect(html).toContain("保存済み");

    const bad = new FormData();
    bad.set("software", "excel");
    expect(await saveAccountingAction(undefined, bad)).toMatchObject({ ok: false });
  });
});

describe("ダウンロード（GET /api/export/[kind]）", () => {
  const call = async (kind: string, m = "2026-10") => {
    const { GET } = await import("~/app/api/export/[kind]/route");
    return GET(new Request(`http://localhost/api/export/${kind}?m=${m}`), { params: Promise.resolve({ kind }) });
  };

  it("閲覧の人は出せない（403）", async () => {
    state.user = asUser("viewer");
    expect((await call("yayoi")).status).toBe(403);
    expect((await call("payments")).status).toBe(403);
  });

  it("事務は出せ、持ち出しの記録が残る。知らない種類は 404、明細の無い月は 404", async () => {
    state.user = asUser("staff");
    const res = await call("yayoi");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("Shift_JIS");
    const text = iconv.decode(Buffer.from(await res.arrayBuffer()), "cp932");
    expect(text.split("\r\n")[0].split(",")).toHaveLength(25);
    expect(text).toContain("外注工賃");
    const payments = await call("payments");
    expect(payments.status).toBe(200);
    expect(payments.headers.get("Content-Disposition")).toContain(encodeURIComponent("支払一覧_2026年10月.csv"));
    const logs = await state.db!.select().from(s.auditLog).where(eq(s.auditLog.tenantId, tenantId));
    expect(logs.filter((l) => l.action === "export.accounting")).toHaveLength(1);
    expect(logs.filter((l) => l.action === "export.payments_csv")).toHaveLength(1);
    expect(logs.find((l) => l.action === "export.accounting")!.detail).toMatchObject({ kind: "yayoi", slips: 8 });
    expect((await call("excel")).status).toBe(404);
    expect((await call("mf", "2026-05")).status).toBe(404);
  });

  it("保存できないデモでも、出力は読むだけなので出せる（対応の保存は止まる）", async () => {
    state.user = asUser("owner");
    process.env.DEMO_MODE = "1";
    process.env.DEMO_READONLY = "1";
    try {
      expect((await call("yayoi")).status).toBe(200);
      expect((await call("payments")).status).toBe(200);
      const { saveAccountingAction } = await import("~/app/(app)/export/actions");
      const form = new FormData();
      form.set("software", "yayoi");
      form.set("account.outsourcing", "デモの科目");
      expect(await saveAccountingAction(undefined, form)).toMatchObject({ ok: false, error: "デモでは保存できません" });
      state.user = asUser("viewer");
      expect((await call("yayoi")).status).toBe(403);
    } finally {
      delete process.env.DEMO_MODE;
      delete process.env.DEMO_READONLY;
    }
  });

  it("ほかの会社の人は、ほかの会社の数字だけを出す", async () => {
    state.user = asUser("staff", otherId);
    const res = await call("yayoi");
    const text = iconv.decode(Buffer.from(await res.arrayBuffer()), "cp932");
    expect(text).not.toContain("外注工賃");
    expect(text).toContain("外注費");
  });
});
