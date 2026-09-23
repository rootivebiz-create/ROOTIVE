import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  ANNUAL_CSV_HEADER,
  LINK_UNUSABLE,
  TOO_MANY,
  annualCsvForToken,
  askFromPortal,
  confirmFromPortal,
  findStatementByToken,
  isBotUserAgent,
  loadPortal,
  portalPdfSource,
  recordPortalView,
} from "~/server/features/portal";
import { getStatementDetail, listMonthStatements, recreateStatementLink, replyToDriver, resolveThread, staffLinkToken } from "~/server/features/statements";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { signStatementLink } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

const DAY = 86_400_000;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ctx = { ipHash: "ip-hash-0123456789", userAgent: IPHONE };
const pause = () => new Promise((r) => setTimeout(r, 5));

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

async function linkOf(code: string, tid = tenantId) {
  const { st, driver } = await statementOf(code, tid);
  return { st, driver, token: staffLinkToken(st).token };
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  await generateStatements(db, tenantId, DEMO_MONTH);
  resetRateLimit();
});

afterEach(async () => {
  await client.close();
});

describe("リンク → 開く → 確認", () => {
  it("開いた記録と、版・ハッシュ・振込額つきの確認が残る。2 回押しても 1 件", async () => {
    const { st, token } = await linkOf("D01");
    const data = (await loadPortal(db, token))!;
    expect(data.companyName).toBe("サンプル運送株式会社（架空）");
    expect(data.view.total).toBe(357_555);
    expect(data.view.driver.name).toBe("青木 翔太");
    expect(data.confirmed).toBeNull();
    expect(data.account?.last3).toBe("567");
    expect(data.closed).toBe(false);
    expect(JSON.stringify(data)).not.toContain("474900");

    // 下見（LINE など）・会社の人のログイン中は「開いた」にしない
    expect(await recordPortalView(db, token, { ...ctx, userAgent: "facebookexternalhit/1.1;line-poker/1.0" })).toEqual({ recorded: false });
    expect(await recordPortalView(db, token, { ...ctx, byStaff: true })).toEqual({ recorded: false });
    expect((await statementOf("D01")).st.viewedAt).toBeNull();
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: true });
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: false });
    const viewed = (await statementOf("D01")).st;
    expect(viewed.viewedAt).not.toBeNull();
    const views = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.view")));
    expect(views).toHaveLength(1);
    expect(views[0].detail).toMatchObject({ by: "driver", version: 1, device: "iPhone" });

    const r = await confirmFromPortal(db, token, { version: 1 }, ctx);
    expect(r).toMatchObject({ version: 1, already: false });
    const again = await confirmFromPortal(db, token, { version: 1 }, ctx);
    expect(again.already).toBe(true);
    const confs = await db.select().from(s.statementConfirmations).where(eq(s.statementConfirmations.statementId, st.id));
    expect(confs).toHaveLength(1);
    expect(confs[0]).toMatchObject({ tenantId, version: 1, hash: st.hash, totalAtConfirm: 357_555, ipHash: "ip-hash-0123456789", userAgent: IPHONE });
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.confirm")));
    expect(audits).toHaveLength(1);

    const after = (await loadPortal(db, token))!;
    expect(after.confirmed?.version).toBe(1);
    const list = await listMonthStatements(db, tenantId, DEMO_MONTH);
    expect(list.counts.confirmed).toBe(1);
    expect(list.items.find((i) => i.id === st.id)!.status.key).toBe("confirmed");
  });

  it("画面の版が古いまま押しても記録しない", async () => {
    const { token } = await linkOf("D01");
    await expect(confirmFromPortal(db, token, { version: 2 }, ctx)).rejects.toThrow("明細が新しくなっています");
    await expect(confirmFromPortal(db, token, { version: Number.NaN }, ctx)).rejects.toThrow("明細が新しくなっています");
    expect(await db.select().from(s.statementConfirmations)).toHaveLength(0);
  });

  it("確認のあとで調整を足して作り直すと「確認後に変更あり」→ もう一度確認すると確認済み", async () => {
    const { st, driver, token } = await linkOf("D01");
    await confirmFromPortal(db, token, { version: 1 }, ctx);
    await pause();
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "高速代の立替", amount: 1200, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);

    const item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status).toMatchObject({ key: "changed", label: "確認後に変更あり", lastConfirmedVersion: 1 });
    // 同じリンクのまま、新しい版が見える
    const data = (await loadPortal(db, token))!;
    expect(data.view.version).toBe(2);
    expect(data.view.total).toBe(358_755);
    expect(data.confirmed).toBeNull();
    expect(data.confirmedOlder?.version).toBe(1);
    await expect(confirmFromPortal(db, token, { version: 1 }, ctx)).rejects.toThrow("新しくなっています");
    await confirmFromPortal(db, token, { version: 2 }, ctx);
    const confs = await db.select().from(s.statementConfirmations).where(eq(s.statementConfirmations.statementId, st.id));
    expect(confs.map((c) => [c.version, c.totalAtConfirm])).toEqual([
      [1, 357_555],
      [2, 358_755],
    ]);
    const detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.status.key).toBe("confirmed");
    expect(detail.confirmations.map((c) => [c.version, c.current])).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it("会社の人のログイン中は、確認も質問も本人の操作として送れない", async () => {
    const { token } = await linkOf("D02");
    await expect(confirmFromPortal(db, token, { version: 1 }, { ...ctx, byStaff: true })).rejects.toThrow("ドライバーご本人");
    await expect(askFromPortal(db, token, { lineKey: null, body: "テスト" }, { ...ctx, byStaff: true })).rejects.toThrow("ドライバーご本人");
  });

  it("締めた月でも確認と質問はできる", async () => {
    const { token } = await linkOf("D02");
    await db.insert(s.monthCloses).values({ tenantId, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    expect((await loadPortal(db, token))!.closed).toBe(true);
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: true });
    await confirmFromPortal(db, token, { version: 1 }, ctx);
    await askFromPortal(db, token, { lineKey: null, body: "振込日を教えてください" }, ctx);
    expect(await db.select().from(s.statementConfirmations)).toHaveLength(1);
  });
});

