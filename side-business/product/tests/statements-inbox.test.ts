import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { unresolvedQuestionCount as homeCount } from "~/server/features/home";
import { askFromPortal } from "~/server/features/portal";
import { replyToDriver, resolveThread, staffLinkToken } from "~/server/features/statements";
import { ageText, excerpt, loadQuestionInbox, parseInboxFilter, unresolvedQuestionCount, unresolvedQuestions } from "~/server/features/statements/inbox";
import { toDriverView } from "~/server/features/statements/view";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, readSnapshot } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 質問の一覧：すべての月の、解決していないドライバーの質問を、明細 × 行ごとに新しい順で並べる。
 * 数はホームと同じ関数で数える。他社の質問は混ざらない。画面は見るだけの人には返事の欄を出さない。
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
    requireUser: async () => state.user,
    currentUser: async () => null,
    clientIpHash: async () => "ip-inbox-test",
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

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 基準の時刻（質問の日時をここから決める） */
const T0 = new Date("2026-11-02T09:00:00+09:00");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
const NOW = at(24 * 3 + 5); // 最後の質問から 3 日と少しあと

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, tid = tenantId, month = DEMO_MONTH) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, month), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

async function ask(code: string, lineKey: string | null, body: string, when: Date, opts: { tid?: string; month?: string } = {}) {
  const { st } = await statementOf(code, opts.tid ?? tenantId, opts.month ?? DEMO_MONTH);
  await askFromPortal(db, staffLinkToken(st).token, { lineKey, body }, { ipHash: `ip-${code}-${when.getTime()}`, userAgent: IPHONE, now: when });
  return st;
}

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

async function staffOf(role: SessionUser["role"], tid = tenantId): Promise<SessionUser> {
  const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tid)).limit(1);
  return { id: u.id, tenantId: tid, email: u.email, name: u.name, role };
}

/**
 * 質問を入れる：9 月（締め済み）の青木さんに全体の質問 1 件、10 月の青木さんに宅配の行 2 件・調整 1 件、10 月の上田さんに全体 1 件。
 * 宅配の行には事務が返事をする（解決にはしていない）。
 */
