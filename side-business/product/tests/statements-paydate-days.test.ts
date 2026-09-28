import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildStatementDrafts, lineDays, type BuildInput } from "~/server/calc/statement";
import { askFromPortal, loadPortal } from "~/server/features/portal";
import { getStatementDetail, replyShareFor, replyToDriver, sendListFor, staffLinkToken, statementPdfSource } from "~/server/features/statements";
import { dayChanges, describeChanges } from "~/server/features/statements/diff";
import {
  dayKey,
  isLineKeyOf,
  lineKeyLabel,
  payDateShiftNote,
  replyShareMessage,
  scheduledPayDate,
  sendListText,
  toDriverView,
  type DriverStatementView,
} from "~/server/features/statements/view";
import { TERMS_SOURCES } from "~/server/features/terms/document";
import { SOURCES } from "~/server/features/watch/sources";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, readSnapshot, snapshotHash } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/**
 * 支払明細の「振込予定日」（銀行の休みの日なら前の営業日）と「日ごとの数量」（日付つきの稼働があれば折りたたみ）。
 * 写しには明細に書いた支払日（締めの設定から決まる日）をそのまま残し、60 日・支払の遅れの確かめはその日で行う。
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
      return state.user;
    },
    currentUser: async () => null,
    clientIpHash: async () => "ip-paydate-days",
    AuthError,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "shimebi.example", "x-forwarded-proto": "https", "user-agent": "Mozilla/5.0 (iPhone)" }),
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
const ctx = { ipHash: "ip-days", userAgent: IPHONE };

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, month = DEMO_MONTH) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, month), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
}

function html(el: ReactElement): string {
  return renderToString(el).replace(/<!-- -->/g, "");
}

async function portalHtml(token: string): Promise<string> {
  const { default: Page } = await import("~/app/s/[token]/page");
  return html((await Page({ params: Promise.resolve({ token }) })) as ReactElement);
}

async function detailHtml(id: string): Promise<string> {
  const { default: Page } = await import("~/app/(app)/statements/[id]/page");
  return html((await Page({ params: Promise.resolve({ id }) })) as ReactElement);
}

/** PDF の配置から、描いた文字をすべて集める */
function collectText(node: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as { lines?: { string?: string }[]; children?: unknown[] };
    for (const l of o.lines ?? []) if (typeof l.string === "string") out.push(l.string);
    for (const c of o.children ?? []) walk(c);
  };
  walk(node);
  return out.join("\n");
}

async function pdfText(statementId: string): Promise<string> {
  const source = (await statementPdfSource(db, tenantId, statementId))!;
  let layout: unknown;
  await renderStatementsPdf([source], new Date("2026-11-01T09:00:00+09:00"), { onLayout: (l) => (layout = l) });
  return collectText(layout);
}