describe("使えないリンク", () => {
  it("改ざん・nonce 違い・期限切れ・形の崩れ・よその id は通さない（理由は出さない）", async () => {
    const { st, token } = await linkOf("D01");
    const now = new Date();
    expect(await findStatementByToken(db, token, now)).not.toBeNull();

    const [p, mac] = token.split(".");
    // 途中の 1 文字を変える（最後の文字は余りのビットを含むので、変えても同じ値に戻ることがある）
    const flipped = mac.slice(0, 5) + (mac[5] === "A" ? "Q" : "A") + mac.slice(6);
    expect(await findStatementByToken(db, `${p}.${flipped}`)).toBeNull();
    // 正しく署名されていても nonce が違えば通さない
    expect(await findStatementByToken(db, signStatementLink(st.id, "0".repeat(32), Math.floor(now.getTime() / 1000) + 3600))).toBeNull();
    // 期限切れ（リンクは 120 日）
    expect(await loadPortal(db, token, new Date(now.getTime() + 122 * DAY))).toBeNull();
    expect(await loadPortal(db, token, new Date(now.getTime() + 119 * DAY))).not.toBeNull();
    // 形の崩れ・uuid でない id・無い id
    expect(await findStatementByToken(db, "garbage")).toBeNull();
    expect(await findStatementByToken(db, "")).toBeNull();
    expect(await findStatementByToken(db, "x".repeat(700))).toBeNull();
    expect(await findStatementByToken(db, signStatementLink("not-a-uuid", st.linkNonce, Math.floor(now.getTime() / 1000) + 3600))).toBeNull();
    expect(await findStatementByToken(db, signStatementLink("00000000-0000-4000-8000-000000000000", st.linkNonce, Math.floor(now.getTime() / 1000) + 3600))).toBeNull();

    await expect(confirmFromPortal(db, "garbage", { version: 1 }, ctx)).rejects.toThrow(LINK_UNUSABLE);
    await expect(askFromPortal(db, `${p}.${flipped}`, { lineKey: null, body: "x" }, ctx)).rejects.toThrow(LINK_UNUSABLE);
    expect(await recordPortalView(db, "garbage", ctx)).toEqual({ recorded: false });
    expect(await annualCsvForToken(db, "garbage", ctx)).toBeNull();
    expect(await portalPdfSource(db, "garbage", ctx)).toBeNull();
  });

  it("リンクを作り直すと、古いリンクでは開けない・確認できない", async () => {
    const { st, token } = await linkOf("D01");
    await recreateStatementLink(db, tenantId, st.id, null);
    expect(await loadPortal(db, token)).toBeNull();
    await expect(confirmFromPortal(db, token, { version: 1 }, ctx)).rejects.toThrow(LINK_UNUSABLE);
    const fresh = staffLinkToken((await statementOf("D01")).st).token;
    expect((await loadPortal(db, fresh))?.view.total).toBe(357_555);
  });

  it("下見の仕組みの見分け", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1;line-poker/1.0")).toBe(true);
    expect(isBotUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(IPHONE)).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 Line/14.0.0")).toBe(false);
  });
});