async function seedQuestions() {
  await db.update(s.monthCloses).set({ status: "open" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
  await generateStatements(db, tenantId, DEMO_PREV_MONTH);
  await db.update(s.monthCloses).set({ status: "closed" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));

  const aokiSep = await ask("D01", null, "9月の振込日を教えてください", at(0), { month: DEMO_PREV_MONTH });
  const { st: aoki } = await statementOf("D01");
  const view = toDriverView(readSnapshot(aoki), aoki);
  const takuhai = view.lines.find((l) => l.project === "宅配（個建て）")!.key;
  await ask("D01", takuhai, "個数は 2,350 個だと思います", at(10));
  await ask("D01", takuhai, "日ごとの表も\nお願いします。", at(30));
  await ask("D01", "adj:0", "駐車場代の内訳を教えてください", at(50));
  const ueda = await ask("D03", null, "車両修理の負担分は何の分ですか", at(72));
  await replyToDriver(db, tenantId, aoki.id, null, { lineKey: takuhai, body: "元請の記録を確認しています" }, at(31));
  return { aoki, aokiSep, ueda, takuhai };
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("質問の一覧（DB）", () => {
  it("すべての月の未解決の質問を、明細 × 行ごとに新しい順で。数はホームと同じ", async () => {
    const { aoki, aokiSep, ueda, takuhai } = await seedQuestions();
    const inbox = await loadQuestionInbox(db, tenantId, NOW);
    expect(inbox.items.map((i) => [i.driverName, i.monthLabel, i.lineLabel, i.open, i.replied, i.ageText])).toEqual([
      ["上田 健", "2026年10月", "明細全体", 1, false, "5時間前"],
      ["青木 翔太", "2026年10月", "駐車場代の立替", 1, false, "1日前"],
      ["青木 翔太", "2026年10月", "宅配（個建て）", 2, true, "1日前"],
      ["青木 翔太", "2026年9月", "明細全体", 1, false, "3日前"],
    ]);
    expect(inbox).toMatchObject({ total: 5, drivers: 2, unreplied: 3 });
    const tk = inbox.items.find((i) => i.lineKey === takuhai)!;
    // いちばん新しい質問の頭（改行は空白に）・いちばん古い質問から待たせている長さ・未読（返事をした話は読んだことになる）
    expect(tk).toMatchObject({ excerpt: "日ごとの表も お願いします。", waitingText: "2日前", unread: 0, statementId: aoki.id, driverCode: "D01" });
    expect(inbox.items.find((i) => i.lineKey === "adj:0")).toMatchObject({ unread: 1, replied: false });
    expect(tk.href).toBe(`/statements/${aoki.id}#thread-${takuhai}`);
    expect(inbox.items[0].href).toBe(`/statements/${ueda.id}#thread-all`);
    expect(inbox.items[3].statementId).toBe(aokiSep.id);
    // 数え方はホームと同じ（同じ関数を出している）
    expect(unresolvedQuestionCount).toBe(homeCount);
    expect(unresolvedQuestions).toBe(homeCount);
    expect(await unresolvedQuestionCount(db, tenantId)).toBe(inbox.total);

    // 解決すると一覧から消える。未解決に戻すと戻る
    await resolveThread(db, tenantId, ueda.id, null, null, true, NOW);
    let after = await loadQuestionInbox(db, tenantId, NOW);
    expect(after.items.map((i) => i.driverName)).not.toContain("上田 健");
    expect(after.total).toBe(4);
    expect(await unresolvedQuestionCount(db, tenantId)).toBe(4);
    await resolveThread(db, tenantId, ueda.id, null, null, false, NOW);
    after = await loadQuestionInbox(db, tenantId, NOW);
    expect(after.total).toBe(5);
  });

  it("締めた月の質問にも返事と解決ができ、一覧に反映される", async () => {
    const { aokiSep } = await seedQuestions();
    await replyToDriver(db, tenantId, aokiSep.id, null, { lineKey: null, body: "10月25日です" }, at(80));
    let inbox = await loadQuestionInbox(db, tenantId, NOW);
    expect(inbox.items.find((i) => i.statementId === aokiSep.id)).toMatchObject({ replied: true });
    await resolveThread(db, tenantId, aokiSep.id, null, null, true, NOW);
    inbox = await loadQuestionInbox(db, tenantId, NOW);
    expect(inbox.items.some((i) => i.statementId === aokiSep.id)).toBe(false);
  });

  it("他社の質問は混ざらない（数も一覧も）", async () => {
    await seedQuestions();
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    await ask("D01", null, "B 社への質問", at(1), { tid: b.tenantId });
    await ask("D05", null, "B 社への質問 2", at(2), { tid: b.tenantId });

    const a = await loadQuestionInbox(db, tenantId, NOW);
    expect(a.total).toBe(5);
    expect(a.items.every((i) => !i.excerpt.startsWith("B 社"))).toBe(true);
    const bInbox = await loadQuestionInbox(db, b.tenantId, NOW);
    expect(bInbox.items.map((i) => i.excerpt)).toEqual(["B 社への質問 2", "B 社への質問"]);
    expect(await unresolvedQuestionCount(db, b.tenantId)).toBe(2);
    const aIds = new Set((await db.select({ id: s.statements.id }).from(s.statements).where(eq(s.statements.tenantId, tenantId))).map((r) => r.id));
    expect(bInbox.items.every((i) => !aIds.has(i.statementId))).toBe(true);
    // 質問の無い会社は空
    const c = await seedDemo(db);
    expect(await loadQuestionInbox(db, c.tenantId, NOW)).toEqual({ items: [], total: 0, drivers: 0, unreplied: 0 });
  });
});

describe("純関数", () => {
  it("「3日前」の書き方", () => {
    expect(ageText(T0, new Date(T0.getTime() + 30_000))).toBe("たった今");
    expect(ageText(T0, new Date(T0.getTime() + 5 * 60_000))).toBe("5分前");
    expect(ageText(T0, at(3))).toBe("3時間前");
    expect(ageText(T0, at(23.9))).toBe("23時間前");
    expect(ageText(T0, new Date(T0.getTime() + 3 * DAY))).toBe("3日前");
  });

  it("本文の頭は 80 文字まで", () => {
    expect(excerpt("  改行\n\nのある\t本文 ")).toBe("改行 のある 本文");
    expect(excerpt("あ".repeat(81))).toBe(`${"あ".repeat(80)}…`);
    expect(parseInboxFilter("unreplied")).toBe("unreplied");
    expect(parseInboxFilter(["x"])).toBe("all");
  });
});

describe("画面 /statements/inbox", () => {
  async function page(sp: Record<string, string> = {}) {
    const { default: Page } = await import("~/app/(app)/statements/inbox/page");
    return html((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement);
  }

  it("事務：件数・行ごとの質問・返事の欄・解決のボタン・明細のやりとりへのリンク", async () => {
    const { aoki, takuhai } = await seedQuestions();
    state.user = await staffOf("staff");
    const h = await page();
    expect(h).toContain("解決していない質問 5件（2人）");
    expect(h).toContain("まだ返事していない 3か所");
    expect(h).toContain("宅配（個建て）について");
    expect(h).toContain("2026年9月分・明細全体について");
    expect(h).toContain("返事済み・解決待ち");
    expect(h).toContain("ここで返事を書く");
    expect(h).toContain("解決にする");
    expect(h).toContain(`/statements/${aoki.id}#thread-${takuhai}`);
    // まだ返事していないものだけ
    const unreplied = await page({ f: "unreplied" });
    expect(unreplied).not.toContain("返事済み・解決待ち");
    expect(unreplied).toContain("駐車場代の立替について");
  });

  it("見るだけの人：一覧は見られるが、返事・解決はできない", async () => {
    await seedQuestions();
    state.user = await staffOf("viewer");
    const h = await page();
    expect(h).toContain("解決していない質問 5件（2人）");
    expect(h).toContain("返事と「解決にする」は、事務・オーナーの方ができます");
    expect(h).not.toContain("ここで返事を書く");
    expect(h).not.toContain("解決にする</button>");
  });

  it("質問が無いときは、どうすれば届くかを案内する", async () => {
    state.user = await staffOf("staff");
    const h = await page();
    expect(h).toContain("解決していない質問はありません");
    expect(h).toContain("明細の行から質問すると、ここに届きます");
  });

  it("明細の一覧に件数つきのリンク・明細の画面のやりとりに飛び先の目印", async () => {
    const { aoki, takuhai } = await seedQuestions();
    state.user = await staffOf("viewer");
    const { default: List } = await import("~/app/(app)/statements/page");
    const list = html((await List({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement);
    expect(list).toContain('href="/statements/inbox"');
    expect(list).toContain("質問の一覧（未解決 5件）");
    const { default: Detail } = await import("~/app/(app)/statements/[id]/page");
    const detail = html((await Detail({ params: Promise.resolve({ id: aoki.id }) })) as ReactElement);
    expect(detail).toContain(`id="thread-${takuhai}"`);
    expect(detail).toContain('id="thread-adj:0"');
  });
});
