import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import { buildStatementDrafts } from "~/server/calc/statement";
import { loadBuildInput } from "~/server/repo";
import { aiConsentHistory, AI_CONSENT_ACTION, setAiConsent, updateCompany } from "~/server/features/settings/company";
import { createClient, deleteClient, listClients, updateClient } from "~/server/features/settings/clients";
import { createDriver, deleteDriver, driverReferences, getDriver, listDrivers, setDriverActive, updateDriver } from "~/server/features/settings/drivers";
import { firstIssue } from "~/server/features/settings/errors";
import { deemedNote } from "~/server/features/settings/format";
import { settingsOverview } from "~/server/features/settings/overview";
import { createProject, deleteProject, listProjects, setProjectActive, updateProject, usedProjectIds } from "~/server/features/settings/projects";
import { deleteOverride, listOverrides, upsertOverride } from "~/server/features/settings/rates";
import { createRule, deleteRule, listRules, ruleImpact, setRuleActive, updateRule, usedRuleIds } from "~/server/features/settings/rules";
import { clientSchema, companySchema, driverSchema, overrideSchema, projectSchema, ruleSchema } from "~/server/features/settings/schemas";
import { changeUserRole, listPendingInvites, listUsers, prepareInvite, revokeInvite, setUserDisabled } from "~/server/features/settings/users";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { sha256 } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

/**
 * 設定（台帳）の DB の処理。架空の会社を 2 つ入れ、A の関数から B が読めない・変えられないことも確かめる。
 */

let db: Db;
let client: PGlite;
let A: string;
let B: string;

async function driverByCode(tenantId: string, code: string) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d;
}
async function projectByName(tenantId: string, name: string) {
  const [p] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, name)));
  return p;
}
async function ruleByName(tenantId: string, name: string) {
  const [r] = await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, name)));
  return r;
}
async function usersOf(tenantId: string) {
  return db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
}
/** 誤りの最初の文（投げなければ null） */
async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return firstIssue(e);
  }
}
async function totalOf(tenantId: string, month: string, code: string) {
  const d = await driverByCode(tenantId, code);
  return buildStatementDrafts(await loadBuildInput(db, tenantId, month)).find((x) => x.driverId === d.id)!.total;
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  A = (await seedDemo(db)).tenantId;
  B = (await seedDemo(db)).tenantId;
});
afterAll(async () => client.close());