describe("質問", () => {
  it("行ごと（案件・控除・調整）と全体。事務の返事はドライバーに見え、開くと既読になる", async () => {
    const { st, token } = await linkOf("D01");
    const data = (await loadPortal(db, token))!;
    const takuhai = data.view.lines.find((l) => l.project === "宅配（個建て）")!.key;
    const royalty = data.view.deductions.find((d) => d.name === "ロイヤリティ")!.key;
    await askFromPortal(db, token, { lineKey: takuhai, body: "個数が違うと思います" }, ctx);
    await askFromPortal(db, token, { lineKey: royalty, body: "ロイヤリティの率を教えてください" }, ctx);
    await askFromPortal(db, token, { lineKey: "adj:0", body: "駐車場代の内訳は？" }, ctx);
    await askFromPortal(db, token, { lineKey: null, body: "全体について" }, ctx);
    await expect(askFromPortal(db, token, { lineKey: "someone-else", body: "x" }, ctx)).rejects.toThrow("新しくなっています");
    await expect(askFromPortal(db, token, { lineKey: null, body: "   " }, ctx)).rejects.toThrow("1〜1,000 文字");
    await expect(askFromPortal(db, token, { lineKey: null, body: "あ".repeat(1001) }, ctx)).rejects.toThrow("1〜1,000 文字");

    const rows = await db.select().from(s.statementMessages).where(eq(s.statementMessages.statementId, st.id));
    expect(rows.map((r) => [r.author, r.lineKey, r.tenantId])).toEqual([
      ["driver", takuhai, tenantId],
      ["driver", royalty, tenantId],
      ["driver", "adj:0", tenantId],
      ["driver", null, tenantId],
    ]);
    const detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.status).toMatchObject({ openQuestions: 4, unread: 4 });
    expect(detail.threads.map((t) => t.label).sort()).toEqual(["宅配（個建て）", "ロイヤリティ", "駐車場代の立替", "明細全体"].sort());

    await replyToDriver(db, tenantId, st.id, null, { lineKey: takuhai, body: "確認して明日お返事します" });
    await resolveThread(db, tenantId, st.id, null, royalty, true);
    let portal = (await loadPortal(db, token))!;
    expect(portal.unreadReplies).toBe(1);
    const th = portal.threads.find((t) => t.lineKey === takuhai)!;
    expect(th.messages.map((m) => [m.author, m.authorName])).toEqual([
      ["driver", null],
      ["staff", null],
    ]);
    expect(portal.threads.find((t) => t.lineKey === royalty)!.open).toBe(0);
    await recordPortalView(db, token, ctx);
    portal = (await loadPortal(db, token))!;
    expect(portal.unreadReplies).toBe(0);
    const staffDetail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(staffDetail.threads.find((t) => t.lineKey === takuhai)!.messages[1].read).toBe(true);
  });

  it("短い時間に送りすぎると止める", async () => {
    const { token } = await linkOf("D05");
    for (let i = 0; i < 10; i++) await askFromPortal(db, token, { lineKey: null, body: `質問 ${i}` }, ctx);
    await expect(askFromPortal(db, token, { lineKey: null, body: "11 回目" }, ctx)).rejects.toThrow(TOO_MANY);
    // 別の端末（IP）からなら送れる
    await askFromPortal(db, token, { lineKey: null, body: "別の端末" }, { ...ctx, ipHash: "other-ip" });
  });
});

