import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { bulkCreateTerms, createTermsVersion, listTerms, loadTermsDriver, TERMS_RACE, type TermsActor } from "~/server/features/terms";
import { describeVersionChanges, readTermsContent, termsExtraChanges, unlistedWorkText } from "~/server/features/terms/document";
import type { TermsVersionInput } from "~/server/features/terms/schema";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 明示したあとの変化のうち、compareTermsContent が比べないもの（みなし確認の日数・消費税の扱い・明示書に無い案件の稼働）、
 * 二重送信（画面が古いまま同じ中身を送った）、これから始める人の「委託した日」、数量 0 の行、支払期日の文言の注意、会社の区切り。
 * 「今日」は 2026-10-20（日本時間）に固定する。
 */
const NOW = new Date("2026-10-20T10:00:00+09:00");

let db: Db;
let client: PGlite;
let tenantId: string;
let otherId: string;
let staff: TermsActor;
let otherStaff: TermsActor;
const D: Record<string, string> = {};
const OD: Record<string, string> = {};
const P: Record<string, string> = {};
const OP: Record<string, string> = {};

function input(driverId: string, projectIds: string[], patch: Partial<TermsVersionInput> = {}): TermsVersionInput {
  return {
    driverId,
    projectIds,
    serviceDescription: "貨物軽自動車を使った荷物の配送業務",
    place: "会社が指定する配送先",
    periodFrom: "2026-04-01",
    receipt: "業務を行った日ごとに受け取ったものとします。",
    deemed: true,
    isSubcontract: false,
    issuedOn: "2026-10-20",
    ...patch,
  };
}

async function setSettings(tid: string, patch: Record<string, unknown>) {
  const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tid));
  await db
    .update(s.tenants)
    .set({ settings: { ...(t.settings ?? {}), ...patch } })
    .where(eq(s.tenants.id, tid));
}

async function rowOf(tid: string, driverId: string) {
  return (await listTerms(db, tid, NOW)).rows.find((r) => r.driverId === driverId)!;
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(db));
  ({ tenantId: otherId } = await seedDemo(db));
  for (const r of await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId))) D[r.code!] = r.id;
  for (const r of await db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherId))) OD[r.code!] = r.id;
  for (const r of await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId))) P[r.name] = r.id;
  for (const r of await db.select().from(s.projects).where(eq(s.projects.tenantId, otherId))) OP[r.name] = r.id;
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  const [ou] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, otherId), eq(s.users.role, "staff")));
  staff = { userId: u.id, role: "staff" };
  otherStaff = { userId: ou.id, role: "staff" };
});
afterAll(async () => client.close());

describe("変化の文（純関数）", () => {
  it("みなし確認の日数と消費税の扱いの違いを 1 行ずつ出す。どちらかに条項が無ければ比べない", () => {
    const a = { deemedClause: "記載内容に誤りがある場合は、支払明細の受け取りから7日以内にご連絡ください。", taxNote: "報酬（税抜）とは別に、消費税を支払います。" };
    const b = { deemedClause: "記載内容に誤りがある場合は、支払明細の受け取りから5日以内にご連絡ください。", taxNote: "表示の報酬に消費税は含みません。" };
    expect(termsExtraChanges(a, b)).toEqual(["明細のみなし確認の日数：7日 → 5日（会社の設定）", "消費税の扱い：「報酬（税抜）とは別に、消費税を支払います。」→「表示の報酬に消費税は含みません。」"]);
    expect(termsExtraChanges(a, a)).toEqual([]);
    expect(termsExtraChanges({ ...a, deemedClause: null }, b).filter((x) => x.includes("みなし"))).toEqual([]);
    expect(unlistedWorkText("企業配（日当）", "2026-10-01")).toBe("明示書に無い案件「企業配（日当）」の稼働があります（2026年10月）");
  });
});