describe("ドライバー", () => {
  it("登録・変更・無効。番号・名前・別名の重なりは止める", async () => {
    const created = await createDriver(db, A, driverSchema.parse({ code: "D09", name: "高橋 健太", kana: "たかはし けんた", aliases: "高橋、タカハシ", accountType: "ordinary", active: "on" }));
    expect(created).toMatchObject({ tenantId: A, code: "D09", aliases: ["高橋", "タカハシ"], withholdingCategory: "none", active: true });
    // かな・カナのどちらで探しても当たる
    expect((await listDrivers(db, A, { q: "タカハシ" })).rows.map((d) => d.code)).toEqual(["D09"]);

    expect(await failure(createDriver(db, A, driverSchema.parse({ code: "d01", name: "別の人", accountType: "ordinary" })))).toContain("青木 翔太");
    expect(await failure(createDriver(db, A, driverSchema.parse({ name: "青木翔太", accountType: "ordinary" })))).toContain("同じ名前");
    expect(await failure(createDriver(db, A, driverSchema.parse({ name: "新しい人", aliases: "上田 健", accountType: "ordinary" })))).toContain("別名「上田 健」");
    // 別の会社なら同じ番号でもよい
    const inB = await createDriver(db, B, driverSchema.parse({ code: "D09", name: "高橋 健太", accountType: "ordinary", active: "on" }));
    expect(inB.tenantId).toBe(B);

    const { after, changed } = await updateDriver(
      db,
      A,
      created.id,
      driverSchema.parse({ code: "D09", name: "高橋 健太", accountType: "ordinary", active: "on", bankCode: "0001", branchCode: "101", accountNumber: "765", holderKana: "タカハシ ケンタ" }),
    );
    expect(after).toMatchObject({ accountNumber: "0000765", holderKana: "ﾀｶﾊｼ ｹﾝﾀ" });
    expect(changed.accountNumber).toEqual({ from: null, to: "0000765" });
    expect(changed.name).toBeUndefined();

    await setDriverActive(db, A, created.id, false);
    const { rows, counts } = await listDrivers(db, A);
    expect(rows.find((d) => d.id === created.id)).toBeUndefined();
    expect(counts).toMatchObject({ total: 9, active: 8 });
    expect((await listDrivers(db, A, { status: "inactive" })).rows.map((d) => d.code)).toEqual(["D09"]);
    expect((await listDrivers(db, A, { q: "高橋", status: "all" })).rows.map((d) => d.code)).toEqual(["D09"]);
  });

  it("しるしで絞る：口座なしは D07、明示なしは D04、未登録は D03・D04・D07（と、足したばかりの D09）", async () => {
    expect((await listDrivers(db, B, { flag: "no_bank" })).rows.map((d) => d.code)).toEqual(["D07", "D09"]);
    expect((await listDrivers(db, B, { flag: "no_terms" })).rows.map((d) => d.code)).toEqual(["D04", "D09"]);
    expect((await listDrivers(db, B, { flag: "unregistered" })).rows.map((d) => d.code)).toEqual(["D03", "D04", "D07", "D09"]);
  });

  it("別の会社のドライバーは読めない・変えられない・消せない", async () => {
    const aoki = await driverByCode(A, "D01");
    expect(await getDriver(db, B, aoki.id)).toBeNull();
    expect(await failure(updateDriver(db, B, aoki.id, driverSchema.parse({ name: "乗っ取り", accountType: "ordinary" })))).toContain("見つかりません");
    expect(await failure(setDriverActive(db, B, aoki.id, false))).toContain("見つかりません");
    expect(await failure(deleteDriver(db, B, aoki.id))).toContain("見つかりません");
    const still = await driverByCode(A, "D01");
    expect(still).toMatchObject({ name: "青木 翔太", active: true });
  });

  it("記録がある人は消さずに無効へ案内。記録が無い人は、単価ごと消せる", async () => {
    const aoki = await driverByCode(A, "D01");
    const refs = await driverReferences(db, A, aoki.id);
    expect(refs.canDelete).toBe(false);
    expect(refs.history.join("・")).toContain("稼働 4件");
    expect(await failure(deleteDriver(db, A, aoki.id))).toContain("無効にする");
    expect(await driverByCode(A, "D01")).toBeTruthy();

    const temp = await createDriver(db, A, driverSchema.parse({ name: "間違えて登録", accountType: "ordinary", active: "on" }));
    const takuhai = await projectByName(A, "宅配（個建て）");
    await upsertOverride(db, A, overrideSchema.parse({ driverId: temp.id, projectId: takuhai.id, payRate: "140", agreedOn: "" }));
    const tempRefs = await driverReferences(db, A, temp.id);
    expect(tempRefs).toMatchObject({ canDelete: true, attached: { overrides: 1, rules: 0 } });
    await deleteDriver(db, A, temp.id);
    expect(await getDriver(db, A, temp.id)).toBeNull();
    expect((await listOverrides(db, A)).some((o) => o.driverId === temp.id)).toBe(false);
  });
});

