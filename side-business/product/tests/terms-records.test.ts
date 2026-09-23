import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import {
  bulkCreateTerms,
  createTermsVersion,
  filterTermsRows,
  listTerms,
  loadTermsDriver,
  markTermsSent,
  previewBulkTerms,
  recreateTermsLink,
  termsPdfSource,
  TERMS_NO_PERMISSION,
  TERMS_RACE,
  type TermsActor,
} from "~/server/features/terms";
import { readTermsContent } from "~/server/features/terms/document";
import type { TermsVersionInput } from "~/server/features/terms/schema";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取引条件の明示書：版を作る・最初に明示した日・条件の変化・まとめて作る・送る・会社の区切り・役割。
 * 「今日」は 2026-10-20（日本時間）に固定する。
 */
const NOW = new Date("2026-10-20T10:00:00+09:00");

let db: Db;
let client: PGlite;
let tenantId: string;
let otherId: string;
const ids: Record<string, string> = {};
const otherIds: Record<string, string> = {};
let staff: TermsActor;
let viewer: TermsActor;
let otherStaff: TermsActor;

async function driverIds(tid: string) {
  const rows = await db.select({ id: s.drivers.id, code: s.drivers.code }).from(s.drivers).where(eq(s.drivers.tenantId, tid));
  return Object.fromEntries(rows.map((r) => [r.code!, r.id]));
}

async function projectIds(tid: string) {
  const rows = await db.select({ id: s.projects.id, name: s.projects.name }).from(s.projects).where(eq(s.projects.tenantId, tid));
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

async function driverRow(id: string) {
  const [d] = await db.select().from(s.drivers).where(eq(s.drivers.id, id));
  return d;
}

function input(driverId: string, projects: string[], patch: Partial<TermsVersionInput> = {}): TermsVersionInput {
  return {
    driverId,
    projectIds: projects,
    serviceDescription: "貨物軽自動車を使った荷物の配送業務",
    place: "A物流 ○○センターで荷物を受け取り、指定された配送先へ届ける",
    periodFrom: "2026-05-01",
    periodTo: "",
    commissionedOn: "",
    receipt: "業務を行った日ごとに、その日の業務の完了をもって受け取ったものとします。",
    other: "",
    deemed: true,
    isSubcontract: false,
    originalClient: "",
    originalPayDate: "",
    documentName: "",
    issuedOn: "2026-10-20",
    ...patch,
  };
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(db));
  ({ tenantId: otherId } = await seedDemo(db));
  Object.assign(ids, await driverIds(tenantId));
  Object.assign(otherIds, await driverIds(otherId));
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  const [ou] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, otherId), eq(s.users.role, "staff")));
  staff = { userId: u.id, role: "staff" };
  viewer = { userId: u.id, role: "viewer" };
  otherStaff = { userId: ou.id, role: "staff" };
});
afterAll(async () => client.close());

