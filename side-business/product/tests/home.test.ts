import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { closeMonth } from "~/server/features/close";
import { homeView, loadHomeStatus, type HomeStatus } from "~/server/features/home";
import { createTransferBatch, setTransferExecutedOn } from "~/server/features/transfer";
import type { WatchIssue } from "~/server/features/watch-types";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** 見張り番は別の機能なので、ここでは差し替える（何も出さない／赤を 1 つ出す） */
const quiet = { runWatch: async () => [] as WatchIssue[] };
const redIssue: WatchIssue = {
  code: "terms_missing",
  severity: "red",
  title: "取引条件を明示した記録がありません",
  detail: "遠藤 大輔さんの取引条件の記録が見つかりません",
  subjectId: "x",
  subjectLabel: "遠藤 大輔",
  acked: false,
  blocksClose: true,
};

const view = (st: HomeStatus, canEdit = true) => homeView(st, { canEdit });

describe("ホーム（今月の締め）", () => {
  it("10 月：明細がまだ → 次は明細を作る。作る → 送る → 振込 → 締め → 振り込んだ日 → 済み", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);

    let st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.closed).toBe(false);
    expect(st.work).toMatchObject({ entries: 11, drivers: 8, adjustments: 2, latestBatch: null, openDrafts: [] });
    expect(st.statements).toMatchObject({ expected: 8, saved: 0, missing: 8, upToDate: false });
    // 金額はデモの 10 月の計算そのもの
    expect(st.totals).toEqual({ drivers: 8, total: 2_206_094, source: "calc" });
    expect(st.profit).toEqual({ sales: 3_013_300, subtotal: 2_410_600, profit: 980_270, source: "calc" });
    let v = view(st);
    expect(v.title).toBe("2026年10月分の締め");
    expect(v.steps.map((x) => x.done)).toEqual([true, true, false, false, false]);
    expect(v.next).toMatchObject({ stepKey: "statements", label: "明細を作る（8人）", href: "/statements?m=2026-10", canAct: true });
    expect(v.steps.find((x) => x.current)?.key).toBe("statements");
    expect(v.steps[0].lines[0]).toBe("稼働 11 件（8人）・調整 2 件");
    expect(v.steps[2].badge).toBe("未作成");

    // 見張り番に赤があれば、そちらが先
    const red = await loadHomeStatus(db, tenantId, DEMO_MONTH, { runWatch: async () => [redIssue] });
    expect(red.watch).toMatchObject({ red: 1, yellow: 0 });
    expect(view(red).next).toMatchObject({ stepKey: "watch", label: "見張り番の赤い指摘を確かめる（1 件）", href: "/watch?m=2026-10" });
    expect(view(red).steps[1].lines).toContain("・取引条件を明示した記録がありません（遠藤 大輔）");
    // 見張り番が動かなくても、ホームは開ける
    const broken = await loadHomeStatus(db, tenantId, DEMO_MONTH, {
      runWatch: async () => {
        throw new Error("boom");
      },
    });
    expect(broken.watch.error).toContain("見張り番を動かせませんでした");
    expect(view(broken).next?.stepKey).toBe("watch");

    // 明細を作る → 次は「送る」
    await generateStatements(db, tenantId, DEMO_MONTH);
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.statements).toMatchObject({ saved: 8, upToDate: true, unsent: 8, confirmed: 0, openQuestions: 0 });
    v = view(st);
    expect(v.next).toMatchObject({ stepKey: "statements", label: "明細をドライバーへ送る（8人）", href: "/statements?m=2026-10&f=unsent" });
    expect(v.steps[2].badge).toBe("未送付 8人");

    // 閲覧の人には「見る」ボタンと、だれが進めるか
    const viewer = view(st, false).next!;
    expect(viewer).toMatchObject({ canAct: false, label: "明細の様子を見る" });
    expect(viewer.description).toContain("事務・オーナーの方が進めます");

    // 全員に送った → 次は振込
    await db.update(s.statements).set({ sentAt: new Date(Date.now() + 1000) }).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.statements).toMatchObject({ unsent: 0, sent: 8 });
    expect(view(st).next).toMatchObject({ stepKey: "transfer", label: "振込データを作る", href: "/transfer?m=2026-10" });

    // 振込データを作る（口座の無い D07 は入らない）→ 次は締め
    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, null);
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.transfer).toMatchObject({ batches: 1, people: 7, total: 2_171_664, executed: 0, changed: 0 });
    v = view(st);
    expect(v.next).toMatchObject({ stepKey: "close", label: "2026年10月を締める", href: "/close?m=2026-10" });
    expect(v.steps[3].lines[0]).toBe("1 件・7人・合計 2,171,664円");

    // 締める → 残りは「振り込んだ日を記録する」
    await closeMonth(db, tenantId, DEMO_MONTH, null, quiet);
    st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.closed).toBe(true);
    expect(st.totals).toEqual({ drivers: 8, total: 2_206_094, source: "saved" });
    expect(st.profit.profit).toBe(980_270);
    v = view(st);
    expect(v.steps[4]).toMatchObject({ badge: "締め済み", done: true });
    expect(v.next).toMatchObject({ stepKey: "executed", label: "振り込んだ日を記録する" });
    expect(v.allDone).toBe(false);

    await setTransferExecutedOn(db, tenantId, batch.id, "2026-11-25", null);
    v = view(await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet));
    expect(v.next).toBeNull();
    expect(v.allDone).toBe(true);
    await client.close();
  });

  it("9 月（締め済み・明細の保存なし）は「締め済み」で、残りの作業は無い", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const st = await loadHomeStatus(db, tenantId, DEMO_PREV_MONTH, quiet);
    expect(st.closed).toBe(true);
    expect(st.statements.saved).toBe(0);
    // 写しが無いので、今の稼働から計算した額を出す
    expect(st.totals).toEqual({ drivers: 8, total: 2_254_583, source: "calc" });
    expect(st.profit.profit).toBe(1_001_435);
    const v = view(st);
    expect(v.title).toBe("2026年9月分の締め");
    expect(v.steps.map((x) => x.badge)).toEqual(["入っています", "指摘なし", "明細なし", "明細なし", "締め済み"]);
    expect(v.next).toBeNull();
    expect(v.allDone).toBe(true);
    await client.close();
  });

  it("質問・突合の差・取り込みの様子を数える。ほかの会社のものは混ざらない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    await generateStatements(db, tenantId, DEMO_MONTH);
    const [aoki] = await db
      .select()
      .from(s.statements)
      .innerJoin(s.drivers, eq(s.drivers.id, s.statements.driverId))
      .where(and(eq(s.statements.tenantId, tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.statementMessages).values([
      { tenantId, statementId: aoki.statements.id, author: "driver", body: "スポット便が 4 件になっていますが、5 件だと思います" },
      { tenantId, statementId: aoki.statements.id, author: "driver", body: "解決済みの質問", resolvedAt: new Date() },
      { tenantId, statementId: aoki.statements.id, author: "staff", body: "確かめます" },
    ]);
    const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
    await db.insert(s.reconciliationItems).values([
      { tenantId, noticeId: notice.id, label: "宅配（個建て）", kind: "qty", ourAmount: 877_800, theirAmount: 858_800, diff: -19_000 },
      { tenantId, noticeId: notice.id, label: "夜間便", kind: "price", ourAmount: 240_000, theirAmount: 230_000, diff: -10_000, status: "resolved" },
      { tenantId, noticeId: notice.id, label: "企業配（日当）", kind: "qty", ourAmount: 1_342_000, theirAmount: 1_364_000, diff: 22_000, status: "asked" },
    ]);
    await db.insert(s.importBatches).values([
      { tenantId, month: DEMO_MONTH, fileName: "10月_稼働.xlsx", status: "applied", rowCount: 11, createdAt: new Date("2026-11-02T01:00:00Z") },
      { tenantId, month: DEMO_MONTH, fileName: "10月_追加.xlsx", status: "draft", rowCount: 2, createdAt: new Date("2026-11-03T01:00:00Z") },
      { tenantId, month: DEMO_MONTH, fileName: "取り消したもの.xlsx", status: "discarded", createdAt: new Date("2026-11-04T01:00:00Z") },
    ]);

    const st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.questions.count).toBe(1);
    expect(st.questions.items[0]).toMatchObject({ statementId: aoki.statements.id, driverName: "青木 翔太" });
    expect(st.statements.openQuestions).toBe(1);
    expect(st.reconcile).toEqual({ notices: 1, items: 3, openItems: 2, openDiff: 3_000, short: 19_000, over: 22_000 });
    expect(st.work.latestBatch).toMatchObject({ fileName: "10月_稼働.xlsx", status: "applied" });
    expect(st.work.openDrafts).toHaveLength(1);
    expect(view(st).steps[2].lines).toContain("ドライバーからの、まだ解決していない質問が 1 件あります。");

    // ほかの会社：明細も質問も突合も取り込みも無いまま
    const other = await loadHomeStatus(db, otherId, DEMO_MONTH, quiet);
    expect(other.statements).toMatchObject({ saved: 0, missing: 8 });
    expect(other.questions.count).toBe(0);
    expect(other.reconcile).toMatchObject({ notices: 1, items: 0, openItems: 0 });
    expect(other.work.latestBatch).toBeNull();
    expect(view(other).next?.label).toBe("明細を作る（8人）");

    // 稼働が無い月：次は取り込み（確認中の取り込みがあれば、それを仕上げる）
    const empty = await loadHomeStatus(db, tenantId, "2026-11-01", quiet);
    const ev = view(empty);
    expect(ev.next).toMatchObject({ stepKey: "import", label: "今の Excel を取り込む", href: "/import?m=2026-11" });
    expect(ev.steps[2].badge).toBe("稼働が入ってから");
    await db.insert(s.importBatches).values({ tenantId, month: "2026-11-01", fileName: "11月.xlsx", status: "draft" });
    const drafted = view(await loadHomeStatus(db, tenantId, "2026-11-01", quiet));
    expect(drafted.next?.label).toBe("確認中の取り込みを仕上げる");
    expect(drafted.next?.href).toMatch(/^\/import\/[0-9a-f-]{36}$/);

    await expect(loadHomeStatus(db, tenantId, "2026-13-01", quiet)).rejects.toThrow("月の指定");
    await client.close();
  });

  it("最初の設定の案内：デモは 6 つのうち 5 つ済み（控除はデータがあるので済み）。次は Excel と比べる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const st = await loadHomeStatus(db, tenantId, DEMO_MONTH, quiet);
    expect(st.onboarding).toMatchObject({ doneCount: 5, total: 6, complete: false });
    expect(st.onboarding.next?.key).toBe("parallel");
    expect(st.onboarding.steps.find((x) => x.def.key === "rules")).toMatchObject({ state: "auto", note: "控除のルール 4 件" });
    await client.close();
  });
});
