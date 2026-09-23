import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { confirmFromPortal, loadPortal, recordPortalView } from "~/server/features/portal";
import {
  confirmationRecordRows,
  deemedClauseOf,
  getStatementDetail,
  getStatementRow,
  listMonthStatements,
  markStatementSent,
  staffLinkToken,
  versionView,
} from "~/server/features/statements";
import { describeChanges } from "~/server/features/statements/diff";
import { statementStatus } from "~/server/features/statements/status";
import { qtyText, summaryRows, toDriverView, totalNote, unitPriceText, type DriverStatementView } from "~/server/features/statements/view";
import { resetRateLimit } from "~/server/rate-limit";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, readSnapshot } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ctx = { ipHash: "ip-hash-review", userAgent: IPHONE };
const pause = () => new Promise((r) => setTimeout(r, 5));

let db: Db;
let client: PGlite;
let tenantId: string;

async function statementOf(code: string, tid = tenantId) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tid), eq(s.drivers.code, code)));
  const [st] = await db
    .select()
    .from(s.statements)
    .where(and(eq(s.statements.tenantId, tid), eq(s.statements.month, DEMO_MONTH), eq(s.statements.driverId, d.id)));
  return { driver: d, st };
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

describe("単価・数量は丸めずに見せる", () => {
  it("小数の単価（152.5円）でも、数量 × 単価 が金額と合う形で出る", async () => {
    const { driver } = await statementOf("D01");
    const [takuhai] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "宅配（個建て）")));
    await db.insert(s.rateOverrides).values({ tenantId, driverId: driver.id, projectId: takuhai.id, payRate: 152.5 });
    await generateStatements(db, tenantId, DEMO_MONTH);
    const { st } = await statementOf("D01");
    const v = toDriverView(readSnapshot(st), st);
    const line = v.lines.find((l) => l.project === "宅配（個建て）")!;
    expect([line.qty, line.rate, line.amount]).toEqual([2310, 152.5, 352_275]);
    expect(`${qtyText(line.qty)}${line.unit} × ${unitPriceText(line.rate)}`).toBe("2,310個 × 152.5円");
    expect(summaryRows(v).reduce((n, r) => n + r.amount, 0)).toBe(st.total);
    expect(qtyText(7.125)).toBe("7.125");
    expect(unitPriceText(1850)).toBe("1,850円");
  });

  it("振込額が 0 円・マイナスのときの一言", () => {
    expect(totalNote(357_555)).toBeNull();
    expect(totalNote(0)).toContain("お振込はありません");
    expect(totalNote(-5_000)).toContain("会社にご確認ください");
  });
});

describe("前の版との違い", () => {
  it("確認のあとで調整が足されたら、ドライバーにも会社にも「変わったところ」が出る", async () => {
    const { st, driver } = await statementOf("D01");
    const token = staffLinkToken(st).token;
    await confirmFromPortal(db, token, { version: 1 }, ctx);
    await pause();
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "高速代の立替", amount: 1200, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);

    const portal = (await loadPortal(db, token))!;
    expect(portal.confirmedOlder?.version).toBe(1);
    expect(portal.changes).toEqual(["調整「高速代の立替」＋1,200円 が加わりました", "お振込額：357,555円 → 358,755円（＋1,200円）"]);
    // 会社の売上・受注単価は違いの文にも入らない
    expect(portal.changes.join("")).not.toMatch(/売上|受注|474,900/);

    const detail = (await getStatementDetail(db, tenantId, st.id))!;
    expect(detail.changes).toEqual({ fromVersion: 1, fromConfirmed: true, items: portal.changes });

    // 版 2 を確認すると、ドライバーの画面の「変わったところ」は消える
    await confirmFromPortal(db, token, { version: 2 }, ctx);
    expect((await loadPortal(db, token))!.changes).toEqual([]);
    // 会社の画面は、確認済みの版が今の版なので 1 つ前の版と比べる
    expect((await getStatementDetail(db, tenantId, st.id))!.changes).toMatchObject({ fromVersion: 1, fromConfirmed: false });
  });

  it("単価・数量・控除の違いを文にする。調整の並びが変わっただけなら違いにしない", () => {
    const base: DriverStatementView = {
      title: "支払明細書（仕入明細書）",
      month: "2026-10-01",
      period: { from: "2026-10-01", to: "2026-10-31" },
      payDate: "2026-11-25",
      company: { name: "サンプル", registrationNo: null },
      driver: { name: "青木 翔太", code: "D01", registrationNo: "T9876543210987", invoiceRegistered: true },
      isPurchaseStatement: true,
      lines: [{ key: "p1", project: "宅配", client: null, unit: "個", qty: 100, rate: 150, amount: 15_000 }],
      subtotal: 15_000,
      tax: 1_500,
      taxLabel: "消費税",
      taxRatePercent: 10,
      deductions: [{ key: "r1", name: "管理費", amount: 3_000, taxable: true, agreedInWriting: true, how: "毎月の定額" }],
      deductionTotal: 3_000,
      deductionTax: 300,
      adjustments: [
        { key: "adj:0", label: "駐車場代", amount: 500, taxable: false, agreedInWriting: false },
        { key: "adj:1", label: "高速代", amount: 800, taxable: false, agreedInWriting: false },
      ],
      adjustmentTotal: 1_300,
      adjustmentTax: 0,
      withholding: null,
      total: 14_500,
      note: "",
      version: 1,
      hashShort: "abc",
    };
    const swapped = { ...base, adjustments: [base.adjustments[1], base.adjustments[0]], version: 2 };
    expect(describeChanges(base, swapped)).toEqual(["金額は変わっていません（名前や注記など、記載の内容が変わりました）"]);

    const changed: DriverStatementView = {
      ...base,
      lines: [
        { key: "p1", project: "宅配", client: null, unit: "個", qty: 110, rate: 152.5, amount: 16_775 },
        { key: "p2", project: "夜間便", client: null, unit: "便", qty: 2, rate: 9_500, amount: 19_000 },
      ],
      tax: 3_577,
      deductions: [],
      adjustments: [base.adjustments[1]],
      total: 40_000,
    };
    expect(describeChanges(base, changed)).toEqual([
      "宅配：数量 100 → 110個、単価 150円 → 152.5円、金額 15,000円 → 16,775円",
      "夜間便：2便 × 9,500円 ＝ 19,000円 が加わりました",
      "引かれているもの「管理費」（3,000円）がなくなりました",
      "調整「駐車場代」（＋500円）がなくなりました",
      "消費税：1,500円 → 3,577円",
      "お振込額：14,500円 → 40,000円（＋25,500円）",
    ]);
  });

  it("前の版の写しは会社で絞って読む（他社の明細の版は読めない）", async () => {
    const b = await seedDemo(db);
    await generateStatements(db, b.tenantId, DEMO_MONTH);
    const { st: bSt } = await statementOf("D01", b.tenantId);
    expect((await versionView(db, b.tenantId, bSt.id, 1))?.total).toBe(357_555);
    expect(await versionView(db, tenantId, bSt.id, 1)).toBeNull();
    expect(await versionView(db, tenantId, "not-a-uuid", 1)).toBeNull();
    expect(await versionView(db, b.tenantId, bSt.id, 0)).toBeNull();
  });
});

