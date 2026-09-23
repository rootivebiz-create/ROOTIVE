import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { loadCompanyForm, loadOnboarding, saveCompanyBasics, setOnboardingStep, ONBOARDING_STEPS } from "~/server/features/onboarding";
import { checkCompanyBasics, SIZE_REASON } from "~/server/features/onboarding/company";
import { onboardingProgress } from "~/server/features/onboarding/steps";
import { driverTermsFlags } from "~/server/features/onboarding/terms";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";
import type { Db } from "~/db/client";

async function driverId(db: Db, tenantId: string, code: string): Promise<string> {
  const [d] = await db.select({ id: s.drivers.id }).from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d.id;
}

const baseInput = { closingDay: "0", payMonthOffset: "1", payDay: "25", transferFeeBearer: "company", registrationNo: "", taxMethod: "general", paymentTermsText: "" };

describe("最初の設定：取引条件の明示の手順", () => {
  it("順番と時間の目安：控除のルールのあと、先月の Excel の前。/terms を開く。全部で約65分", () => {
    expect(ONBOARDING_STEPS.map((x) => x.key)).toEqual(["company", "drivers", "projects", "rules", "terms", "import", "parallel"]);
    const terms = ONBOARDING_STEPS.find((x) => x.key === "terms")!;
    expect(terms).toMatchObject({ no: 5, title: "取引条件の明示", path: "/terms", minutes: 10 });
    expect(ONBOARDING_STEPS.map((x) => x.no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ONBOARDING_STEPS.reduce((a, x) => a + x.minutes, 0)).toBe(65);
  });

  it("有効な人の全員に記録（明示書か明示した日）があれば済み。辞めた人は数えない。「あとで」でも進む。ほかの会社の記録は効かない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const endo = await driverId(db, tenantId, "D04");

    // デモ：遠藤さん（D04）だけ記録が無い → まだ。残っていることを名前つきで出す
    let p = await loadOnboarding(db, tenantId);
    let step = p.steps.find((x) => x.def.key === "terms")!;
    expect(step.state).toBe("todo");
    expect(step.note).toBeNull();
    expect(step.pending).toBe("取引条件を明示した記録（明示書か、明示した日）が見つからない人が 1人います（有効な 8人のうち）：遠藤 大輔さん");
    expect(p.next?.key).toBe("terms");
    expect(p).toMatchObject({ doneCount: 5, total: 7, minutesLeft: 20 });
    // ホームのように、読んだものを渡しても同じ（読み直さない）
    const [t0] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(await loadOnboarding(db, tenantId, { onboarding: t0.onboarding, termsFlags: driverTermsFlags(db, tenantId) })).toEqual(p);

    // ほかの会社の遠藤さんに明示書を作っても、この会社は変わらない
    await db.insert(s.termsRecords).values({ tenantId: otherId, driverId: await driverId(db, otherId, "D04"), version: 1, issuedOn: "2026-05-01", content: {} });
    expect((await loadOnboarding(db, tenantId)).steps.find((x) => x.def.key === "terms")!.state).toBe("todo");
    expect((await loadOnboarding(db, otherId)).steps.find((x) => x.def.key === "terms")!.state).toBe("auto");

    // この会社の遠藤さんの明示書を作る → 済み（データから）。次は Excel と比べる
    await db.insert(s.termsRecords).values({ tenantId, driverId: endo, version: 1, issuedOn: "2026-05-01", content: {} });
    p = await loadOnboarding(db, tenantId);
    step = p.steps.find((x) => x.def.key === "terms")!;
    expect(step).toMatchObject({ state: "auto", note: "有効なドライバー 8人の全員に、取引条件の記録があります", pending: null });
    expect(p.next?.key).toBe("parallel");
    expect(p.doneCount).toBe(6);

    // 明示した日を消した人が出る → まだに戻る
    const kimura = await driverId(db, tenantId, "D07");
    await db.update(s.drivers).set({ termsIssuedOn: null }).where(and(eq(s.drivers.id, kimura), eq(s.drivers.tenantId, tenantId)));
    step = (await loadOnboarding(db, tenantId)).steps.find((x) => x.def.key === "terms")!;
    expect(step.state).toBe("todo");
    expect(step.pending).toContain("木村 誠さん");

    // 辞めた人（有効でない）は数えない
    await db.update(s.drivers).set({ active: false }).where(and(eq(s.drivers.id, kimura), eq(s.drivers.tenantId, tenantId)));
    step = (await loadOnboarding(db, tenantId)).steps.find((x) => x.def.key === "terms")!;
    expect(step).toMatchObject({ state: "auto", note: "有効なドライバー 7人の全員に、取引条件の記録があります" });

    // 「あとで」にすると、記録が無くても進む（案内の「済み・あとで」に数える）
    await db.update(s.drivers).set({ active: true }).where(and(eq(s.drivers.id, kimura), eq(s.drivers.tenantId, tenantId)));
    await setOnboardingStep(db, tenantId, "terms", "skipped", null);
    p = await loadOnboarding(db, tenantId);
    step = p.steps.find((x) => x.def.key === "terms")!;
    expect(step.state).toBe("skipped");
    expect(step.pending).toContain("木村 誠さん");
    expect(p.next?.key).toBe("parallel");
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "onboarding.step")));
    expect(log.detail).toMatchObject({ step: "terms", mark: "skipped" });
    await client.close();
  });

  it("純関数：人数を渡さない古い呼び方では、取引条件の手順をデータから決めない。有効な人がいないときも済みにしない", () => {
    const facts = { drivers: 3, projects: 1, rules: 1, workEntries: 1, parallelChecks: 0 };
    expect(onboardingProgress({}, facts).steps.find((x) => x.def.key === "terms")).toMatchObject({ state: "todo", note: null, pending: null });
    expect(onboardingProgress({}, { ...facts, activeDrivers: 0, driversWithoutTerms: [] }).steps.find((x) => x.def.key === "terms")?.state).toBe("todo");
    expect(onboardingProgress({}, { ...facts, activeDrivers: 3, driversWithoutTerms: [] }).steps.find((x) => x.def.key === "terms")?.state).toBe("auto");
    const many = onboardingProgress({}, { ...facts, activeDrivers: 9, driversWithoutTerms: ["あ", "い", "う", "え", "お"] }).steps.find((x) => x.def.key === "terms");
    expect(many?.pending).toBe("取引条件を明示した記録（明示書か、明示した日）が見つからない人が 5人います（有効な 9人のうち）：あさん・いさん・うさん ほか 2人");
  });
});