describe("明示したあとの変化（台帳と稼働から）", () => {
  it("明示書に無い案件で稼働していると「条件が変わっています」になり、新しい版でははじめから選んでおく", async () => {
    // 岡田さん（D05）：宅配だけで明示したが、10 月に企業配（日当）18 日の稼働がある
    const v1 = await createTermsVersion(db, tenantId, staff, input(D.D05, [P["宅配（個建て）"]]), NOW);
    expect(v1).toMatchObject({ version: 1, created: true });
    const row = await rowOf(tenantId, D.D05);
    expect(row.changes).toEqual(["明示書に無い案件「企業配（日当）」の稼働があります（2026年10月）"]);

    const detail = (await loadTermsDriver(db, tenantId, D.D05, NOW))!;
    expect(detail.changes).toEqual(row.changes);
    expect([...detail.initial.projectIds].sort()).toEqual([P["企業配（日当）"], P["宅配（個建て）"]].sort());
    // 単価はその人のもの（宅配は 155 円の人ごとの単価、企業配は 18,000 円）
    expect(detail.current.services.map((x) => [x.name, x.payRate])).toEqual([
      ["企業配（日当）", 18000],
      ["宅配（個建て）", 155],
    ]);

    // 版 2 に企業配を入れると、変化は消える
    const v2 = await createTermsVersion(db, tenantId, staff, input(D.D05, detail.initial.projectIds, { baseVersion: 1 }), NOW);
    expect(v2).toMatchObject({ version: 2, created: true });
    expect((await rowOf(tenantId, D.D05)).changes).toEqual([]);
    const after = (await loadTermsDriver(db, tenantId, D.D05, NOW))!;
    expect(after.versions[0].changesFromPrev).toContain("案件を追加：企業配（日当）（18,000円／日）");
  });

  it("明示した月より前の稼働だけなら、明示書に無い案件でも変化に数えない", async () => {
    // 加藤さん（D06）：夜間便だけの人。8 月にだけスポット便 1 件があったことにして（9 月は締めた月）、10 月 20 日に夜間便だけで明示する
    await db.insert(s.workEntries).values({ tenantId, month: "2026-08-01", driverId: D.D06, projectId: P["スポット便"], qty: 1 });
    await createTermsVersion(db, tenantId, staff, input(D.D06, [P["夜間便"]]), NOW);
    expect((await rowOf(tenantId, D.D06)).changes).toEqual([]);
  });

  it("会社の設定でみなし確認の日数を変えると、条項を入れた人だけ変化が出る。版 2 の履歴にも残る。ほかの会社は変わらない", async () => {
    // ここまでで条項ありの版があるのは D05・D06。D01 は条項あり、D02 は条項なしで作る
    const aoki = await createTermsVersion(db, tenantId, staff, input(D.D01, [P["宅配（個建て）"], P["スポット便"]]), NOW);
    await createTermsVersion(db, tenantId, staff, input(D.D02, [P["企業配（日当）"]], { deemed: false }), NOW);
    await createTermsVersion(db, otherId, otherStaff, input(OD.D01, [OP["宅配（個建て）"], OP["スポット便"]]), NOW);
    expect((await rowOf(tenantId, D.D01)).changes).toEqual([]);

    await setSettings(tenantId, { deemedConfirmDays: 5 });
    expect((await rowOf(tenantId, D.D01)).changes).toEqual(["明細のみなし確認の日数：7日 → 5日（会社の設定）"]);
    expect((await rowOf(tenantId, D.D02)).changes).toEqual([]);
    expect((await rowOf(otherId, OD.D01)).changes).toEqual([]);
    const list = await listTerms(db, tenantId, NOW);
    expect(list.rows.filter((r) => r.changes.length > 0).map((r) => r.driverId).sort()).toEqual([D.D01, D.D05, D.D06].sort());
    expect(list.counts.changed).toBe(3);

    const detail = (await loadTermsDriver(db, tenantId, D.D01, NOW))!;
    expect(detail.changes).toEqual(["明細のみなし確認の日数：7日 → 5日（会社の設定）"]);
    expect(detail.deemedText).toContain("5日以内");

    const v2 = await createTermsVersion(db, tenantId, staff, input(D.D01, [P["宅配（個建て）"], P["スポット便"]], { baseVersion: aoki.version }), NOW);
    expect(v2).toMatchObject({ version: 2, created: true });
    const after = (await loadTermsDriver(db, tenantId, D.D01, NOW))!;
    expect(after.changes).toEqual([]);
    expect(after.versions[0].changesFromPrev).toEqual(["明細のみなし確認の日数：7日 → 5日（会社の設定）"]);
    await setSettings(tenantId, { deemedConfirmDays: 7 });
  });

  it("免税の方に消費税相当額を払わない設定にすると、登録の無い人だけ「消費税の扱い」が変わる", async () => {
    // 遠藤さん（D04）は登録なし。井上さん（D02）は登録あり
    await createTermsVersion(db, tenantId, staff, input(D.D04, [P["ルート配送（時給）"], P["スポット便"]]), NOW);
    await db.update(s.tenants).set({ payTaxToExempt: false }).where(eq(s.tenants.id, tenantId));
    const endo = await rowOf(tenantId, D.D04);
    expect(endo.changes).toHaveLength(1);
    expect(endo.changes[0]).toBe("消費税の扱い：「報酬（税抜）とは別に、消費税（登録の無い方は消費税相当額）を支払います。」→「表示の報酬に消費税は含みません（消費税相当額は支払いません）。」");
    expect((await rowOf(tenantId, D.D02)).changes).toEqual([]);
    expect((await rowOf(otherId, OD.D01)).changes).toEqual([]);
    await db.update(s.tenants).set({ payTaxToExempt: true }).where(eq(s.tenants.id, tenantId));
    expect((await rowOf(tenantId, D.D04)).changes).toEqual([]);
  });
});