describe("元請と案件", () => {
  it("案件は受注と支払の単価を持つ。別の会社の元請には結びつけられない", async () => {
    const [bClient] = await listClients(db, B);
    const bad = projectSchema.parse({ clientId: bClient.id, name: "新しい案件", unit: "便", billRate: "10000", payRate: "8000", active: "on" });
    expect(await failure(createProject(db, A, bad))).toContain("元請は見つかりません");

    const aClients = await listClients(db, A);
    const aButsuryu = aClients.find((c) => c.name === "A物流（架空）")!;
    expect(aButsuryu).toMatchObject({ projects: 3, activeProjects: 3, notices: 1 });
    const p = await createProject(db, A, projectSchema.parse({ clientId: aButsuryu.id, name: "チャーター便", unit: "便", billRate: "３０，０００", payRate: "24000", active: "on" }));
    expect(p).toMatchObject({ billRate: 30000, payRate: 24000, unit: "便" });
    expect(await failure(createProject(db, A, projectSchema.parse({ name: "宅配（個建て）", unit: "個", billRate: "1", payRate: "1" })))).toContain("同じ名前の案件");

    const listed = await listProjects(db, A, { clientId: aButsuryu.id });
    expect(listed.map((x) => x.name).sort()).toEqual(["チャーター便", "企業配（日当）", "夜間便", "宅配（個建て）"].sort());
    expect(listed.find((x) => x.name === "宅配（個建て）")!.overrides).toBe(1);
  });

  it("使った案件は消せない（使わないにする）。使っていない案件は消せる。別の会社からは変えられない", async () => {
    const takuhai = await projectByName(A, "宅配（個建て）");
    expect((await usedProjectIds(db, A)).has(takuhai.id)).toBe(true);
    expect(await failure(deleteProject(db, A, takuhai.id))).toContain("使わない");
    await setProjectActive(db, A, takuhai.id, false);
    expect((await projectByName(A, "宅配（個建て）")).active).toBe(false);
    await setProjectActive(db, A, takuhai.id, true);

    expect(await failure(updateProject(db, B, takuhai.id, projectSchema.parse({ name: "x", unit: "個", billRate: "0", payRate: "0", active: "on" })))).toContain("見つかりません");
    expect(await failure(deleteProject(db, B, takuhai.id))).toContain("見つかりません");
    expect((await projectByName(A, "宅配（個建て）")).billRate).toBe(190);

    const charter = await projectByName(A, "チャーター便");
    expect((await usedProjectIds(db, A)).has(charter.id)).toBe(false);
    await deleteProject(db, A, charter.id);
    expect(await projectByName(A, "チャーター便")).toBeUndefined();
  });

  it("元請：案件や支払通知で使われていれば消せない。使われていなければ消せる。別の会社からは消せない", async () => {
    const aClients = await listClients(db, A);
    const aButsuryu = aClients.find((c) => c.name === "A物流（架空）")!;
    expect(await failure(deleteClient(db, A, aButsuryu.id))).toContain("案件 3件");
    expect(await failure(deleteClient(db, B, aButsuryu.id))).toContain("見つかりません");

    const c = await createClient(db, A, clientSchema.parse({ name: "C運輸（架空）", aliases: "C運輸", closingDay: "20" }));
    expect(c).toMatchObject({ closingDay: 20, aliases: ["C運輸"] });
    expect(await failure(createClient(db, A, clientSchema.parse({ name: "B商事", closingDay: "0" })))).toContain("B商事（架空）");
    const { changed } = await updateClient(db, A, c.id, clientSchema.parse({ name: "C運輸（架空）", closingDay: "25" }));
    expect(changed.closingDay).toEqual({ from: 20, to: 25 });
    await deleteClient(db, A, c.id);
    expect((await listClients(db, A)).some((x) => x.id === c.id)).toBe(false);
  });
});