describe("開封は今の中身について", () => {
  it("開いたあとで中身が変わったら「開封」ではなくなり、開き直すと今の中身の開封になる", async () => {
    const { st, driver } = await statementOf("D02");
    const token = staffLinkToken(st).token;
    await markStatementSent(db, tenantId, st.id, null, "line");
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: true });
    let item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status).toMatchObject({ key: "viewed", viewedCurrent: true });

    await pause();
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: driver.id, label: "駐車場代の立替", amount: 800, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);
    item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status).toMatchObject({ key: "sent", viewedCurrent: false, needsResend: true });
    const csvRow = (await confirmationRecordRows(db, tenantId, DEMO_MONTH)).find((r) => r[2] === "井上 美咲")!;
    expect(String(csvRow[8])).toMatch(/^前の中身を .* に開いた（今の中身はまだ）$/);

    await markStatementSent(db, tenantId, st.id, null, "line");
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: true });
    expect(await recordPortalView(db, token, ctx)).toEqual({ recorded: false });
    item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status).toMatchObject({ key: "viewed", viewedCurrent: true, needsResend: false });
    const views = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "statement.view")));
    expect(views.map((v) => [v.detail.version, v.detail.again])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("純関数：前の中身の開封は「開封」にしない", () => {
    const t = new Date("2026-11-02T09:00:00+09:00");
    const later = new Date(t.getTime() + 3600_000);
    const st = statementStatus({ version: 2, sentAt: later, viewedAt: t, updatedAt: later, confirmations: [], driverMessages: [] }, later, 7);
    expect(st).toMatchObject({ key: "sent", viewedCurrent: false });
  });
});

describe("確認の記録", () => {
  it("同時に 2 回押しても 1 件だけ残る", async () => {
    const { st } = await statementOf("D05");
    const token = staffLinkToken(st).token;
    const results = await Promise.all([
      confirmFromPortal(db, token, { version: 1 }, ctx),
      confirmFromPortal(db, token, { version: 1 }, { ...ctx, ipHash: "another-ip" }),
    ]);
    expect(results.map((r) => r.already).sort()).toEqual([false, true]);
    const confs = await db.select().from(s.statementConfirmations).where(eq(s.statementConfirmations.statementId, st.id));
    expect(confs).toHaveLength(1);
    expect(confs[0].totalAtConfirm).toBe(st.total);
  });

  it("送った日時は、作った日時より前にならない（時計のずれで「送り直しが要る」に見えない）", async () => {
    const { st } = await statementOf("D06");
    const early = new Date(st.updatedAt.getTime() - 2_000);
    await markStatementSent(db, tenantId, st.id, null, "copy", early);
    const row = (await getStatementRow(db, tenantId, st.id))!;
    expect(row.sentAt!.getTime()).toBe(st.updatedAt.getTime());
    const item = (await listMonthStatements(db, tenantId, DEMO_MONTH)).items.find((i) => i.id === st.id)!;
    expect(item.status).toMatchObject({ key: "sent", needsResend: false });
  });
});

describe("みなし確認の条項（取引条件の記録）", () => {
  it("その人のいちばん新しい取引条件の記録を見る。他社の記録は見ない", async () => {
    const { st, driver } = await statementOf("D01");
    expect(await deemedClauseOf(db, tenantId, driver.id)).toBeNull();
    expect((await getStatementDetail(db, tenantId, st.id))!.terms).toBeNull();

    await db.insert(s.termsRecords).values([
      { tenantId, driverId: driver.id, version: 1, issuedOn: "2026-04-01", content: {}, deemedClause: false },
      { tenantId, driverId: driver.id, version: 2, issuedOn: "2026-09-01", content: {}, deemedClause: true },
    ]);
    expect((await getStatementDetail(db, tenantId, st.id))!.terms).toEqual({ version: 2, issuedOn: "2026-09-01", deemedClause: true });

    // B 社の同じ人の記録は、A 社からは見えない
    const b = await seedDemo(db);
    const [bDriver] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, b.tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.termsRecords).values({ tenantId: b.tenantId, driverId: bDriver.id, version: 1, issuedOn: "2026-09-01", content: {}, deemedClause: true });
    expect(await deemedClauseOf(db, tenantId, bDriver.id)).toBeNull();
  });
});