describe("1 人の明示書（版 1 → 版 2）", () => {
  it("遠藤さん（D04）の版 1：台帳の単価・控除・具体的な支払期日が入り、最初に明示した日が入る", async () => {
    const P = await projectIds(tenantId);
    expect((await driverRow(ids.D04)).termsIssuedOn).toBeNull();

    const r = await createTermsVersion(db, tenantId, staff, input(ids.D04, [P["ルート配送（時給）"], P["スポット便"]], { commissionedOn: "2026-05-01" }), NOW);
    expect(r).toMatchObject({ version: 1, created: true, firstIssuedOnSet: true });
    expect((await driverRow(ids.D04)).termsIssuedOn).toBe("2026-10-20");

    const [rec] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.id, r.recordId));
    expect(rec).toMatchObject({ tenantId, driverId: ids.D04, version: 1, issuedOn: "2026-10-20", deemedClause: true, sentAt: null, receivedAt: null });
    const c = readTermsContent(rec.content)!;
    expect(c.services.map((x) => [x.name, x.payRate, x.unit, x.client])).toEqual([
      ["スポット便", 7000, "件", "B商事（架空）"],
      ["ルート配送（時給）", 2000, "時間", "B商事（架空）"],
    ]);
    expect(c.payment.text).toBe("毎月末日締め・翌月25日払い（支払日が金融機関の休業日のときは、その前の営業日に支払います）");
    expect(c.payment.text).not.toMatch(/まで|以内/);
    expect(c.payment.periodText).toBe("毎月1日から末日まで");
    expect(c.deductions.map((d) => [d.name, d.how, d.taxable])).toEqual([
      ["ロイヤリティ", "委託料（税抜）の 10%（稼働した月だけ）", true],
      ["管理費", "毎月 15,000円（稼働した月だけ）", true],
      ["車両リース", "毎月 32,000円（稼働が無い月も）", true],
    ]);
    expect(c.feeBearer).toBe("company");
    expect(c.deemedClause).toContain("7日以内");
    expect(c.place).toContain("○○センター");
    expect(c.period).toEqual({ from: "2026-05-01", to: null });
    expect(c.commissionedOn).toBe("2026-05-01");
    // 登録の無い方にも消費税相当額を払う会社（デモ）
    expect(c.taxNote).toContain("消費税相当額");

    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "terms.create")));
    expect(audits.some((a) => a.entityId === r.recordId)).toBe(true);
  });

  it("同じ中身で押し直しても版は増えない。画面を開いたあとでほかの人が版を作っていたら止める", async () => {
    const P = await projectIds(tenantId);
    const again = await createTermsVersion(db, tenantId, staff, input(ids.D04, [P["ルート配送（時給）"], P["スポット便"]], { commissionedOn: "2026-05-01" }), NOW);
    expect(again).toMatchObject({ version: 1, created: false });
    await expect(
      createTermsVersion(db, tenantId, staff, input(ids.D04, [P["スポット便"]], { baseVersion: 0 }), NOW),
    ).rejects.toThrow(TERMS_RACE);
  });

  it("リースの額を変えると一覧に「条件が変わっています」が出て、版 2 で差が履歴に残る。最初に明示した日は後ろへずらさない", async () => {
    const [lease] = await db.select().from(s.deductionRules).where(and(eq(s.deductionRules.tenantId, tenantId), eq(s.deductionRules.name, "車両リース")));
    await db.update(s.deductionRules).set({ amount: 30000 }).where(eq(s.deductionRules.id, lease.id));

    const list = await listTerms(db, tenantId, NOW);
    const endo = list.rows.find((r) => r.driverId === ids.D04)!;
    expect(endo.status).toBe("unsent");
    expect(endo.changes).toEqual(["控除「車両リース」：毎月 32,000円（稼働が無い月も） → 毎月 30,000円（稼働が無い月も）"]);
    expect(list.counts.changed).toBe(1);
    expect(filterTermsRows(list.rows, "changed").map((r) => r.driverId)).toEqual([ids.D04]);

    const detail = await loadTermsDriver(db, tenantId, ids.D04, NOW);
    expect(detail!.changes).toHaveLength(1);
    expect(detail!.initial.projectIds.sort()).toEqual(readTermsContent((await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, ids.D04)))[0].content)!.services.map((x) => x.projectId).sort());

    const P = await projectIds(tenantId);
    const v2 = await createTermsVersion(
      db,
      tenantId,
      staff,
      input(ids.D04, [P["ルート配送（時給）"], P["スポット便"]], { commissionedOn: "2026-05-01", baseVersion: 1, issuedOn: "2026-10-20" }),
      new Date("2026-10-20T15:00:00+09:00"),
    );
    expect(v2).toMatchObject({ version: 2, created: true, firstIssuedOnSet: false });
    expect((await driverRow(ids.D04)).termsIssuedOn).toBe("2026-10-20");

    const after = await loadTermsDriver(db, tenantId, ids.D04, NOW);
    expect(after!.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(after!.versions[0].isLatest).toBe(true);
    expect(after!.versions[0].changesFromPrev).toContain("控除「車両リース」：毎月 32,000円（稼働が無い月も） → 毎月 30,000円（稼働が無い月も）");
    expect(after!.versions[1].changesFromPrev).toBeNull();
    expect(after!.changes).toEqual([]);
    expect((await listTerms(db, tenantId, NOW)).counts.changed).toBe(0);
    await db.update(s.deductionRules).set({ amount: 32000 }).where(eq(s.deductionRules.id, lease.id));
  });

  it("前の日付で明示した版を足すと、最初に明示した日は前へ動く（空か、後の日付のときだけ入れる）", async () => {
    const P = await projectIds(tenantId);
    const v3 = await createTermsVersion(db, tenantId, staff, input(ids.D04, [P["ルート配送（時給）"]], { issuedOn: "2026-05-01", other: "書面で渡した日を記録" }), NOW);
    expect(v3).toMatchObject({ version: 3, firstIssuedOnSet: true });
    expect((await driverRow(ids.D04)).termsIssuedOn).toBe("2026-05-01");

    // 手で入っている明示の日（2026-04-01）より後の版を作っても、台帳の日はそのまま
    const v1 = await createTermsVersion(db, tenantId, staff, input(ids.D01, [P["宅配（個建て）"]]), NOW);
    expect(v1).toMatchObject({ version: 1, firstIssuedOnSet: false });
    expect((await driverRow(ids.D01)).termsIssuedOn).toBe("2026-04-01");
  });

  it("入力の誤り：今日より後の明示の日・案件なし・再委託の項目の抜けは保存しない。ほかの会社の案件は使えない", async () => {
    const P = await projectIds(tenantId);
    const OP = await projectIds(otherId);
    await expect(createTermsVersion(db, tenantId, staff, input(ids.D02, [P["企業配（日当）"]], { issuedOn: "2026-10-21" }), NOW)).rejects.toThrow(/今日より後/);
    await expect(createTermsVersion(db, tenantId, staff, input(ids.D02, []), NOW)).rejects.toThrow(/案件を 1 つ以上/);
    await expect(createTermsVersion(db, tenantId, staff, input(ids.D02, [P["企業配（日当）"]], { isSubcontract: true }), NOW)).rejects.toThrow(/元委託者/);
    await expect(createTermsVersion(db, tenantId, staff, input(ids.D02, [P["企業配（日当）"]], { periodTo: "2026-04-01" }), NOW)).rejects.toThrow(/終わりの日/);
    await expect(createTermsVersion(db, tenantId, staff, input(ids.D02, [OP["企業配（日当）"]]), NOW)).rejects.toThrow(/案件の一部が見つかりません/);
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, ids.D02))).toHaveLength(0);
  });

  it("再委託の 3 項目・書面の名前・みなし確認なしも写しに残る", async () => {
    const P = await projectIds(tenantId);
    const r = await createTermsVersion(
      db,
      tenantId,
      staff,
      input(ids.D06, [P["夜間便"]], { deemed: false, isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "毎月末日締め・翌月末日払い", documentName: "業務委託契約書（2026年6月1日）" }),
      NOW,
    );
    const [rec] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.id, r.recordId));
    expect(rec.deemedClause).toBe(false);
    expect(readTermsContent(rec.content)!.deemedClause).toBeNull();
    expect(rec.subcontract).toEqual({ isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "毎月末日締め・翌月末日払い" });
    expect(rec.documentName).toBe("業務委託契約書（2026年6月1日）");
  });
});