describe("最初の設定：会社の大きさ（資本金・常時使用する従業員の数）", () => {
  it("全角・カンマ・「万」「億」「円」「人」入りでも読む。空は消す。読めない数は項目の誤り", () => {
    const read = (capitalYen: string, employees: string) => checkCompanyBasics({ ...baseInput, capitalYen, employees });
    expect(read("1,000万円", "１２人").value).toMatchObject({ capitalYen: 10_000_000, employees: 12 });
    expect(read("３億", "300").value).toMatchObject({ capitalYen: 300_000_000, employees: 300 });
    expect(read("￥50,000,000", " 45 ").value).toMatchObject({ capitalYen: 50_000_000, employees: 45 });
    expect(read("1.5億", "0").value).toMatchObject({ capitalYen: 150_000_000, employees: 0 });
    expect(read("", "").value).toMatchObject({ capitalYen: null, employees: null });
    // 小数の「万」「億」（1.1 × 10000 は 11000.000000000002 になるが、1 円未満のずれは丸めて読む）と、億と万の組み合わせ
    expect(read("1.1万", "1").value).toMatchObject({ capitalYen: 11_000 });
    expect(read("1.15億円", "1").value).toMatchObject({ capitalYen: 115_000_000 });
    expect(read("1億5000万円", "1").value).toMatchObject({ capitalYen: 150_000_000 });
    expect(read("1万2000", "1").value).toMatchObject({ capitalYen: 12_000 });
    expect(read("¥3,000,000円", "1").value).toMatchObject({ capitalYen: 3_000_000 });
    expect(read("1.23456万", "1").fieldErrors.capitalYen).toBeTruthy();
    expect(read("万", "1").fieldErrors.capitalYen).toBeTruthy();
    // 聞いていない（古い呼び方）ときは変えない
    const old = checkCompanyBasics(baseInput).value!;
    expect("capitalYen" in old).toBe(false);
    expect("employees" in old).toBe(false);

    const bad = read("たくさん", "12.5");
    expect(bad.value).toBeNull();
    expect(Object.keys(bad.fieldErrors).sort()).toEqual(["capitalYen", "employees"]);
    expect(bad.fieldErrors.capitalYen).toContain("分からなければ空のままで構いません");
    expect(read("-1", "3").fieldErrors.capitalYen).toBeTruthy();
    expect(read("2000000000000", "3").fieldErrors.capitalYen).toBeTruthy();
    expect(read("1000", "1000001").fieldErrors.employees).toBeTruthy();
    expect(SIZE_REASON).toBe("取適法の対象かの目安に使います");
  });

  it("保存：settings の capitalYen・employees に入れ、ほかの設定（振込依頼人）は残す。空にすると消す。ほかの会社は変わらない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const v = checkCompanyBasics({ ...baseInput, capitalYen: "1000万", employees: "12" }).value!;
    await saveCompanyBasics(db, tenantId, v, null);
    let [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t.settings).toMatchObject({ capitalYen: 10_000_000, employees: 12, transferFeeBearer: "company" });
    expect(t.settings.requester?.code).toBe("1234567890");
    expect(await loadCompanyForm(db, tenantId)).toMatchObject({ capitalYen: 10_000_000, employees: 12 });
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "onboarding.company")));
    expect(log.detail).toMatchObject({ before: { capitalYen: null, employees: null }, after: { capitalYen: 10_000_000, employees: 12 } });

    // 聞いていない保存（古い呼び方）では変えない
    await saveCompanyBasics(db, tenantId, checkCompanyBasics(baseInput).value!, null);
    [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t.settings).toMatchObject({ capitalYen: 10_000_000, employees: 12 });

    // 空にすると消す
    await saveCompanyBasics(db, tenantId, checkCompanyBasics({ ...baseInput, capitalYen: "", employees: "" }).value!, null);
    [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t.settings.capitalYen).toBeUndefined();
    expect(t.settings.employees).toBeUndefined();
    expect(await loadCompanyForm(db, tenantId)).toMatchObject({ capitalYen: null, employees: null });

    // ほかの会社は変わらない
    const [o] = await db.select().from(s.tenants).where(eq(s.tenants.id, otherId));
    expect(o.settings.capitalYen).toBeUndefined();
    await client.close();
  });
});