describe("二重送信・これから始める人・数量 0 の行", () => {
  it("画面が古いまま同じ中身を送り直しても、エラーにせず前の版を返す。中身が違えば止める", async () => {
    const first = await createTermsVersion(db, tenantId, staff, input(D.D03, [P["宅配（個建て）"]], { baseVersion: 0 }), NOW);
    expect(first).toMatchObject({ version: 1, created: true });
    const again = await createTermsVersion(db, tenantId, staff, input(D.D03, [P["宅配（個建て）"]], { baseVersion: 0 }), NOW);
    expect(again).toEqual({ recordId: first.recordId, version: 1, created: false, firstIssuedOnSet: false });
    await expect(createTermsVersion(db, tenantId, staff, input(D.D03, [P["宅配（個建て）"]], { baseVersion: 0, place: "別の場所" }), NOW)).rejects.toThrow(TERMS_RACE);
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, D.D03))).toHaveLength(1);
  });

  it("これから始める人：委託した日は先の日付を入れない（明示した日と同じ扱い）。数量 0 の行は稼働に数えない", async () => {
    const [newbie] = await db
      .insert(s.drivers)
      .values({ tenantId, code: "D09", name: "新田 光", startedOn: "2026-11-01" })
      .returning();
    // 取り込みで入った数量 0 の行だけ
    await db.insert(s.workEntries).values({ tenantId, month: "2026-10-01", driverId: newbie.id, projectId: P["宅配（個建て）"], qty: 0 });

    const row = await rowOf(tenantId, newbie.id);
    expect(row).toMatchObject({ status: "none", workedRecently: false, lastWorkMonth: null });
    const detail = (await loadTermsDriver(db, tenantId, newbie.id, NOW))!;
    expect(detail.workedRecently).toBe(false);
    expect(detail.firstWorkMonth).toBeNull();
    expect(detail.initial.commissionedOn).toBe("");
    expect(detail.initial.periodFrom).toBe("2026-11-01");

    // 木村さん（D07）の台帳は、終わりの日（6 月 30 日）が始まり（明示の日 7 月 1 日）より前になっている
    await db.update(s.drivers).set({ endOn: "2026-06-30" }).where(eq(s.drivers.id, D.D07));

    // まとめて作る：D07・D08・D09 が未作成。D09 の委託した日は空、期間は 11 月 1 日から
    const r = await bulkCreateTerms(db, tenantId, staff, { issuedOn: "2026-10-20", place: "会社が指定する配送先", deemed: false }, NOW);
    expect(r.created.map((c) => c.name).sort()).toEqual(["佐藤 亮", "新田 光", "木村 誠"].sort());
    const [rec] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, newbie.id));
    const c = readTermsContent(rec.content)!;
    expect(c.commissionedOn).toBeNull();
    expect(c.period).toEqual({ from: "2026-11-01", to: null });
    expect(r.skipped).toEqual([]);
    // 終わりの日が始まりより前の台帳は、終わりを書かない（1 人ずつの画面で直す）
    const [kimura] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, D.D07));
    expect(readTermsContent(kimura.content)!.period).toEqual({ from: "2026-07-01", to: null });
    // 手で入っている明示の日（2026-04-01）は、委託した日としてそのまま使う
    const [sato] = await db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, D.D08));
    expect(readTermsContent(sato.content)!.commissionedOn).toBe("2026-04-01");
    // ほかの会社には何も作らない
    expect(await db.select().from(s.termsRecords).where(eq(s.termsRecords.tenantId, otherId))).toHaveLength(1);
  });
});

describe("会社の支払期日の文言の注意", () => {
  it("設定の文言に「まで」があれば、その文と言葉を出す。明示書の支払期日は具体的な日のまま。ほかの会社には出ない", async () => {
    await setSettings(tenantId, { paymentTermsText: "毎月末日締め、翌月末日までに支払う" });
    const detail = (await loadTermsDriver(db, tenantId, D.D01, NOW))!;
    expect(detail.warnings.contractWording).toEqual({ words: ["まで"], text: "毎月末日締め、翌月末日までに支払う" });
    expect(detail.warnings.paymentWords).toEqual([]);
    expect(detail.current.payment.text).toBe("毎月末日締め・翌月25日払い（支払日が金融機関の休業日のときは、その前の営業日に支払います）");
    expect((await loadTermsDriver(db, otherId, OD.D01, NOW))!.warnings.contractWording).toBeNull();
    await setSettings(tenantId, { paymentTermsText: "毎月末日締め・翌月25日払い" });
    expect((await loadTermsDriver(db, tenantId, D.D01, NOW))!.warnings.contractWording).toBeNull();
  });

  it("版と版の比べ：みなし確認の条項を入れた・外したは、日数の変化とは別に 1 行だけ出す", () => {
    const base = {
      serviceDescription: "配送",
      services: [],
      taxNote: "税",
      payment: { closingDay: 0, payMonthOffset: 1, payDay: 25, text: "毎月末日締め・翌月25日払い", periodText: "毎月1日から末日まで" },
      feeBearer: "company" as const,
      deductions: [],
      place: "配送先",
      period: { from: "2026-04-01", to: null },
      receipt: "毎日",
      deemedClause: null,
      other: "",
    };
    const on = { ...base, deemedClause: "支払明細の受け取りから7日以内にご連絡ください。" };
    expect(describeVersionChanges({ content: base, subcontract: null, documentName: null, issuedOn: "2026-10-01" }, { content: on, subcontract: null, documentName: null, issuedOn: "2026-10-01" })).toEqual([
      "明細のみなし確認の条項を入れました",
    ]);
  });
});