/** 上田さん（D03）の 10 月の宅配を、日付つきで入れ直す（10/1 に 2 行・10/2・日付なし） */
async function datedSetup() {
  const { driver } = await statementOf("D03");
  const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
  await db.delete(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, DEMO_MONTH), eq(s.workEntries.driverId, driver.id)));
  await db.insert(s.workEntries).values([
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 60, workDate: "2026-10-02" },
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 50, workDate: "2026-10-01" },
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 30, workDate: "2026-10-01" },
    { tenantId, month: DEMO_MONTH, driverId: driver.id, projectId: takuhai.id, qty: 10 },
  ]);
  await generateStatements(db, tenantId, DEMO_MONTH);
  return { driver, takuhai };
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  state.db = db;
  const [u] = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId)).limit(1);
  state.user = { id: u.id, tenantId, email: u.email, name: u.name, role: "staff" };
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("振込予定日（銀行の休みの日なら前の営業日）", () => {
  it("純関数：土日・祝日・年末年始は前の営業日。平日はそのまま。一言は何の休みか", () => {
    expect(scheduledPayDate("2026-10-31")).toBe("2026-10-30"); // 土 → 金
    expect(payDateShiftNote("2026-10-31")).toBe("10月31日が土曜日のため");
    expect(scheduledPayDate("2027-01-31")).toBe("2027-01-29"); // 日 → 金
    expect(payDateShiftNote("2027-01-31")).toBe("1月31日が日曜日のため");
    expect(scheduledPayDate("2027-09-20")).toBe("2027-09-17"); // 敬老の日（月）→ 金
    expect(payDateShiftNote("2027-09-20")).toBe("9月20日が敬老の日のため");
    expect(scheduledPayDate("2026-11-23")).toBe("2026-11-20"); // 勤労感謝の日（月）→ 金
    expect(scheduledPayDate("2026-12-31")).toBe("2026-12-30"); // 年末
    expect(payDateShiftNote("2026-12-31")).toBe("12月31日が年末年始の銀行の休みのため");
    expect(scheduledPayDate("2026-11-25")).toBe("2026-11-25");
    expect(payDateShiftNote("2026-11-25")).toBeNull();
    expect(scheduledPayDate("")).toBe("");
  });

  it("既定の設定（末締め・翌月末払い）の 9 月分：写しは 10/31（土）のまま、画面・ドライバーの画面・PDF は 10/30（金）と理由", async () => {
    await db.update(s.tenants).set({ closingDay: 0, payMonthOffset: 1, payDay: 0 }).where(eq(s.tenants.id, tenantId));
    await db.update(s.monthCloses).set({ status: "open" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
    await generateStatements(db, tenantId, DEMO_PREV_MONTH);
    const { st } = await statementOf("D01", DEMO_PREV_MONTH);
    // 写し（60 日・支払の遅れの確かめに使う日）は、締めの設定から決まる日のまま
    expect(readSnapshot(st).payDate).toBe("2026-10-31");
    const view = toDriverView(readSnapshot(st), st);
    expect(view).toMatchObject({ payDate: "2026-10-30", payDueDate: "2026-10-31", payDateNote: "10月31日が土曜日のため" });

    const note = "（10月31日が土曜日のため、前の営業日）";
    const detail = await detailHtml(st.id);
    expect(detail).toContain("2026年10月30日（金）");
    expect(detail).toContain(note);
    expect(detail).not.toContain("2026年10月31日（土）");
    const portal = await portalHtml(staffLinkToken(st).token);
    expect(portal).toContain("2026年10月30日（金）");
    expect(portal).toContain(note);
    const text = await pdfText(st.id);
    expect(text).toContain("2026年10月30日（金）");
    expect(text).toContain("10月31日が土曜日のため、前の営業日");
  });

  it("平日の支払日（デモの 10 月分 11/25）には一言を出さない", async () => {
    const { st } = await statementOf("D01");
    const h = await detailHtml(st.id);
    expect(h).toContain("2026年11月25日（水）");
    expect(h).not.toContain("前の営業日）");
  });
});

describe("日ごとの数量", () => {
  it("計算：同じ日は足し、日付の古い順。日付の無い分は最後にまとめる。日付つきが無ければ付けない", () => {
    expect(lineDays([{ qty: 3, date: null }])).toBeUndefined();
    expect(
      lineDays([
        { qty: 60, date: "2026-10-02" },
        { qty: 50, date: "2026-10-01" },
        { qty: 0.1, date: "2026-10-01" },
        { qty: 0.2, date: "2026-10-01" },
        { qty: 10, date: null },
      ]),
    ).toEqual([
      { date: "2026-10-01", qty: 50.3 },
      { date: "2026-10-02", qty: 60 },
      { date: null, qty: 10 },
    ]);
  });

  it("日付の無い稼働だけの明細は、写しに days を持たない（前に作った明細のハッシュが変わらない）", async () => {
    const { st } = await statementOf("D01");
    const snap = readSnapshot(st);
    expect(snap.lines.every((l) => !("days" in l))).toBe(true);
    expect(snapshotHash(snap)).toBe(st.hash);
    // 作り直しても版は上がらない
    const r = await generateStatements(db, tenantId, DEMO_MONTH);
    expect(r.updated).toBe(0);
  });

  it("日付つきの稼働：会社の画面・ドライバーの画面は折りたたみ、PDF は表。数量の合計は行と同じ", async () => {
    await datedSetup();
    const { st } = await statementOf("D03");
    const line = readSnapshot(st).lines.find((l) => l.project === "宅配（個建て）")!;
    expect(line.qty).toBe(150);
    expect(line.days).toEqual([
      { date: "2026-10-01", qty: 80 },
      { date: "2026-10-02", qty: 60 },
      { date: null, qty: 10 },
    ]);
    const view = toDriverView(readSnapshot(st), st);
    expect(view.lines[0].days).toEqual([
      { key: dayKey(line.projectId, "2026-10-01"), date: "2026-10-01", qty: 80 },
      { key: dayKey(line.projectId, "2026-10-02"), date: "2026-10-02", qty: 60 },
      { key: null, date: null, qty: 10 },
    ]);
    // 会社の画面（ドライバーに見えているそのまま）
    const detail = await detailHtml(st.id);
    expect(detail).toContain("日ごとの数量（2日・日付なしの分あり）");
    expect(detail).toContain("10月1日（木）");
    expect(detail).toContain("日付なし");
    // ドライバーの画面：日ごとに質問できる
    const token = staffLinkToken(st).token;
    const portal = await portalHtml(token);
    expect(portal).toMatch(/<details[^>]*><summary[^>]*>日ごとの数量（2日・日付なしの分あり）<\/summary>/);
    expect(portal).toContain("10月2日（金）");
    expect(portal).toContain("この日について質問する");
    expect(portal).toContain('aria-label="宅配（個建て） 10月1日（木）について質問する"');
    // PDF
    const text = await pdfText(st.id);
    expect(text).toContain("日ごとの数量");
    expect(text).toContain("10/1(木) 80");
    expect(text).toContain("日付なし 10");
  });

  it("ある日について質問できる（行の目印は「案件@日付」）。明細に無い日は断る", async () => {
    const { takuhai } = await datedSetup();
    const { st } = await statementOf("D03");
    const token = staffLinkToken(st).token;
    const key = dayKey(takuhai.id, "2026-10-02");
    await askFromPortal(db, token, { lineKey: key, body: "10/2 は 65 個だと思います" }, ctx);
    await expect(askFromPortal(db, token, { lineKey: dayKey(takuhai.id, "2026-10-09"), body: "x" }, ctx)).rejects.toThrow("新しくなっています");
    const data = (await loadPortal(db, token))!;
    expect(data.threads.map((t) => [t.lineKey, t.label])).toEqual([[key, "宅配（個建て） 10月2日（金）"]]);
    expect(isLineKeyOf(data.view, key)).toBe(true);
    expect(lineKeyLabel(data.view, key)).toBe("宅配（個建て） 10月2日（金）");
    // 会社の側でも、その日の話として返事ができる
    await replyToDriver(db, tenantId, st.id, null, { lineKey: key, body: "確認して直します" });
    const detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.threads[0]).toMatchObject({ lineKey: key, label: "宅配（個建て） 10月2日（金）" });
  });

  it("版の違い：日ごとの数量だけが動いたとき・内訳を初めて載せたとき", () => {
    const base = { key: "p", project: "宅配", client: null, unit: "個", qty: 140, rate: 150, amount: 21_000 };
    const view = (lines: DriverStatementView["lines"]) => ({ lines, deductions: [], adjustments: [], tax: 0, total: 0, payDate: "x", driver: {}, title: "t" }) as unknown as DriverStatementView;
    const before = view([{ ...base, days: [{ key: "p@2026-10-01", date: "2026-10-01", qty: 80 }, { key: "p@2026-10-02", date: "2026-10-02", qty: 60 }] }]);
    const moved = view([{ ...base, days: [{ key: "p@2026-10-01", date: "2026-10-01", qty: 75 }, { key: "p@2026-10-02", date: "2026-10-02", qty: 65 }] }]);
    expect(describeChanges(before, moved)).toEqual(["宅配：日ごと：10月1日（木） 80 → 75個、10月2日（金） 60 → 65個（数量の合計・金額は同じです）"]);
    expect(describeChanges(view([{ ...base }]), before)).toEqual(["宅配：日ごとの数量の内訳を載せました（数量・金額は同じです）"]);
    const more = view([{ ...base, qty: 145, amount: 21_750, days: [...moved.lines[0].days!, { key: "p@2026-10-03", date: "2026-10-03", qty: 5 }] }]);
    expect(describeChanges(moved, more)[0]).toBe("宅配：数量 140 → 145個、金額 21,000円 → 21,750円、日ごと：10月3日（土） 0 → 5個");
    expect(dayChanges([], [], "個")).toBeNull();
  });

  it("計算の結果は、日付の有無で金額が変わらない（日ごとに丸めない）", () => {
    const input: BuildInput = {
      month: DEMO_MONTH,
      tenant: { name: "テスト", registrationNo: null, taxMethod: "general", payTaxToExempt: true, taxRounding: "floor", amountRounding: "round", closingDay: 0, payMonthOffset: 1, payDay: 25 },
      drivers: [{ id: "d", name: "A", invoiceRegistered: true, registrationNo: "T1", isCorporation: false, withholdingCategory: "none", active: true }],
      projects: [{ id: "p", name: "宅配", clientName: null, unit: "個", billRate: 200, payRate: 152.5 }],
      overrides: [],
      rules: [],
      work: [
        { driverId: "d", projectId: "p", qty: 3, workDate: "2026-10-01" },
        { driverId: "d", projectId: "p", qty: 3, workDate: "2026-10-02" },
      ],
      adjustments: [],
    };
    const dated = buildStatementDrafts(input)[0];
    const undated = buildStatementDrafts({ ...input, work: input.work.map((w) => ({ ...w, workDate: null })) })[0];
    expect(dated.lines[0].amount).toBe(undated.lines[0].amount);
    expect(dated.total).toBe(undated.total);
    expect(undated.lines[0].days).toBeUndefined();
  });
});

describe("返事を知らせる・送る一覧", () => {
  it("返事のあとに知らせる文面とリンク（明細のリンクと同じ。電話番号があれば SMS の宛先に入る）", async () => {
    const { st, driver } = await statementOf("D01");
    await db.update(s.drivers).set({ phone: "090-1111-2222" }).where(eq(s.drivers.id, driver.id));
    const share = (await replyShareFor(db, tenantId, st.id, "https://shimebi.example"))!;
    expect(share.url).toBe(`https://shimebi.example/s/${staffLinkToken(st).token}`);
    expect(share.message).toBe(replyShareMessage("青木 翔太", DEMO_MONTH, share.url));
    expect(share.message).toContain("会社から返事を書きました");
    expect(share.links.line.startsWith("https://line.me/R/msg/text/?")).toBe(true);
    expect(share.links.sms.startsWith("sms:09011112222?")).toBe(true);
    expect(share.hasPhone).toBe(true);
    // 他社の id では作らない
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    expect(await replyShareFor(db, b.tenantId, st.id, "https://x")).toBeNull();
  });

  it("返事の Server Action：自動では届かないと書き、知らせるための文面を返す", async () => {
    const { replyAction } = await import("~/app/(app)/statements/actions");
    const { st } = await statementOf("D02");
    const form = new FormData();
    form.set("id", st.id);
    form.set("body", "確認しました。直して送り直します。");
    const r = await replyAction(undefined, form);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toBe("返事を書きました。ドライバーには自動では届きません。下のボタンから LINE などで「返事を書きました」と知らせてください");
    expect(r.data?.url).toContain("/s/");
    expect(r.data?.message).toContain("井上 美咲さん");
  });

  it("送る一覧：渡した id のうち、この会社・この月の明細だけ。名前とリンクを 1 行ずつ", async () => {
    const aoki = (await statementOf("D01")).st;
    const inoue = (await statementOf("D02")).st;
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const [other] = await db.select().from(s.statements).where(eq(s.statements.tenantId, b.tenantId)).limit(1);
    const list = await sendListFor(db, tenantId, DEMO_MONTH, [inoue.id, other.id, "not-a-uuid", aoki.id], "https://shimebi.example");
    expect(list.map((i) => i.name)).toEqual(["井上 美咲", "青木 翔太"]);
    expect(list[1].url).toBe(`https://shimebi.example/s/${staffLinkToken(aoki).token}`);
    expect(sendListText(DEMO_MONTH, list).split("\n")).toEqual([
      "2026年10月分の支払明細（2人）",
      `井上 美咲（D02）\t${list[0].url}`,
      `青木 翔太（D01）\t${list[1].url}`,
    ]);
  });

  it("送った記録をまとめてつける（事務だけ。前に送った日時は変えない）", async () => {
    const { markManySentAction } = await import("~/app/(app)/statements/actions");
    const aoki = (await statementOf("D01")).st;
    const inoue = (await statementOf("D02")).st;
    state.user = { ...state.user!, role: "viewer" };
    expect((await markManySentAction([aoki.id])).ok).toBe(false);
    state.user = { ...state.user!, role: "staff" };
    const r = await markManySentAction([aoki.id, inoue.id, aoki.id]);
    expect(r).toMatchObject({ ok: true, data: { count: 2 } });
    const first = (await statementOf("D01")).st.sentAt!;
    expect(first).not.toBeNull();
    await markManySentAction([aoki.id]);
    expect((await statementOf("D01")).st.sentAt!.getTime()).toBe(first.getTime());
  });

  it("一覧の画面：事務には送る一覧のコピー。見るだけの人には出さない", async () => {
    const { default: Page } = await import("~/app/(app)/statements/page");
    const render = async () => html((await Page({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement);
    const staff = await render();
    expect(staff).toContain("送る一覧をコピー（名前とリンク・8人）");
    expect(staff).toContain("グループのトークには貼らず");
    // スマホの合計の内訳：調整も出す（足し引きがそのまま合計になる）
    expect(staff).toContain('aria-label="合計の内訳"');
    expect(staff).toContain('<span>− 調整 <span class="num whitespace-nowrap">¥7,700</span></span>');
    expect(staff).toContain('<span>＝ 合計 <span class="num whitespace-nowrap">¥2,206,094</span></span>');
    expect(staff).not.toContain("源泉徴収 <span"); // 0 円なら出さない（パソコンの表の見出しは別）
    state.user = { ...state.user!, role: "viewer" };
    expect(await render()).not.toContain("送る一覧をコピー");
  });
});

describe("締めた月の言い方", () => {
  it("ボタンと同じ「締めを外す」（「締めを解除」と言わない）", async () => {
    await db.update(s.monthCloses).set({ status: "closed" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    const count = await db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    if (count.length === 0) await db.insert(s.monthCloses).values({ tenantId, month: DEMO_MONTH, status: "closed" });
    const { default: Page } = await import("~/app/(app)/statements/page");
    const h = html((await Page({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement);
    expect(h).toContain("オーナーが「締め」の画面で締めを外します");
    expect(h).not.toContain("締めを解除");
  });
});

describe("次に送る人へ（スマホでは送るボタンのすぐ下にも）", () => {
  it("明細：送るの欄の中にも「次に送る人へ」", async () => {
    const aoki = (await statementOf("D01")).st;
    const h = await detailHtml(aoki.id);
    const inoue = (await statementOf("D02")).st;
    // 送るの欄（LinkPanel）と、ページの下の両方
    expect(h.split(`href="/statements/${inoue.id}"`).length - 1).toBeGreaterThanOrEqual(2);
    expect(h).toContain("次に送る人へ（井上 美咲）→");
  });

  it("取引条件：1 人の画面にも「次に送る人へ」（明示書が無い・未送付・条件が変わった人を順に）", async () => {
    const { driver: aoki } = await statementOf("D01");
    const { driver: inoue } = await statementOf("D02");
    const { default: Page } = await import("~/app/(app)/terms/[driverId]/page");
    const h = html((await Page({ params: Promise.resolve({ driverId: aoki.id }) })) as ReactElement);
    expect(h).toContain(`href="/terms/${inoue.id}"`);
    expect(h).toContain("次に送る人へ（井上 美咲・未作成）→");
    // 見るだけの人には出さない
    state.user = { ...state.user!, role: "viewer" };
    const v = html((await Page({ params: Promise.resolve({ driverId: aoki.id }) })) as ReactElement);
    expect(v).not.toContain("次に送る人へ");
  });
});

describe("出典の URL", () => {
  it("問86（仕入明細書の相手方の確認）は qa/86.pdf。経過措置の Q&A（113-3）を問86 として出さない", async () => {
    expect(SOURCES.purchaseStatementQa).toBe("https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/86.pdf");
    expect(TERMS_SOURCES.ntaQa).toBe(SOURCES.purchaseStatementQa);
    const { default: Page } = await import("~/app/(app)/statements/page");
    const list = html((await Page({ searchParams: Promise.resolve({ m: "2026-10" }) })) as ReactElement);
    expect(list).toContain(`<a href="${SOURCES.purchaseStatementQa}" target="_blank" rel="noopener noreferrer">国税庁 インボイス Q&amp;A 問86</a>`);
    expect(list).not.toContain("113-3");
  });
});
