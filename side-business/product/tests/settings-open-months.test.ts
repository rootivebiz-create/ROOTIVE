import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { closeMonth } from "~/server/features/close";
import {
  compareMonthTotals,
  impactKey,
  impactMessage,
  OPEN_MONTHS_FIELD,
  OPEN_MONTHS_HINT,
  OpenMonthsChanged,
  openMonthsWithData,
  runSettingsAction,
  withOpenMonthCheck,
} from "~/server/features/settings/open-months";
import { messageKey } from "~/server/features/settings/open-months-key";
import { updateProject } from "~/server/features/settings/projects";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 単価・控除には「いつの分から」の区別が無い。まだ締めていない月の明細（見込み）が変わる変更は、
 * 変わる月・人数・額を見せ、利用者が「反映する」を選んだときだけ保存する（選ばなければ何も変えない）。
 */
const state: { db?: Db; user?: SessionUser } = {};

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe("まだ締めていない月への影響（純関数）", () => {
  it("人ごとの振込額の見込みを比べ、変わる月だけを返す（増える変更も出す）", () => {
    const before = new Map([
      ["2026-10-01", new Map([["a", { name: "青木", total: 1000 }], ["b", { name: "井上", total: 500 }]])],
      ["2026-11-01", new Map([["a", { name: "青木", total: 800 }]])],
    ]);
    const after = new Map([
      ["2026-10-01", new Map([["a", { name: "青木", total: 1200 }], ["b", { name: "井上", total: 500 }]])],
      ["2026-11-01", new Map([["a", { name: "青木", total: 800 }]])],
    ]);
    const impact = compareMonthTotals(["2026-10-01", "2026-11-01"], before, after);
    expect(impact).toEqual([{ month: "2026-10-01", drivers: 1, diff: 200, names: ["青木"] }]);
    expect(impactKey(impact)).toMatch(/^[0-9a-f]{8}$/);
    // 画面は、返ってきた説明の文から同じ値を作って送り返す
    expect(messageKey(impactMessage(impact))).toBe(impactKey(impact));
    expect(impactKey(impact)).not.toBe(impactKey([{ ...impact[0], diff: 201 }]));
    const msg = impactMessage(impact);
    expect(msg).toContain("2026年10月分：1人・振込額の合計 ＋200円（青木さん）");
    expect(msg).not.toContain("\n");
    expect(msg).toContain("まだ保存していません");
    expect(msg).toContain("先にその月を締めてから");
    // 明細が無くなる・新しくできる人も「変わる」に数える
    const gone = compareMonthTotals(["2026-10-01"], before, new Map([["2026-10-01", new Map([["a", { name: "青木", total: 1000 }]])]]));
    expect(gone).toEqual([{ month: "2026-10-01", drivers: 1, diff: -500, names: ["井上"] }]);
  });

  it("印の値は、同じ文なら同じ・違う文なら違う（16 進 8 桁）", () => {
    expect(messageKey("あいう")).toBe(messageKey("あいう"));
    expect(messageKey("あいう")).not.toBe(messageKey("あいえ"));
    expect(messageKey("")).toMatch(/^[0-9a-f]{8}$/);
    expect(OPEN_MONTHS_FIELD).toBe("confirmOpenMonths");
  });
});

