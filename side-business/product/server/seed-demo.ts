import { count } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";

/**
 * デモ用の架空の会社（実在の人物・会社ではない）。
 * 8 人のドライバー（うち 3 人はインボイス未登録）、2 社の元請、5 つの案件、2 か月分の稼働、
 * 合意の印が無い控除（見張り番が拾う）、元請の支払通知（突合で差が出る）まで入れる。
 */
export const DEMO_MONTH = "2026-10-01";
export const DEMO_PREV_MONTH = "2026-09-01";

export async function seedDemo(db: Db): Promise<{ tenantId: string }> {
  const [tenant] = await db
    .insert(s.tenants)
    .values({
      name: "サンプル運送株式会社（架空）",
      registrationNo: "T1234567890123",
      taxMethod: "general",
      payTaxToExempt: true,
      payMonthOffset: 1,
      payDay: 25,
      settings: {
        requester: {
          code: "1234567890",
          nameKana: "ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ",
          bankCode: "0001",
          bankNameKana: "ﾐｽﾞﾎ",
          branchCode: "001",
          branchNameKana: "ﾎﾝﾃﾝ",
          accountType: "ordinary",
          accountNumber: "7654321",
        },
      },
      onboarding: { company: "done", drivers: "done", projects: "done", import: "done" },
    })
    .returning();
  const tenantId = tenant.id;
  await db.insert(s.users).values([
    { tenantId, email: "owner@demo.example", name: "デモ 社長", role: "owner" },
    { tenantId, email: "staff@demo.example", name: "デモ 事務", role: "staff" },
  ]);

  const [a, b] = await db
    .insert(s.clients)
    .values([
      { tenantId, name: "A物流（架空）", aliases: ["A物流", "Ａ物流"] },
      { tenantId, name: "B商事（架空）", aliases: ["B商事"], closingDay: 20 },
    ])
    .returning();

  const projects = await db
    .insert(s.projects)
    .values([
      { tenantId, clientId: a.id, name: "宅配（個建て）", aliases: ["宅配", "個建"], unit: "個", billRate: 190, payRate: 150 },
      { tenantId, clientId: a.id, name: "企業配（日当）", aliases: ["企業配", "日当"], unit: "日", billRate: 22000, payRate: 18000 },
      { tenantId, clientId: b.id, name: "スポット便", aliases: ["スポット"], unit: "件", billRate: 9000, payRate: 7000 },
      { tenantId, clientId: b.id, name: "ルート配送（時給）", aliases: ["ルート"], unit: "時間", billRate: 2600, payRate: 2000 },
      { tenantId, clientId: a.id, name: "夜間便", aliases: ["夜間"], unit: "便", billRate: 12000, payRate: 9500 },
    ])
    .returning();
  const P = Object.fromEntries(projects.map((p) => [p.name, p.id]));

  const drivers = await db
    .insert(s.drivers)
    .values([
      { tenantId, code: "D01", name: "青木 翔太", kana: "アオキ ショウタ", invoiceRegistered: true, registrationNo: "T9876543210987", bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "101", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "1234567", holderKana: "アオキ ショウタ", termsIssuedOn: "2026-04-01" },
      { tenantId, code: "D02", name: "井上 美咲", kana: "イノウエ ミサキ", invoiceRegistered: true, registrationNo: "T2345678901234", bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "202", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "2345678", holderKana: "イノウエ ミサキ", termsIssuedOn: "2026-04-01" },
      { tenantId, code: "D03", name: "上田 健", kana: "ウエダ ケン", invoiceRegistered: false, bankCode: "0009", bankNameKana: "ﾐﾂｲｽﾐﾄﾓ", branchCode: "303", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "3456789", holderKana: "ウエダ ケン", termsIssuedOn: "2026-05-10" },
      { tenantId, code: "D04", name: "遠藤 大輔", kana: "エンドウ ダイスケ", invoiceRegistered: false, bankCode: "9900", bankNameKana: "ﾕｳﾁﾖ", branchCode: "418", branchNameKana: "ﾖﾝｲﾁﾊﾁ", accountNumber: "4567890", holderKana: "エンドウ ダイスケ" },
      { tenantId, code: "D05", name: "岡田 拓也", kana: "オカダ タクヤ", invoiceRegistered: true, registrationNo: "T3456789012345", bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "104", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "5678901", holderKana: "オカダ タクヤ", termsIssuedOn: "2026-04-01" },
      { tenantId, code: "D06", name: "加藤 由美", kana: "カトウ ユミ", invoiceRegistered: true, registrationNo: "T4567890123456", bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "205", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "6789012", holderKana: "カトウ ユミ", termsIssuedOn: "2026-06-01" },
      { tenantId, code: "D07", name: "木村 誠", kana: "キムラ マコト", invoiceRegistered: false, termsIssuedOn: "2026-07-01" },
      { tenantId, code: "D08", name: "佐藤 亮", kana: "サトウ リョウ", invoiceRegistered: true, registrationNo: "T5678901234567", bankCode: "0009", bankNameKana: "ﾐﾂｲｽﾐﾄﾓ", branchCode: "310", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "7890123", holderKana: "サトウ リョウ", termsIssuedOn: "2026-04-01" },
    ])
    .returning();
  const D = Object.fromEntries(drivers.map((d) => [d.code!, d.id]));

  await db.insert(s.rateOverrides).values({ tenantId, driverId: D.D05, projectId: P["宅配（個建て）"], payRate: 155 });

  await db.insert(s.deductionRules).values([
    { tenantId, name: "ロイヤリティ", kind: "percent", rate: 0.1, onlyWhenWorked: true, taxable: true, agreedInWriting: true, basis: "業務委託契約 第8条", sort: 1 },
    { tenantId, name: "管理費", kind: "fixed", amount: 15000, onlyWhenWorked: true, taxable: true, agreedInWriting: true, basis: "業務委託契約 第8条", sort: 2 },
    { tenantId, driverId: D.D04, name: "車両リース", kind: "fixed", amount: 32000, onlyWhenWorked: false, taxable: true, agreedInWriting: true, basis: "車両賃貸借契約", sort: 3 },
    // 合意の印が無い控除（見張り番が「フリーランス法の減額のおそれ」を出す）
    { tenantId, driverId: D.D07, name: "制服代", kind: "fixed", amount: 5000, onlyWhenWorked: true, taxable: true, agreedInWriting: false, sort: 4 },
  ]);

  const work = (month: string, rows: [string, string, number][]) =>
    rows.map(([code, project, qty]) => ({ tenantId, month, driverId: D[code], projectId: P[project], qty }));
  await db.insert(s.workEntries).values([
    ...work(DEMO_PREV_MONTH, [
      ["D01", "宅配（個建て）", 2250], ["D01", "スポット便", 3],
      ["D02", "企業配（日当）", 20],
      ["D03", "宅配（個建て）", 1905],
      ["D04", "ルート配送（時給）", 160], ["D04", "スポット便", 2],
      ["D05", "企業配（日当）", 17], ["D05", "宅配（個建て）", 410],
      ["D06", "夜間便", 18],
      ["D07", "宅配（個建て）", 1300],
      ["D08", "企業配（日当）", 21],
    ]),
    ...work(DEMO_MONTH, [
      ["D01", "宅配（個建て）", 2310], ["D01", "スポット便", 4],
      ["D02", "企業配（日当）", 21],
      ["D03", "宅配（個建て）", 1840],
      ["D04", "ルート配送（時給）", 168], ["D04", "スポット便", 2],
      ["D05", "企業配（日当）", 18], ["D05", "宅配（個建て）", 420],
      ["D06", "夜間便", 20],
      // 先月より大きく減った人（見張り番の「急な変化」）
      ["D07", "宅配（個建て）", 380],
      ["D08", "企業配（日当）", 22],
    ]),
  ]);
  await db.insert(s.adjustments).values([
    { tenantId, month: DEMO_MONTH, driverId: D.D01, label: "駐車場代の立替", amount: 3300, agreedInWriting: true },
    { tenantId, month: DEMO_MONTH, driverId: D.D03, label: "車両修理の負担分", amount: -11000, agreedInWriting: true },
  ]);

  // 9 月は締め済み
  await db.insert(s.monthCloses).values({ tenantId, month: DEMO_PREV_MONTH, status: "closed", closedAt: new Date("2026-10-05T09:00:00+09:00") });

  // A物流からの 10 月分の支払通知（わざと差を入れてある：宅配の個数が少ない・夜間便の単価が違う）
  const [notice] = await db
    .insert(s.paymentNotices)
    .values({ tenantId, clientId: a.id, month: DEMO_MONTH, fileName: "A物流_支払通知_2026年10月.csv", total: 0 })
    .returning();
  const lines = [
    { rawProject: "宅配", qty: 4520, unitPrice: 190 },
    { rawProject: "企業配", qty: 61, unitPrice: 22000 },
    { rawProject: "夜間便", qty: 20, unitPrice: 11500 },
  ].map((l) => ({ tenantId, noticeId: notice.id, rawProject: l.rawProject, qty: l.qty, unitPrice: l.unitPrice, amount: Math.round(l.qty * l.unitPrice) }));
  await db.insert(s.paymentNoticeLines).values(lines);
  return { tenantId };
}

/** デモのとき、空なら入れる */
export async function ensureDemoSeeded(db: Db): Promise<void> {
  const [{ n }] = await db.select({ n: count() }).from(s.tenants);
  if (n === 0) await seedDemo(db);
}
