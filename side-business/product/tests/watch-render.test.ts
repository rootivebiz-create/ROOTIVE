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
  class AuthError extends Error {}
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    // 本物と同じく、役割が足りなければ止める（Server Action が役割を確かめているかを見る）
    requireUser: async (need: keyof typeof RANK = "viewer") => {
      if (!state.user) throw new AuthError("ログインしてください");
      if (RANK[state.user.role] < RANK[need]) throw new AuthError("この操作をする権限がありません");
      return state.user;
    },
    AuthError,
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

  const driverIdOf = async (code: string) =>
    (await state.db!.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code))))[0].id;

  it("事務：赤 2 件と、確認済みにする欄・直す画面・出典・根拠が出る", async () => {
    as("staff");
    const d04 = await driverIdOf("D04");
    const html = await render("2026-10");
    expect(html).toContain("締めを止める指摘が 2 件あります");
    expect(html).toContain("取引条件を明示した記録がありません");
    expect(html).toContain("遠藤 大輔");
    expect(html).toContain("書面で合意した記録が無い控除があります");
    expect(html).toContain("根拠：フリーランス法 第3条（取引条件の明示）");
    expect(html).toContain(`href="${SOURCES.flQa}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    // 直す画面は、その人・その控除を開いた状態
    expect(html).toContain(`href="/terms/${d04}"`);
    expect(html).toContain("直す（ドライバーの設定）");
    expect(html).toContain("直す（控除のルール）");
    expect(html).toContain("直す（人ごとの単価）");
    // 会社の設定を変えられるのはオーナーだけなので、事務には「見る」
    expect(html).toContain("見る（会社の設定）");
    expect(html).not.toContain("直す（会社の設定）");
    expect(html).toContain("会社の設定を変えられるのはオーナーです");
    expect(html).toContain('name="note"');
    expect(html).toContain("何を確かめたか（10 文字以上）");
    expect(html).toContain("何を確かめたか（4 文字以上）");
    expect(html).toContain("見張り番が確かめていること");
    expect(html).toContain('href="/close?m=2026-10"');
    expect(html).toContain(FOOTER);
    // 判定の言葉を出さない
    expect(html).not.toMatch(/(?<!取)適法|違反です|違反はありません|問題ありません/);
    // どのカードにも影響額（円か「—」）と、ルールの時点が出る。赤は影響額の大きい順（遠藤さん 294,800 円 → 制服代 5,000 円）
    expect(html).toContain("影響額");
    expect(html).toContain("¥294,800");
    expect(html).toContain("（遠藤 大輔さんの2026年10月分の支払額）");
    expect(html).toContain("¥5,000");
    expect(html).toContain("（2026年9月時点の情報）");
    expect(html).toContain("金額で出す指摘ではありません");
    expect(html).toContain("同じ重さの中は、影響額の大きい順です。");
    expect(html.indexOf("¥294,800")).toBeLessThan(html.indexOf("制服代（木村 誠）"));
    // 見張り番が確かめていることの一覧にも、時点と当てる月が出る
    expect(html).toContain("2024年11月1日以降の月で確かめます");
    expect(html).toContain("同じお金が複数の指摘に数えられることがあるので、足し合わせないでください");
  });

  it("閲覧の人：確認済みにする欄は出さず、直す画面は「見る」だけ", async () => {
    as("viewer");
    const d04 = await driverIdOf("D04");
    const html = await render("2026-10");
    expect(html).toContain("締めを止める指摘が 2 件あります");
    expect(html).not.toContain('name="note"');
    expect(html).not.toContain("確認済みを外す");
    expect(html).toContain("確認済みにするのは、事務・オーナーの方です");
    // どの画面も見るだけなら開ける。「直す」とは書かない
    expect(html).toContain(`href="/terms/${d04}"`);
    expect(html).toContain("見る（ドライバーの設定）");
    expect(html).toContain("見る（稼働と調整）");
    expect(html).toContain("直すのは事務・オーナーの方です");
    expect(html).not.toContain("直す（");
    expect(html).not.toContain('href="/close?m=2026-10"');
    expect(html).toContain(FOOTER);
  });

  it("オーナー：会社の設定も「直す」", async () => {
    as("owner");
    const html = await render("2026-10");
    expect(html).toContain("直す（会社の設定）");
    expect(html).not.toContain("会社の設定を変えられるのはオーナーです");
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
    // 確認済みの指摘は消さずに、灰色の 1 行にたたむ（開くと中身とメモ）
    expect(html).toContain("赤・取引条件を明示した記録がありません（遠藤 大輔）");
    expect(html).toContain("お知らせ・支払期日の文言が入っていません（取引条件の支払期日の文言）");
    expect(html.match(/<details class="group rounded-card border border-border bg-muted"/g)).toHaveLength(2);
  });

  it("前の月に確認済みにした指摘は、翌月の欄に下書きとして入る", async () => {
    as("staff");
    const html = await render("2026-11");
    expect(html).toContain("2026年10月にも同じ指摘を確認済みにしています");
    expect(html).toContain("契約書の支払期日は翌月25日</textarea>");
    expect(html).toContain("前の月のメモを下書きに入れています");
    // 前の月に確認済みにしたお知らせは、翌月は灰色の 1 行にたたむ（開くと中身と、前の月のメモを下書きにした欄）
    expect(html).toContain("2026年10月に確認済み");
    expect(html).toContain("お知らせ・支払期日の文言が入っていません（取引条件の支払期日の文言）");
    expect(html).toContain("この月の分も、中身が同じか確かめて確認済みにしてください。");
    expect(html).toContain("灰色の 1 行にたたんでいます");
  });

  it("前の月に確認済みにした赤は、翌月もたたまない（締めを止めるので、カードのまま出す）", async () => {
    const staff = users.find((u) => u.role === "staff")!;
    const [uniform] = await state.db!.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "制服代")));
    // 11 月も木村さんが稼働して制服代を引く
    const d07 = await driverIdOf("D07");
    const [takuhai] = await state.db!.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
    const [w] = await state.db!.insert(s.workEntries).values({ tenantId, month: "2026-11-01", driverId: d07, projectId: takuhai.id, qty: 300 }).returning();
    await ackWatchIssue(state.db!, tenantId, { month: DEMO_MONTH, code: "deduction_no_agreement", subjectId: uniform.id, note: "制服代の購入の合意書を確認した" }, staff.id);
    try {
      as("staff");
      const html = await render("2026-11");
      expect(html).toContain("2026年10月にも同じ指摘を確認済みにしています：「制服代の購入の合意書を確認した」");
      // 灰色の 1 行にたたんだのは、前の月に確認済みにしたお知らせ（支払期日の文言）だけ
      expect(html.match(/2026年10月に確認済み<\/span>/g)).toHaveLength(1);
      expect(html).toContain("書面で合意した記録が無い控除があります");
      expect(html).toContain("締めを止める指摘が");
    } finally {
      await state.db!.delete(s.watchAcks).where(and(eq(s.watchAcks.tenantId, tenantId), eq(s.watchAcks.subjectId, uniform.id)));
      await state.db!.delete(s.workEntries).where(eq(s.workEntries.id, w.id));
    }
  });

  it("稼働の無い月：取り込みへの案内を出す", async () => {
    as("staff");
    const html = await render("2026-12");
    expect(html).toContain("2026年12月の稼働がまだありません");
    expect(html).toContain('href="/import?m=2026-12"');
  });

  it("締めた 9 月：見るだけ（確認済みの欄も外すボタンも出さない）。「締めを止める」とは書かない", async () => {
    as("owner");
    // 9 月分の支払期日（10/25）より前の日
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T03:00:00Z"));
    try {
      const html = await render("2026-09");
      expect(html).toContain("2026年9月は締め済みです");
      expect(html).toContain("取引条件を明示した記録がありません");
      expect(html).toContain("まだ確認していない赤い指摘が 2 件あります");
      expect(html).not.toContain("締めを止める指摘が");
      expect(html).not.toContain('name="note"');
      expect(html).not.toContain("確認済みを外す");
      expect(html).not.toContain('href="/close?m=2026-09"');
      // 締めた月の稼働は直せないので「見る」
      expect(html).not.toContain("直す（稼働と調整）");
      expect(html).toContain(FOOTER);
    } finally {
      vi.useRealTimers();
    }
  });

  it("締めた 9 月でも、支払期日を過ぎて振り込んだ日の記録が無い指摘だけは、確認済みにする欄が出る", async () => {
    as("staff");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T03:00:00Z"));
    try {
      const html = await render("2026-09");
      expect(html).toContain("支払期日を過ぎましたが、振り込んだ日の記録がありません");
      expect(html).toContain("直す（振込データ）");
      // 欄は 1 つだけ（振込の遅れの分）
      expect(html.match(/name="note"/g)).toHaveLength(1);
      expect(html).toContain('name="code" value="paid_late"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("確認済みにする操作：閲覧の人は断られる。事務はその会社の指摘だけに付けられる", async () => {
    const { ackWatchAction, unackWatchAction } = await import("~/app/(app)/watch/actions");
    const [uniform] = await state.db!.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "制服代")));
    const form = (note: string, subjectId = uniform.id) => {
      const f = new FormData();
      f.set("month", DEMO_MONTH);
      f.set("code", "deduction_no_agreement");
      f.set("subjectId", subjectId);
      f.set("note", note);
      return f;
    };
    const acksOf = async () => state.db!.select().from(s.watchAcks).where(and(eq(s.watchAcks.tenantId, tenantId), eq(s.watchAcks.code, "deduction_no_agreement")));

    as("viewer");
    expect(await ackWatchAction(undefined, form("制服代の合意書を確認しました"))).toEqual({ ok: false, error: "この操作をする権限がありません" });
    expect(await acksOf()).toHaveLength(0);

    as("staff");
    // 赤は 10 文字以上
    const short = await ackWatchAction(undefined, form("確認した"));
    expect(short).toMatchObject({ ok: false });
    expect(short && !short.ok && short.error).toContain("10 文字以上");
    // 他社の控除の id を送っても、この会社には出ていない指摘なので断る
    const other = await seedDemo(state.db!);
    const [otherUniform] = await state.db!.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, other.tenantId), eq(s.deductionRules.name, "制服代")));
    const cross = await ackWatchAction(undefined, form("他社の控除を確認済みにしてみる", otherUniform.id));
    expect(cross && !cross.ok && cross.error).toContain("いまは出ていません");
    expect(await state.db!.select().from(s.watchAcks).where(eq(s.watchAcks.tenantId, other.tenantId))).toHaveLength(0);

    const ok = await ackWatchAction(undefined, form("制服代の購入の合意書（2026年7月1日）を確認した"));
    expect(ok).toMatchObject({ ok: true });
    const rows = await acksOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectId: uniform.id, month: DEMO_MONTH, ackedBy: state.user!.id });

    // 確認済みにしたあとで制服代の額が変わる → カードと件数のところで「確かめ直して」
    await state.db!.update(s.deductionRules).set({ amount: 6000 }).where(eq(s.deductionRules.id, uniform.id));
    const changedHtml = await render("2026-10");
    expect(changedHtml).toContain("確認済みにしたあとで中身（数字・日付・人）が変わった赤い指摘が 1 件あります");
    expect(changedHtml).toContain("確認済みにしたあとで、この指摘の中身（数字・日付・人）が変わりました");
    expect(changedHtml).toContain("確かめ直してメモを書き直す");
    expect(changedHtml).toContain("いまのメモを下書きに入れています");
    await state.db!.update(s.deductionRules).set({ amount: 5000 }).where(eq(s.deductionRules.id, uniform.id));

    as("viewer");
    const denied = new FormData();
    for (const [k, v] of [["month", DEMO_MONTH], ["code", "deduction_no_agreement"], ["subjectId", uniform.id]]) denied.set(k, v);
    expect(await unackWatchAction(undefined, denied)).toEqual({ ok: false, error: "この操作をする権限がありません" });
    as("staff");
    expect(await unackWatchAction(undefined, denied)).toMatchObject({ ok: true });
    expect(await acksOf()).toHaveLength(0);
  });
});