describe("ドライバー別の単価", () => {
  it("同じ人 × 案件は 1 つ（上書き）。明細の金額に反映される", async () => {
    const okada = await driverByCode(A, "D05");
    const aoki = await driverByCode(A, "D01");
    const takuhai = await projectByName(A, "宅配（個建て）");
    expect(await totalOf(A, DEMO_MONTH, "D01")).toBe(357555);

    const first = await upsertOverride(db, A, overrideSchema.parse({ driverId: okada.id, projectId: takuhai.id, payRate: "160", agreedOn: "2026-09-20" }));
    expect(first.created).toBe(false);
    expect(first.before?.payRate).toBe(155);
    const again = await upsertOverride(db, A, overrideSchema.parse({ driverId: okada.id, projectId: takuhai.id, payRate: "１５５", agreedOn: "2026-04-01" }));
    expect(again.after.id).toBe(first.after.id);
    const rows = await db.select().from(s.rateOverrides).where(and(eq(s.rateOverrides.tenantId, A), eq(s.rateOverrides.driverId, okada.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payRate: 155, agreedOn: "2026-04-01" });

    // 青木さんの宅配を 150 → 160 円に：2,310 個 × 160 = 369,600円 ＋ スポット便 28,000円
    const aokiRate = await upsertOverride(db, A, overrideSchema.parse({ driverId: aoki.id, projectId: takuhai.id, payRate: "160", agreedOn: "2026-09-30" }));
    expect(aokiRate.created).toBe(true);
    expect(await totalOf(A, DEMO_MONTH, "D01")).toBe(380424);
    await deleteOverride(db, A, aokiRate.after.id);
    expect(await totalOf(A, DEMO_MONTH, "D01")).toBe(357555);
  });

  it("別の会社のドライバー・案件では登録できない。別の会社の単価は消せない", async () => {
    const aoki = await driverByCode(A, "D01");
    const takuhaiB = await projectByName(B, "宅配（個建て）");
    expect(await failure(upsertOverride(db, A, overrideSchema.parse({ driverId: aoki.id, projectId: takuhaiB.id, payRate: "1", agreedOn: "" })))).toContain("案件は見つかりません");
    const [oA] = await listOverrides(db, A);
    expect(await failure(deleteOverride(db, B, oA.id))).toContain("見つかりません");
    expect((await listOverrides(db, A)).some((o) => o.id === oA.id)).toBe(true);
    expect((await listOverrides(db, B)).every((o) => o.driverName !== "（不明）")).toBe(true);
  });
});

describe("控除のルール", () => {
  it("10 と入れたら 10%。10 月の当たり方は明細の計算と同じ（ロイヤリティ 8人・241,060円）", async () => {
    const impact = await ruleImpact(db, A, DEMO_MONTH);
    const royalty = await ruleByName(A, "ロイヤリティ");
    const fee = await ruleByName(A, "管理費");
    const lease = await ruleByName(A, "車両リース");
    expect(impact.get(royalty.id)).toMatchObject({ drivers: 8, total: 241060 });
    expect(impact.get(fee.id)).toMatchObject({ drivers: 8, total: 120000 });
    expect(impact.get(lease.id)).toMatchObject({ drivers: 1, total: 32000, names: ["遠藤 大輔"] });

    const endo = await driverByCode(A, "D04");
    const insurance = await createRule(db, A, ruleSchema.parse({ name: "保険", driverId: endo.id, kind: "fixed", value: "3,000", onlyWhenWorked: "on", agreedInWriting: "on", agreedOn: "2026-05-01", basis: "車両保険の覚書", active: "on", sort: "5" }));
    expect(insurance).toMatchObject({ amount: 3000, rate: null, taxable: false, driverId: endo.id, sort: 5 });
    const pct = await createRule(db, A, ruleSchema.parse({ name: "事務手数料", kind: "percent", value: "２", taxable: "on", active: "on" }));
    expect(pct.rate).toBe(0.02);
    const { changed } = await updateRule(db, A, pct.id, ruleSchema.parse({ name: "事務手数料", kind: "percent", value: "1.5", taxable: "on", active: "on" }));
    expect(changed.rate).toEqual({ from: 0.02, to: 0.015 });
    await deleteRule(db, A, pct.id);
    expect(await ruleByName(A, "事務手数料")).toBeUndefined();

    // 同じ名前・同じ当て先の控除は二重に引かれるので止める（使わないものなら足せるが、戻すときに止める）
    expect(await failure(createRule(db, A, ruleSchema.parse({ name: "ろいやりてぃ", kind: "percent", value: "8", active: "on" })))).toContain("同じ名前の控除");
    const spare = await createRule(db, A, ruleSchema.parse({ name: "管理費", kind: "fixed", value: "5000" }));
    expect(await failure(setRuleActive(db, A, spare.id, true))).toContain("二重に引かれます");
    await deleteRule(db, A, spare.id);
    // この人だけのロイヤリティは足せる（全員の分と両方が引かれることは画面で知らせる）
    const personal = await createRule(db, A, ruleSchema.parse({ name: "ロイヤリティ", driverId: endo.id, kind: "percent", value: "2", active: "on" }));
    await deleteRule(db, A, personal.id);

    // 別の会社のドライバーだけに当てることはできない
    const bDriver = await driverByCode(B, "D01");
    expect(await failure(createRule(db, A, ruleSchema.parse({ name: "x", driverId: bDriver.id, kind: "fixed", value: "1" })))).toContain("見つかりません");
  });

  it("明細に使ったルールは消さない（使わないにする）。別の会社からは変えられない", async () => {
    const royalty = await ruleByName(A, "ロイヤリティ");
    expect((await usedRuleIds(db, A)).has(royalty.id)).toBe(false);
    await generateStatements(db, A, DEMO_MONTH);
    expect((await usedRuleIds(db, A)).has(royalty.id)).toBe(true);
    expect(await failure(deleteRule(db, A, royalty.id))).toContain("支払明細 8件");
    expect(await failure(setRuleActive(db, B, royalty.id, false))).toContain("見つかりません");
    expect(await failure(deleteRule(db, B, royalty.id))).toContain("見つかりません");
    await setRuleActive(db, A, royalty.id, false);
    expect((await listRules(db, A)).find((r) => r.id === royalty.id)!.active).toBe(false);
    await setRuleActive(db, A, royalty.id, true);
  });

  it("締めた月は、明細の写しで実際に引いた額を数える（ルールを変えても変わらない）", async () => {
    const royalty = await ruleByName(A, "ロイヤリティ");
    await db.insert(s.monthCloses).values({ tenantId: A, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    await updateRule(db, A, royalty.id, ruleSchema.parse({ name: "ロイヤリティ", kind: "percent", value: "20", onlyWhenWorked: "on", taxable: "on", agreedInWriting: "on", active: "on", sort: "1" }));
    expect((await ruleImpact(db, A, DEMO_MONTH)).get(royalty.id)).toMatchObject({ drivers: 8, total: 241060 });
    // 締めた 9 月は明細の写しが無いので 0 件
    expect((await ruleImpact(db, A, DEMO_PREV_MONTH)).size).toBe(0);
    // 締めていない会社 B の 10 月は、今のルールで計算する（B は 10% のまま）
    const royaltyB = await ruleByName(B, "ロイヤリティ");
    expect((await ruleImpact(db, B, DEMO_MONTH)).get(royaltyB.id)).toMatchObject({ drivers: 8, total: 241060 });
    await db.delete(s.monthCloses).where(and(eq(s.monthCloses.tenantId, A), eq(s.monthCloses.month, DEMO_MONTH)));
    await updateRule(db, A, royalty.id, ruleSchema.parse({ name: "ロイヤリティ", kind: "percent", value: "10", onlyWhenWorked: "on", taxable: "on", agreedInWriting: "on", active: "on", sort: "1" }));
  });
});

describe("利用者", () => {
  it("最後のオーナーは外せない・止められない。自分は止められない", async () => {
    const [owner] = (await usersOf(A)).filter((u) => u.role === "owner");
    const [staff] = (await usersOf(A)).filter((u) => u.role === "staff");
    expect(await failure(changeUserRole(db, A, owner.id, "staff"))).toContain("オーナーが 1 人もいなくなる");
    expect(await failure(setUserDisabled(db, A, staff.id, owner.id, true))).toContain("オーナーが 1 人もいなくなる");
    expect(await failure(setUserDisabled(db, A, owner.id, owner.id, true))).toContain("自分自身");

    // 事務をオーナーにしてから、元のオーナーを外す → 今度は新しいオーナーが最後の 1 人
    await changeUserRole(db, A, staff.id, "owner");
    const r = await changeUserRole(db, A, owner.id, "viewer");
    expect(r).toMatchObject({ changed: true, after: { role: "viewer" } });
    expect(await failure(changeUserRole(db, A, staff.id, "staff"))).toContain("オーナーが 1 人もいなくなる");
    await changeUserRole(db, A, owner.id, "owner");
    await changeUserRole(db, A, staff.id, "staff");
    expect((await listUsers(db, A)).map((u) => u.role)).toEqual(["owner", "staff"]);
  });

  it("止めるとログインも切れる。再開できる。別の会社の人は変えられない", async () => {
    const [owner] = (await usersOf(A)).filter((u) => u.role === "owner");
    const [staff] = (await usersOf(A)).filter((u) => u.role === "staff");
    await db.insert(s.sessions).values({ id: sha256("staff-session"), userId: staff.id, tenantId: A, expiresAt: new Date(Date.now() + 3600_000) });
    await setUserDisabled(db, A, owner.id, staff.id, true);
    expect((await usersOf(A)).find((u) => u.id === staff.id)!.disabledAt).toBeInstanceOf(Date);
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, staff.id))).toHaveLength(0);
    await setUserDisabled(db, A, owner.id, staff.id, false);
    expect((await usersOf(A)).find((u) => u.id === staff.id)!.disabledAt).toBeNull();

    const [ownerB] = (await usersOf(B)).filter((u) => u.role === "owner");
    expect(await failure(changeUserRole(db, A, ownerB.id, "viewer"))).toContain("見つかりません");
    expect(await failure(setUserDisabled(db, A, owner.id, ownerB.id, true))).toContain("見つかりません");
    expect((await usersOf(B)).find((u) => u.id === ownerB.id)).toMatchObject({ role: "owner", disabledAt: null });
  });

  it("招待：使っている人・ほかで使われているアドレスは止める。止めた人は役割をそろえて再開の招待に", async () => {
    expect(await failure(prepareInvite(db, A, { name: "x", email: "staff@demo.example", role: "viewer" }))).toContain("ほかで使われて");
    const [staff] = (await usersOf(A)).filter((u) => u.role === "staff");
    await db.update(s.users).set({ email: "only-a@example.test" }).where(eq(s.users.id, staff.id));
    expect(await failure(prepareInvite(db, A, { name: "x", email: "only-a@example.test", role: "viewer" }))).toContain("もう利用者です");
    await db.update(s.users).set({ disabledAt: new Date() }).where(eq(s.users.id, staff.id));
    expect(await prepareInvite(db, A, { name: "x", email: "only-a@example.test", role: "viewer" })).toEqual({ reactivates: true });
    expect((await usersOf(A)).find((u) => u.id === staff.id)!.role).toBe("viewer");
    await db.update(s.users).set({ disabledAt: null, role: "staff", email: "staff@demo.example" }).where(eq(s.users.id, staff.id));

    // 招待の一覧・取り消し（古い招待は、同じアドレスへ招待し直すと使えなくなる）
    const future = new Date(Date.now() + 7 * 24 * 3600_000);
    await db.insert(s.invites).values({ tokenHash: sha256("invite-1"), tenantId: A, email: "new@example.test", name: "新しい人", role: "staff", expiresAt: future });
    expect((await listPendingInvites(db, A)).map((i) => i.email)).toEqual(["new@example.test"]);
    expect(await listPendingInvites(db, B)).toEqual([]);
    expect(await prepareInvite(db, A, { name: "新しい人", email: "new@example.test", role: "viewer" })).toEqual({ reactivates: false });
    expect(await listPendingInvites(db, A)).toEqual([]);

    await db.insert(s.invites).values({ tokenHash: sha256("invite-2"), tenantId: A, email: "two@example.test", name: "2 人目", role: "viewer", expiresAt: future });
    expect(await failure(revokeInvite(db, B, sha256("invite-2")))).toContain("見つかりません");
    expect((await listPendingInvites(db, A)).map((i) => i.email)).toEqual(["two@example.test"]);
    await revokeInvite(db, A, sha256("invite-2"));
    expect(await listPendingInvites(db, A)).toEqual([]);
  });
});

