import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { closeMonth } from "~/server/features/close";
import {
  buildTransferCsv,
  buildTransferFile,
  createTransferBatch,
  deleteTransferBatch,
  loadTransferPlan,
  readRequester,
  setTransferExecutedOn,
  transferFileName,
} from "~/server/features/transfer";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 10 月分の明細の振込額（架空の会社。D07 は口座が無い） */
const TOTALS: Record<string, number> = {
  D01: 357555,
  D02: 357720,
  D03: 245740,
  D04: 294800,
  D05: 368709,
  D06: 171600,
  D07: 34430,
  D08: 375540,
};
const WITHOUT_D07 = Object.entries(TOTALS)
  .filter(([code]) => code !== "D07")
  .reduce((a, [, v]) => a + v, 0);

async function driverId(db: Db, tenantId: string, code: string): Promise<string> {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d.id;
}

const noWatch = { runWatch: async () => [] };

describe("振込データ（全銀）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
  });
  afterAll(async () => client.close());

  it("明細が無いうちは作れない（明細を作るよう案内する）", async () => {
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    expect(plan.ready).toBe(false);
    expect(plan.blockReason).toContain("明細");
    await expect(createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" })).rejects.toThrow("明細");
  });

  it("D07（口座なし）を理由つきで外し、7 人・振込額の合計で作る", async () => {
    await generateStatements(db, tenantId, DEMO_MONTH);
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    expect(plan.ready).toBe(true);
    expect(plan.promisedPayDate).toBe("2026-11-25");
    expect(plan.defaultTransferDate).toBe("2026-11-25");
    expect(plan.requester).not.toBeNull();
    expect(plan.included.map((r) => r.driverCode)).toEqual(["D01", "D02", "D03", "D04", "D05", "D06", "D08"]);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]).toMatchObject({ driverCode: "D07", reason: "no_bank", amount: 34430 });
    expect(plan.excluded[0].message).toContain("口座が未登録");
    expect(plan.total).toBe(WITHOUT_D07);
    expect(plan.total).toBe(2171664);
    for (const r of plan.included) expect(r.amount).toBe(TOTALS[r.driverCode!]);
    expect(plan.included[0].holderHalf).toBe("ｱｵｷ ｼﾖｳﾀ");

    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: plan.defaultTransferDate, scope: "all" }, null);
    expect(batch.count).toBe(7);
    expect(batch.total).toBe(2171664);
    expect(batch.fileName).toBe("振込_2026年10月分_20261125.txt");
    expect(batch.statementIds).toHaveLength(7);

    // 振込データに入れた明細の振込額の合計と同じ
    const saved = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
    const included = saved.filter((st) => batch.statementIds.includes(st.id));
    expect(included.reduce((a, st) => a + st.total, 0)).toBe(batch.total);

    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create")));
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ month: DEMO_MONTH, count: 7, total: 2171664 });
  });

  it("全銀のファイル：ヘッダー＋データ 7 行＋トレーラー＋エンド、120 桁・Shift_JIS・CRLF", async () => {
    const [batch] = await db.select().from(s.transferBatches).where(eq(s.transferBatches.tenantId, tenantId));
    const file = await buildTransferFile(db, tenantId, batch.id);
    expect(file.fileName).toBe("振込_2026年10月分_20261125.txt");
    expect(file.records).toHaveLength(1 + 7 + 1 + 1);
    for (const r of file.records) expect(r).toHaveLength(120);
    expect(file.bytes.length).toBe(10 * 122);
    const [header, ...rest] = file.records;
    expect(header.slice(0, 4)).toBe("1210");
    expect(header.slice(4, 14)).toBe("1234567890");
    expect(header.slice(54, 58)).toBe("1125");
    const data = rest.slice(0, 7);
    expect(data.every((r) => r.startsWith("2"))).toBe(true);
    // 1 行目は青木（D01）：金額は 10 桁（手数料は引かない）
    expect(data[0].slice(80, 90)).toBe("0000357555");
    expect(data[0].slice(50, 80).trim()).toBe("ｱｵｷ ｼﾖｳﾀ");
    const trailer = rest[7];
    expect(trailer.slice(0, 1)).toBe("8");
    expect(trailer.slice(1, 7)).toBe("000007");
    expect(trailer.slice(7, 19)).toBe(String(2171664).padStart(12, "0"));
    expect(rest[8]).toBe("9" + " ".repeat(119));
    // 半角カナは 1 バイト（Shift_JIS）で、行の終わりは CRLF
    expect(file.bytes[120]).toBe(0x0d);
    expect(file.bytes[121]).toBe(0x0a);

    const csv = await buildTransferCsv(db, tenantId, batch.id);
    expect(csv.fileName).toBe("振込一覧_2026年10月分_20261125.csv");
    const lines = csv.text.trim().split("\r\n");
    expect(lines).toHaveLength(1 + 7 + 1);
    expect(lines[0]).toContain("口座名義（カナ）");
    expect(lines[1]).toContain("青木 翔太");
    expect(lines[1]).toContain("357555");
    expect(lines[8]).toContain("2171664");
  });

  it("二重に振り込まない：前のデータがあると「全員」は確認が要り、「まだの人だけ」は口座を入れた D07 だけ", async () => {
    await expect(createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" })).rejects.toThrow("二重");
    await expect(createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "remaining" })).rejects.toThrow("いません");

    const d07 = await driverId(db, tenantId, "D07");
    await db
      .update(s.drivers)
      .set({ bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "107", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "8901234", holderKana: "キムラ マコト" })
      .where(and(eq(s.drivers.id, d07), eq(s.drivers.tenantId, tenantId)));
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    expect(plan.included.find((r) => r.driverCode === "D07")?.inBatches).toEqual([]);
    expect(plan.included.find((r) => r.driverCode === "D01")?.inBatches).toHaveLength(1);

    const extra = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "remaining" });
    expect(extra.count).toBe(1);
    expect(extra.total).toBe(34430);
    expect(extra.fileName).toBe("振込_2026年10月分_20261125_2.txt");
    const file = await buildTransferFile(db, tenantId, extra.id);
    expect(file.records).toHaveLength(4);

    // 取り消す（振り込んだ日が無いものだけ）
    await deleteTransferBatch(db, tenantId, extra.id);
    expect(await db.select().from(s.transferBatches).where(eq(s.transferBatches.id, extra.id))).toHaveLength(0);
  });

  it("口座の誤りは人ごとに日本語で出し、振込データに入れない", async () => {
    const d03 = await driverId(db, tenantId, "D03");
    await db.update(s.drivers).set({ branchCode: "30", holderKana: "ウエダ ケン★" }).where(and(eq(s.drivers.id, d03), eq(s.drivers.tenantId, tenantId)));
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    const row = plan.excluded.find((r) => r.driverCode === "D03");
    expect(row?.reason).toBe("bank_invalid");
    expect(row?.issues).toContain("支店コードは 3 桁の数字です");
    expect(row?.issues.join()).toContain("使えない文字");
    // 前に作ったデータ（D03 を含む）は、今は口座に誤りがあるのでダウンロードできない
    const [first] = await db.select().from(s.transferBatches).where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.count, 7)));
    await expect(buildTransferFile(db, tenantId, first.id)).rejects.toThrow("上田 健");
    await db.update(s.drivers).set({ branchCode: "303", holderKana: "ウエダ ケン" }).where(and(eq(s.drivers.id, d03), eq(s.drivers.tenantId, tenantId)));
  });

  it("振込指定日：銀行の休みの日は断り、約束の日が休みなら前の営業日を初期値にする", async () => {
    await expect(
      createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-21", scope: "all", replaceConfirmed: true }),
    ).rejects.toThrow("銀行の休みの日");
    await expect(
      createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-13-01", scope: "all", replaceConfirmed: true }),
    ).rejects.toThrow("正しい日付");
    expect(transferFileName("2026-10-01", "2026-11-20")).toBe("振込_2026年10月分_20261120.txt");
  });

  it("0 円以下の人は「振込の対象外」として外す", async () => {
    const d06 = await driverId(db, otherTenantId, "D06");
    await db.insert(s.adjustments).values({ tenantId: otherTenantId, month: DEMO_MONTH, driverId: d06, label: "事故の負担分", amount: -200000, agreedInWriting: true });
    await generateStatements(db, otherTenantId, DEMO_MONTH);
    const plan = await loadTransferPlan(db, otherTenantId, DEMO_MONTH);
    const row = plan.excluded.find((r) => r.driverCode === "D06");
    expect(row).toMatchObject({ reason: "not_positive", amount: 171600 - 200000 });
    expect(row?.message).toBe("振込の対象外です（控除が委託料を上回っています。内容を確かめてください）");
    expect(plan.included).toHaveLength(6);
  });

  it("明細が古いと作れない。作ったあとに明細が変わると、ダウンロードを止める", async () => {
    const d01 = await driverId(db, otherTenantId, "D01");
    const batch = await createTransferBatch(db, otherTenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" });
    await db.insert(s.adjustments).values({ tenantId: otherTenantId, month: DEMO_MONTH, driverId: d01, label: "高速代の立替", amount: 1200 });
    const stale = await loadTransferPlan(db, otherTenantId, DEMO_MONTH);
    expect(stale.ready).toBe(false);
    expect(stale.blockReason).toContain("作り直して");
    await expect(
      createTransferBatch(db, otherTenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "remaining" }),
    ).rejects.toThrow("作り直して");

    await generateStatements(db, otherTenantId, DEMO_MONTH);
    const plan = await loadTransferPlan(db, otherTenantId, DEMO_MONTH);
    expect(plan.batches.find((b) => b.id === batch.id)).toMatchObject({ changed: true, total: batch.total, currentTotal: batch.total + 1200 });
    await expect(buildTransferFile(db, otherTenantId, batch.id)).rejects.toThrow("作ったあとに明細が変わりました");
  });

  it("締めたあとでも、実際に振り込んだ日を入れられる", async () => {
    await closeMonth(db, tenantId, DEMO_MONTH, null, noWatch);
    const [batch] = await db.select().from(s.transferBatches).where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.count, 7)));
    const row = await setTransferExecutedOn(db, tenantId, batch.id, "2026-11-25");
    expect(row.executedOn).toBe("2026-11-25");
    await expect(setTransferExecutedOn(db, tenantId, batch.id, "2026/11/25")).rejects.toThrow("正しい日付");
    // 振り込んだ日が入っているものは取り消せない
    await expect(deleteTransferBatch(db, tenantId, batch.id)).rejects.toThrow("取り消せません");
    // 締めた月でもファイルは作れる（明細は変わらない）
    const file = await buildTransferFile(db, tenantId, batch.id);
    expect(file.records).toHaveLength(10);
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    expect(plan.closed).toBe(true);
    expect(plan.ready).toBe(true);
    expect(plan.batches[plan.batches.length - 1].executedOn).toBe("2026-11-25");
  });

  it("他社の振込データは読めず、変えられず、消せない", async () => {
    const [mine] = await db.select().from(s.transferBatches).where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.count, 7)));
    await expect(buildTransferFile(db, otherTenantId, mine.id)).rejects.toThrow("見つかりません");
    await expect(buildTransferCsv(db, otherTenantId, mine.id)).rejects.toThrow("見つかりません");
    await expect(setTransferExecutedOn(db, otherTenantId, mine.id, "2026-11-26")).rejects.toThrow("見つかりません");
    await expect(deleteTransferBatch(db, otherTenantId, mine.id)).rejects.toThrow("見つかりません");
    await expect(buildTransferFile(db, tenantId, "not-a-uuid")).rejects.toThrow("見つかりません");
    const [after] = await db.select().from(s.transferBatches).where(eq(s.transferBatches.id, mine.id));
    expect(after.executedOn).toBe("2026-11-25");
    // 他社の一覧には出ない
    const otherPlan = await loadTransferPlan(db, otherTenantId, DEMO_MONTH);
    expect(otherPlan.batches.some((b) => b.id === mine.id)).toBe(false);
  });

  it("締めた月に明細が無ければ、そう伝える（9 月）", async () => {
    const plan = await loadTransferPlan(db, tenantId, DEMO_PREV_MONTH);
    expect(plan.closed).toBe(true);
    expect(plan.ready).toBe(false);
    expect(plan.blockReason).toContain("保存された明細がありません");
  });

  it("振込依頼人の設定が足りないと、足りないところを日本語で返す", () => {
    expect(readRequester({}).problems).toEqual(
      expect.arrayContaining(["振込依頼人コードは 10 桁の数字です", "金融機関コードは 4 桁の数字です", "依頼人名（カナ）がありません"]),
    );
    const ok = readRequester({
      requester: { code: "1234567890", nameKana: "サンプル", bankCode: "0001", branchCode: "001", accountType: "ordinary", accountNumber: "1234567" },
    });
    expect(ok.problems).toEqual([]);
    expect(ok.requester?.code).toBe("1234567890");
  });
});