describe("役割と会社の区切り", () => {
  it("見るだけの人は作れない・送れない・まとめて作れない・リンクを作り直せない", async () => {
    const P = await projectIds(tenantId);
    await expect(createTermsVersion(db, tenantId, viewer, input(ids.D02, [P["企業配（日当）"]]), NOW)).rejects.toThrow(TERMS_NO_PERMISSION);
    await expect(bulkCreateTerms(db, tenantId, viewer, { issuedOn: "2026-10-20", place: "配送先", deemed: false }, NOW)).rejects.toThrow(TERMS_NO_PERMISSION);
    const [rec] = await db.select().from(s.termsRecords).where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, ids.D01)));
    await expect(markTermsSent(db, tenantId, viewer, rec.id, "copy", NOW)).rejects.toThrow(TERMS_NO_PERMISSION);
    await expect(recreateTermsLink(db, tenantId, viewer, rec.id)).rejects.toThrow(TERMS_NO_PERMISSION);
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, ids.D02))).toHaveLength(0);
  });

  it("ほかの会社のドライバー・記録は、読めない・変えられない", async () => {
    const OP = await projectIds(otherId);
    const theirs = await createTermsVersion(db, otherId, otherStaff, input(otherIds.D02, [OP["企業配（日当）"]]), NOW);

    // 自分の会社として、ほかの会社のドライバーで作ろうとする
    await expect(createTermsVersion(db, tenantId, staff, input(otherIds.D03, [OP["宅配（個建て）"]]), NOW)).rejects.toThrow();
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, otherIds.D03))).toHaveLength(0);
    expect(await loadTermsDriver(db, tenantId, otherIds.D02, NOW)).toBeNull();
    expect(await termsPdfSource(db, tenantId, theirs.recordId)).toBeNull();
    await expect(markTermsSent(db, tenantId, staff, theirs.recordId, "line", NOW)).rejects.toThrow(/見つかりません/);
    await expect(recreateTermsLink(db, tenantId, staff, theirs.recordId)).rejects.toThrow(/見つかりません/);
    const [still] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.id, theirs.recordId));
    expect(still.sentAt).toBeNull();

    // 一覧にも混ざらない
    const mine = await listTerms(db, tenantId, NOW);
    expect(mine.rows.every((r) => Object.values(ids).includes(r.driverId))).toBe(true);
    expect(mine.rows).toHaveLength(8);
    expect(await loadTermsDriver(db, tenantId, "not-a-uuid", NOW)).toBeNull();
    expect(await termsPdfSource(db, tenantId, "not-a-uuid")).toBeNull();
  });
});