describe("今年の支払の一覧（CSV）", () => {
  it("同じ会社・同じドライバーの、締めた月とこの明細だけ", async () => {
    // 9 月分を作ってから締め直す・11 月分（締めていない）も作る
    await db.update(s.monthCloses).set({ status: "open" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
    await generateStatements(db, tenantId, DEMO_PREV_MONTH);
    await db.update(s.monthCloses).set({ status: "closed" }).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_PREV_MONTH)));
    const { driver } = await statementOf("D01");
    const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
    await db.insert(s.workEntries).values({ tenantId, month: "2026-11-01", driverId: driver.id, projectId: takuhai.id, qty: 100 });
    await generateStatements(db, tenantId, "2026-11-01");
    // 別の会社にも同じ名前の人がいる
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);

    const { token } = await linkOf("D01");
    const csv = (await annualCsvForToken(db, token, ctx))!;
    expect(csv.fileName).toBe("支払の一覧_2026年_青木 翔太.csv");
    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]).toBe(ANNUAL_CSV_HEADER.join(","));
    expect(lines.slice(1)).toEqual([
      "2026年9月,358500,35850,55935,0,0,338415,2026-10-25",
      "2026年10月,374500,37450,57695,3300,0,357555,2026-11-25",
      "合計,733000,73300,113630,3300,0,695970,",
    ]);
    expect(csv.text).not.toContain("2026年11月");
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.annual_csv")));
    expect(log.detail).toMatchObject({ by: "driver", year: "2026", months: ["2026-09-01", "2026-10-01"] });
    // 画面の一覧も同じ
    const portal = (await loadPortal(db, token))!;
    expect(portal.year.rows.map((r) => [r.label, r.total, r.current])).toEqual([
      ["2026年9月", 338_415, false],
      ["2026年10月", 357_555, true],
    ]);

    // B 社の同じ名前の人のリンクからは、B 社の分だけ
    const bLink = await linkOf("D01", b.tenantId);
    const bCsv = (await annualCsvForToken(db, bLink.token, ctx))!;
    expect(bCsv.text.trim().split("\r\n").slice(1)).toEqual(["2026年10月,374500,37450,57695,3300,0,357555,2026-11-25", "合計,374500,37450,57695,3300,0,357555,"]);
  });

  it("ドライバーの PDF の元：その明細だけ、確認の記録つき", async () => {
    const { token } = await linkOf("D04");
    await confirmFromPortal(db, token, { version: 1 }, ctx);
    const found = (await portalPdfSource(db, token, ctx))!;
    expect(found.fileName).toBe("支払明細_2026年10月_遠藤 大輔_版1.pdf");
    expect(found.source.view.total).toBe(294_800);
    expect(found.source.view.deductions.map((d) => d.name)).toEqual(["ロイヤリティ", "管理費", "車両リース"]);
    expect(found.source.confirmationText).toMatch(/^ドライバーの確認：2026年|^ドライバーの確認：20\d\d年/);
  });
});

describe("会社をまたがない", () => {
  it("B 社のリンクで開くと B 社の明細だけ。B 社の確認は A 社の一覧に出ない", async () => {
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const bLink = await linkOf("D01", b.tenantId);
    const data = (await loadPortal(db, bLink.token))!;
    expect(data.view.driver.name).toBe("青木 翔太");
    await confirmFromPortal(db, bLink.token, { version: 1 }, ctx);
    await askFromPortal(db, bLink.token, { lineKey: null, body: "B 社への質問" }, ctx);
    const [conf] = await db.select().from(s.statementConfirmations);
    expect(conf.tenantId).toBe(b.tenantId);
    const aList = await listMonthStatements(db, tenantId, DEMO_MONTH);
    expect(aList.counts.confirmed).toBe(0);
    expect(aList.counts.question).toBe(0);
    expect((await listMonthStatements(db, b.tenantId, DEMO_MONTH)).counts.confirmed).toBe(1);
    expect(await getStatementDetail(db, tenantId, bLink.st.id)).toBeNull();
  });
});