describe("会社の設定と AI の同意", () => {
  it("列と settings を保存し、ほかの設定（AI の同意など）は残す。別の会社は変わらない", async () => {
    await setAiConsent(db, A, true);
    const input = companySchema.parse({
      name: "サンプル運送株式会社（架空）",
      registrationNo: "1234567890123",
      taxMethod: "general",
      payTaxToExempt: "on",
      taxRounding: "floor",
      amountRounding: "round",
      closingDay: "0",
      payMonthOffset: "1",
      payDay: "20",
      paymentTermsText: "毎月末日締め・翌月20日払い",
      transferFeeBearer: "company",
      capitalYen: "10,000,000",
      employees: "",
      deemedConfirmDays: "10",
      statementNote: "",
      requesterCode: "1234567890",
      requesterName: "ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ",
      requesterBankCode: "0001",
      requesterBankName: "みずほ",
      requesterBranchCode: "001",
      requesterBranchName: "ほんてん",
      requesterAccountType: "ordinary",
      requesterAccountNumber: "654321",
    });
    const { after, changed } = await updateCompany(db, A, input);
    expect(after).toMatchObject({ registrationNo: "T1234567890123", payDay: 20 });
    expect(after.settings).toMatchObject({
      aiAssistConsent: true,
      paymentTermsText: "毎月末日締め・翌月20日払い",
      transferFeeBearer: "company",
      capitalYen: 10_000_000,
      deemedConfirmDays: 10,
      statementNote: "記載内容に誤りがある場合は、受け取りから10日以内にご連絡ください。ご連絡がない場合は、内容を確認いただいたものとします。",
      requester: { accountNumber: "0654321", bankNameKana: "ﾐｽﾞﾎ", branchNameKana: "ﾎﾝﾃﾝ" },
    });
    expect(after.settings.employees).toBeUndefined();
    expect(changed.payDay).toEqual({ from: 25, to: 20 });
    // 支払日の変更は明細の支払日に出る
    const drafts = buildStatementDrafts(await loadBuildInput(db, A, DEMO_MONTH));
    expect(drafts[0].payDate).toBe("2026-11-20");
    expect(drafts[0].note).toContain("10日以内");

    const [tB] = await db.select().from(s.tenants).where(eq(s.tenants.id, B));
    expect(tB).toMatchObject({ payDay: 25 });
    // 注記が空の会社の明細には、設定の画面が見本に出す 7 日の文と同じ文が入る
    expect(buildStatementDrafts(await loadBuildInput(db, B, DEMO_MONTH))[0].note).toBe(deemedNote(7));
    expect(tB.settings.aiAssistConsent).toBeUndefined();
  });

  it("AI の同意：既定は無し。変えた記録を新しい順に出す（会社ごと）", async () => {
    const [owner] = (await usersOf(B)).filter((u) => u.role === "owner");
    expect(await setAiConsent(db, B, true)).toEqual({ before: false, after: true });
    await audit(db, { tenantId: B, userId: owner.id, action: AI_CONSENT_ACTION, entity: "tenant", entityId: B, detail: { on: true } });
    expect(await setAiConsent(db, B, false)).toEqual({ before: true, after: false });
    await audit(db, { tenantId: B, userId: owner.id, action: AI_CONSENT_ACTION, entity: "tenant", entityId: B, detail: { on: false } });
    const h = await aiConsentHistory(db, B);
    expect(h.map((x) => x.on)).toEqual([false, true]);
    expect(h[0].by).toBe("デモ 社長");
    expect(await aiConsentHistory(db, A)).toEqual([]);
  });

  it("はじめの画面のまとめ", async () => {
    const o = await settingsOverview(db, B);
    expect(o.drivers).toMatchObject({ active: 9, noBank: 2, noTerms: 2, unregistered: 4 });
    expect(o.projects).toMatchObject({ active: 5, loss: 0 });
    expect(o.rules).toMatchObject({ active: 4, notAgreed: 1 });
    expect(o.company.payRule).toBe("毎月末日締め・翌月25日払い");
    expect(o.company.missing).toEqual(["支払期日の文言"]);
  });
});