describe("送る・リンクを作り直す", () => {
  it("送った記録は最初の日時だけ残る。古い版は送れない。作り直すと送った記録が外れる", async () => {
    const recs = await db.select().from(s.termsRecords).where(and(eq(s.termsRecords.tenantId, tenantId), eq(s.termsRecords.driverId, ids.D04)));
    const latest = recs.sort((a, b) => b.version - a.version)[0];
    const old = recs.find((r) => r.version === 1)!;

    const first = await markTermsSent(db, tenantId, staff, latest.id, "line", NOW);
    expect(first.first).toBe(true);
    const second = await markTermsSent(db, tenantId, staff, latest.id, "copy", new Date("2026-10-21T10:00:00+09:00"));
    expect(second.first).toBe(false);
    expect(second.sentAt?.toISOString()).toBe(NOW.toISOString());
    await expect(markTermsSent(db, tenantId, staff, old.id, "line", NOW)).rejects.toThrow(`新しい版（版 ${latest.version}）があります`);

    const list = await listTerms(db, tenantId, NOW);
    expect(list.rows.find((r) => r.driverId === ids.D04)!.status).toBe("sent");

    const before = latest.linkNonce;
    const { linkNonce } = await recreateTermsLink(db, tenantId, staff, latest.id);
    expect(linkNonce).not.toBe(before);
    const [row] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.id, latest.id));
    expect(row.sentAt).toBeNull();
    expect(row.linkNonce).toBe(linkNonce);
  });
});

describe("未作成の人の明示書をまとめて作る", () => {
  it("記録が無い有効な人だけ版 1 を作る。2 回押しても増えない。手で入れた明示の日は動かさない", async () => {
    const preview = await previewBulkTerms(db, tenantId, NOW);
    const expected = ["D02", "D03", "D05", "D07", "D08"].map((c) => ids[c]);
    expect(preview.drivers.map((d) => d.id).sort()).toEqual([...expected].sort());
    expect(preview.drivers.every((d) => d.workedRecently)).toBe(true);
    // 無効な人は入れない
    await db.update(s.drivers).set({ active: false }).where(eq(s.drivers.id, ids.D08));
    const list0 = await listTerms(db, tenantId, NOW);
    expect(list0.counts.none).toBe(4);
    expect(list0.counts.noneWorked).toBe(4);

    const r = await bulkCreateTerms(db, tenantId, staff, { issuedOn: "2026-10-20", place: "会社が指定する配送先", deemed: true }, NOW);
    expect(r.created.map((c) => c.driverId).sort()).toEqual(["D02", "D03", "D05", "D07"].map((c) => ids[c]).sort());
    expect(r.created.every((c) => c.version === 1)).toBe(true);
    expect(r.skipped).toEqual([]);

    // 岡田さん（D05）：直近の案件と、その人だけの単価（宅配 155 円）
    const [okada] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, ids.D05));
    const c = readTermsContent(okada.content)!;
    expect(c.services.map((x) => [x.name, x.payRate])).toEqual([
      ["企業配（日当）", 18000],
      ["宅配（個建て）", 155],
    ]);
    expect(c.place).toBe("会社が指定する配送先");
    expect(okada.deemedClause).toBe(true);
    // 木村さん（D07）：合意の印が無い「制服代」も、台帳にあるとおり書く（書いてあることを明示する）
    const [kimura] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, ids.D07));
    expect(readTermsContent(kimura.content)!.deductions.map((d) => d.name)).toContain("制服代");

    expect((await driverRow(ids.D02)).termsIssuedOn).toBe("2026-04-01");
    expect((await driverRow(ids.D03)).termsIssuedOn).toBe("2026-05-10");

    const again = await bulkCreateTerms(db, tenantId, staff, { issuedOn: "2026-10-20", place: "会社が指定する配送先", deemed: true }, NOW);
    expect(again.created).toEqual([]);
    expect((await listTerms(db, tenantId, NOW)).counts.none).toBe(0);
    // ほかの会社は何も変わらない
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.tenantId, otherId))).toHaveLength(1);
    await db.update(s.drivers).set({ active: true }).where(eq(s.drivers.id, ids.D08));
  });

  it("案件が 1 つも無い会社では作らずに理由を返す", async () => {
    const [bare] = await db.insert(s.tenants).values({ name: "案件のまだ無い会社（架空）" }).returning();
    await db.insert(s.drivers).values([
      { tenantId: bare.id, name: "新井 花子" },
      { tenantId: bare.id, name: "石田 光" },
    ]);
    const r = await bulkCreateTerms(db, bare.id, { userId: null, role: "owner" }, { issuedOn: "2026-10-20", place: "配送先", deemed: false }, NOW);
    expect(r.created).toEqual([]);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toContain("案件が 1 つも無い");
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.tenantId, bare.id))).toHaveLength(0);
  });
});