describe("単価・控除を変えるときの確かめ", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherId: string;
  let spotId: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    state.db = db;
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    const staff = users.find((u) => u.role === "staff")!;
    state.user = { id: staff.id, tenantId, email: staff.email, name: staff.name, role: "staff" };
    const [spot] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "スポット便")));
    spotId = spot.id;
  });
  afterAll(async () => client.close());

  const projectInput = (payRate: number, billRate = 9000) => ({
    clientId: null as string | null,
    name: "スポット便",
    aliases: ["スポット"],
    unit: "件",
    billRate,
    payRate,
    active: true,
  });

  it("締めた月は比べない（締めていない月だけ）", async () => {
    expect(await openMonthsWithData(db, tenantId)).toEqual([DEMO_MONTH]);
  });

  it("支払単価を上げる変更：まだ締めていない月の明細が変わるので、印が無ければ保存しない（取り消す）", async () => {
    const [p] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    let caught: unknown;
    try {
      await withOpenMonthCheck(db, tenantId, null, (t) => updateProject(t, tenantId, spotId, { ...projectInput(7500), clientId: p.clientId }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OpenMonthsChanged);
    const e = caught as OpenMonthsChanged;
    expect(e.impact).toHaveLength(1);
    expect(e.impact[0]).toMatchObject({ month: DEMO_MONTH, drivers: 2 });
    expect([...e.impact[0].names].sort()).toEqual(["遠藤 大輔", "青木 翔太"].sort());
    expect(e.impact[0].diff).toBeGreaterThan(0);
    // 何も変わっていない
    const [still] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    expect(still.payRate).toBe(7000);

    // 印が画面で見た影響と同じなら保存する
    const ok = await withOpenMonthCheck(db, tenantId, e.key, (t) => updateProject(t, tenantId, spotId, { ...projectInput(7500), clientId: p.clientId }));
    expect(ok.impact).toEqual(e.impact);
    const [saved] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    expect(saved.payRate).toBe(7500);
  });

  it("明細が変わらない変更（受注単価だけ）は、印なしで保存する", async () => {
    const [p] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    const r = await withOpenMonthCheck(db, tenantId, null, (t) => updateProject(t, tenantId, spotId, { ...projectInput(7500, 9500), clientId: p.clientId }));
    expect(r.impact).toEqual([]);
    expect((await db.select().from(s.projects).where(eq(s.projects.id, spotId)))[0].billRate).toBe(9500);
  });

  it("画面から：変わる月と額を返し「反映する」の印の欄を出させる。印を付けて送り直すと保存し、操作の記録に反映した月を残す", async () => {
    const { updateProjectAction } = await import("~/app/(app)/settings/projects/actions");
    const [p] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    const form = (extra: Record<string, string> = {}) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ id: spotId, name: "スポット便", clientId: p.clientId ?? "", unit: "件", aliases: "スポット", billRate: "9500", payRate: "7200", ...extra })) f.set(k, v);
      return f;
    };
    const first = await updateProjectAction(undefined, form());
    expect(first?.ok).toBe(false);
    if (!first || first.ok) throw new Error("unexpected");
    expect(first.error).toContain("2026年10月分：2人・振込額の合計 −");
    expect(first.fieldErrors?.[OPEN_MONTHS_FIELD]).toContain("上の月の明細にも反映する");
    // 画面の「上の月の明細にも反映する」の印は、説明の文から作った値を送る
    const key = messageKey(first.error);
    expect((await db.select().from(s.projects).where(eq(s.projects.id, spotId)))[0].payRate).toBe(7500);

    // 画面で見た説明と違う印（見たあとに影響が変わった）では保存しない
    const stale = await updateProjectAction(undefined, form({ [OPEN_MONTHS_FIELD]: "00000000" }));
    expect(stale?.ok).toBe(false);
    expect((await db.select().from(s.projects).where(eq(s.projects.id, spotId)))[0].payRate).toBe(7500);
    const second = await updateProjectAction(undefined, form({ [OPEN_MONTHS_FIELD]: key }));
    expect(second).toMatchObject({ ok: true });
    expect((await db.select().from(s.projects).where(eq(s.projects.id, spotId)))[0].payRate).toBe(7200);
    const [log] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "project.update"), eq(s.auditLog.entityId, spotId)));
    expect(log.detail.openMonths).toEqual([expect.objectContaining({ month: DEMO_MONTH, drivers: 2 })]);
  });

  it("控除のルールを足す・止めるときも同じ（ドライバー別の単価も）", async () => {
    const { createRuleAction, setRuleActiveAction } = await import("~/app/(app)/settings/rules/actions");
    const f = new FormData();
    for (const [k, v] of Object.entries({ name: "事務手数料", kind: "fixed", value: "1000", onlyWhenWorked: "on", agreedInWriting: "on", agreedOn: "2026-04-01", basis: "業務委託契約", active: "on" }))
      f.set(k, v);
    const first = await createRuleAction(undefined, f);
    expect(first?.ok).toBe(false);
    if (!first || first.ok) throw new Error("unexpected");
    expect(first.error).toContain("2026年10月分：");
    expect(await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "事務手数料")))).toHaveLength(0);
    f.set(OPEN_MONTHS_FIELD, messageKey(first.error));
    expect(await createRuleAction(undefined, f)).toMatchObject({ ok: true });
    const [rule] = await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "事務手数料")));
    expect(rule).toBeTruthy();

    const stop = new FormData();
    stop.set("id", rule.id);
    stop.set("active", "0");
    const asked = await setRuleActiveAction(undefined, stop);
    expect(asked?.ok).toBe(false);
    expect((await db.select().from(s.deductionRules).where(eq(s.deductionRules.id, rule.id)))[0].active).toBe(true);

    // 他社の設定を変えても、この会社の確かめには出ない（会社ごと）
    const [otherSpot] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, otherId), eq(s.projects.name, "スポット便")));
    await db.update(s.projects).set({ payRate: 1 }).where(eq(s.projects.id, otherSpot.id));
    const again = await setRuleActiveAction(undefined, stop);
    if (!again || again.ok || !asked || asked.ok) throw new Error("unexpected");
    expect(again.error).toBe(asked.error);
  });

  it("締めてあれば、その月は変わらないので聞かない", async () => {
    await closeMonth(db, tenantId, DEMO_MONTH, null, { runWatch: async () => [] });
    expect(await openMonthsWithData(db, tenantId)).toEqual([]);
    const [p] = await db.select().from(s.projects).where(eq(s.projects.id, spotId));
    const r = await withOpenMonthCheck(db, tenantId, null, (t) => updateProject(t, tenantId, spotId, { ...projectInput(8000, 9500), clientId: p.clientId }));
    expect(r.impact).toEqual([]);
    expect(DEMO_PREV_MONTH < DEMO_MONTH).toBe(true);
  });

  it("runSettingsAction：確かめが要るときは、説明と印を返す（ほかの誤りはいつもどおり）", async () => {
    const impact = [{ month: DEMO_MONTH, drivers: 1, diff: 100, names: ["青木 翔太"] }];
    const r = await runSettingsAction(async () => {
      throw new OpenMonthsChanged(impact);
    }, "保存しました");
    expect(r).toEqual({ ok: false, error: impactMessage(impact), fieldErrors: { [OPEN_MONTHS_FIELD]: OPEN_MONTHS_HINT } });
    expect(await runSettingsAction(async () => 1, "保存しました")).toEqual({ ok: true, message: "保存しました", data: 1 });
  });
});
