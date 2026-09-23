import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import {
  bankFingerprint,
  buildTransferFile,
  createTransferBatch,
  daysAfter,
  loadTransferNotes,
  loadTransferPlan,
  loadTransferReview,
  maskedBank,
  reviewBankChanges,
  sameBankAsStamp,
  setTransferExecutedOn,
  stampDiff,
  bankStamp,
  bankReviewKey,
  type BankFields,
} from "~/server/features/transfer";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { sha256 } from "~/server/tokens";
import { auditCsvRows, searchAuditLog } from "~/server/features/close";
import { toZenginKana } from "@/lib/payroll/zengin";
import { createTestDb } from "./helpers/db";

const NOV = "2026-11-01";

async function driverOf(db: Db, tenantId: string, code: string) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d;
}

/** ドライバーの設定の画面で口座を直したのと同じ記録を残す（設定の Server Action と同じ形） */
async function editBank(db: Db, tenantId: string, userId: string, code: string, next: Partial<typeof s.drivers.$inferInsert>) {
  const before = await driverOf(db, tenantId, code);
  await db.update(s.drivers).set(next).where(and(eq(s.drivers.id, before.id), eq(s.drivers.tenantId, tenantId)));
  const changed = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: v }]));
  await audit(db, { tenantId, userId, action: "driver.update", entity: "driver", entityId: before.id, detail: { name: before.name, changed } });
}

/** 前の作り方（鍵なしの sha256）の目印：この確かめを入れる前に残っていた操作の記録と同じ形 */
function legacyStamp(tenantId: string, b: BankFields) {
  const holder = toZenginKana(b.holderKana).value.replace(/\s+/g, " ").trim();
  return {
    fp: sha256(`bank:${tenantId}|${b.bankCode}|${b.branchCode}|${b.accountType}|${b.accountNumber}|${holder}`),
    bankCode: b.bankCode,
    branchCode: b.branchCode,
    accountType: b.accountType,
    tail: b.accountNumber.slice(-3),
    n: sha256(`bank-number:${tenantId}|${b.accountNumber}`).slice(0, 16),
    h: sha256(`bank-holder:${tenantId}|${holder}`).slice(0, 16),
  };
}

const bank = (over: Partial<BankFields> = {}): BankFields => ({
  bankCode: "0009",
  bankNameKana: "ﾐﾂｲｽﾐﾄﾓ",
  branchCode: "303",
  branchNameKana: "ｻﾝﾌﾟﾙ",
  accountType: "ordinary",
  accountNumber: "3456789",
  holderKana: "ウエダ ケン",
  ...over,
});

describe("口座の目印（純関数）", () => {
  it("番号そのものは残さず、どこが変わったかだけ分かる。全角・半角の名義の違いは変わったことにしない", () => {
    const t = "00000000-0000-0000-0000-000000000001";
    const a = bankStamp(t, bank());
    expect(JSON.stringify(a)).not.toContain("3456789");
    expect(a.tail).toBe("789");
    expect(maskedBank(a)).toBe("0009-303 普通 ****789");
    expect(bankFingerprint(t, bank({ holderKana: "ｳｴﾀﾞ ｹﾝ" }))).toBe(a.fp);
    expect(stampDiff(a, bankStamp(t, bank({ branchCode: "305", accountNumber: "1111111" })))).toEqual(["支店", "口座番号"]);
    expect(stampDiff(a, bankStamp(t, bank({ holderKana: "ウエダ ケンジ" })))).toEqual(["口座名義"]);
    expect(stampDiff(a, bankStamp(t, bank({ accountType: "checking" })))).toEqual(["預金の種類"]);
    // 会社が違えば目印も違う（他社の記録と照らし合わせても番号は分からない）
    expect(bankFingerprint("00000000-0000-0000-0000-000000000002", bank())).not.toBe(a.fp);
    expect(daysAfter("2026-11-25", "2026-11-26")).toBe(1);
  });

  it("目印は鍵つき：会社の id と下 3 桁を知っていても、残りの桁を総当たりで割り出せない", () => {
    const t = "00000000-0000-0000-0000-000000000001";
    const a = bankStamp(t, bank());
    expect(a.v).toBe(2);
    // 前の作り方（鍵なしの sha256）で総当たりしても、どの候補とも一致しない
    const found: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const candidate = `${String(i).padStart(4, "0")}${a.tail}`;
      if (sha256(`bank-number:${t}|${candidate}`).slice(0, 16) === a.n) found.push(candidate);
    }
    expect(found).toEqual([]);
    expect(a.fp).not.toBe(sha256(`bank:${t}|0009|303|ordinary|3456789|ｳｴﾀﾞ ｹﾝ`));
    // 鍵は APP_SECRET から作る（DB・操作の記録・書き出しのどこにも無い）
    const saved = process.env.APP_SECRET;
    try {
      process.env.APP_SECRET = "x".repeat(40);
      const other = bankStamp(t, bank());
      expect(other.fp).not.toBe(a.fp);
      expect(other.n).not.toBe(a.n);
      // 同じ鍵なら同じ目印（前回との比べ合わせができる）
      expect(bankStamp(t, bank()).fp).toBe(other.fp);
    } finally {
      if (saved === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = saved;
    }
  });

  it("前の作り方（鍵なし）の目印とも比べられる：同じ口座なら「同じ」、違えば「違う」", () => {
    const t = "00000000-0000-0000-0000-000000000001";
    const legacy = legacyStamp(t, bank());
    expect(sameBankAsStamp(t, legacy, bank())).toBe(true);
    expect(sameBankAsStamp(t, legacy, bank({ holderKana: "ｳｴﾀﾞ ｹﾝ" }))).toBe(true);
    expect(sameBankAsStamp(t, legacy, bank({ accountNumber: "3456780" }))).toBe(false);
    expect(sameBankAsStamp(t, bankStamp(t, bank()), bank())).toBe(true);
    expect(sameBankAsStamp(t, bankStamp(t, bank()), bank({ branchCode: "305" }))).toBe(false);
  });
});

describe("前回の振込から口座が変わった人", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let staffId: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    staffId = users.find((u) => u.role === "staff")!.id;
    await generateStatements(db, tenantId, DEMO_MONTH);
    await generateStatements(db, otherTenantId, DEMO_MONTH);
  });
  afterAll(async () => client.close());

  it("初めての振込：前の記録が無い 7 人は「初めて」、変わった人はいない", async () => {
    const review = await loadTransferReview(db, tenantId, DEMO_MONTH);
    expect(review.bank.changed).toEqual([]);
    expect(review.bank.firstTime.map((f) => f.driverCode)).toEqual(["D01", "D02", "D03", "D04", "D05", "D06", "D08"]);
    expect(review.bank.compared).toBe(7);
    expect(review.staleBankBatches).toEqual([]);
  });

  it("振込データの記録には、口座の目印だけを残す（番号は残さない）", async () => {
    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staffId);
    expect(batch.lateDays).toBe(0);
    await setTransferExecutedOn(db, tenantId, batch.id, "2026-11-25", staffId);
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create")));
    const lines = log.detail.lines as { driverId: string; bank: { fp: string; tail: string } }[];
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.bank.fp.length === 64)).toBe(true);
    expect(JSON.stringify(log.detail)).not.toContain("1234567");
    expect((log.detail.firstTime as string[]).length).toBe(7);
    // 作ったあとは、同じ口座なので変わった人はいない
    const review = await loadTransferReview(db, tenantId, DEMO_MONTH);
    expect(review.bank.changed).toEqual([]);
    expect(review.bank.firstTime).toEqual([]);
  });

  it("翌月：口座を直した人は、変えた人と日時つきで出す。記録の無い変更は「記録にありません」。口座を入れた人は「初めて」", async () => {
    // 上田：設定の画面で支店と口座番号を変えた／岡田：画面の外で名義が変わった（記録なし）／木村：口座を入れた
    await editBank(db, tenantId, staffId, "D03", { branchCode: "305", accountNumber: "1111111" });
    const d05 = await driverOf(db, tenantId, "D05");
    await db.update(s.drivers).set({ holderKana: "オカダ タクミ" }).where(eq(s.drivers.id, d05.id));
    await editBank(db, tenantId, staffId, "D07", { bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "107", branchNameKana: "ｻﾝﾌﾟﾙ", accountNumber: "8901234", holderKana: "キムラ マコト" });
    // 名義を半角にしただけ（同じ名義）の青木は、変わったことにしない
    await editBank(db, tenantId, staffId, "D01", { holderKana: "ｱｵｷ ｼｮｳﾀ" });

    // 11 月の稼働（青木・上田・岡田・木村）
    const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
    const takuhai = projects.find((p) => p.name === "宅配（個建て）")!;
    for (const code of ["D01", "D03", "D05", "D07"]) {
      const d = await driverOf(db, tenantId, code);
      await db.insert(s.workEntries).values({ tenantId, month: NOV, driverId: d.id, projectId: takuhai.id, qty: 2000 });
    }
    await generateStatements(db, tenantId, NOV);

    const review = await loadTransferReview(db, tenantId, NOV);
    expect(review.bank.compared).toBe(4);
    expect(review.bank.changed.map((c) => c.driverCode)).toEqual(["D03", "D05"]);
    const ueda = review.bank.changed[0];
    expect(ueda.driverName).toBe("上田 健");
    expect(ueda.fields).toEqual(["支店", "口座番号"]);
    expect(ueda.previous.masked).toBe("0009-303 普通 ****789");
    expect(ueda.currentMasked).toBe("0009-305 普通 ****111");
    expect(ueda.previous.month).toBe(DEMO_MONTH);
    expect(ueda.previous.fileName).toBe("振込_2026年10月分_20261125.txt");
    expect(ueda.edits).toHaveLength(1);
    expect(ueda.edits[0]).toMatchObject({ userName: "デモ 事務", fields: ["支店コード", "口座番号"] });
    expect(ueda.edits[0].at).toBeInstanceOf(Date);
    const okada = review.bank.changed[1];
    expect(okada.fields).toEqual(["口座名義"]);
    expect(okada.edits).toEqual([]);
    expect(review.bank.firstTime.map((f) => f.driverCode)).toEqual(["D07"]);
    expect(review.changedRemaining).toBe(2);
  });

  it("口座が変わった人がいると、確かめた印が無ければ作らない。印があれば作り、記録に残す", async () => {
    await expect(createTransferBatch(db, tenantId, NOV, { transferDate: "2026-12-25", scope: "all" }, staffId)).rejects.toThrow(
      /口座が変わった人が 2人[\s\S]*上田 健（支店・口座番号）[\s\S]*岡田 拓也（口座名義）/,
    );
    expect(await db.select().from(s.transferBatches).where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, NOV)))).toHaveLength(0);

    // 画面で見た「変わった人と口座」に、確かめた印を結びつける。見たあとにまた口座が変わったら作らない
    const seen = await loadTransferReview(db, tenantId, NOV);
    expect(seen.bankKeys.all).toMatch(/^[0-9a-f]{24}$/);
    expect(seen.bankKeys.remaining).toBe(seen.bankKeys.all);
    const okada = await driverOf(db, tenantId, "D05");
    const holderBefore = okada.holderKana;
    await db.update(s.drivers).set({ holderKana: "オカダ タクマ" }).where(eq(s.drivers.id, okada.id));
    // 口座の一覧の取り込みで変えた記録（取り込みの機能が残す形）
    await audit(db, {
      tenantId,
      userId: staffId,
      action: "driver.update",
      entity: "driver",
      entityId: okada.id,
      detail: { name: okada.name, changed: { holderKana: { from: holderBefore, to: "オカダ タクマ" } }, source: "import.bank", fileName: "口座一覧.csv" },
    });
    await expect(
      createTransferBatch(db, tenantId, NOV, { transferDate: "2026-12-25", scope: "all", bankChangesConfirmed: true, bankReviewKey: seen.bankKeys.all }, staffId),
    ).rejects.toThrow(/さらに変わっています[\s\S]*岡田 拓也（口座名義）/);
    expect(await db.select().from(s.transferBatches).where(and(eq(s.transferBatches.tenantId, tenantId), eq(s.transferBatches.month, NOV)))).toHaveLength(0);
    const again = await loadTransferReview(db, tenantId, NOV);
    expect(again.bankKeys.all).not.toBe(seen.bankKeys.all);
    const okadaChange = again.bank.changed.find((c) => c.driverCode === "D05")!;
    expect(okadaChange.edits[0]).toMatchObject({ userName: "デモ 事務", fields: ["口座名義"], via: "口座の一覧の取り込み（口座一覧.csv）" });
    // 値は、変わった人の一覧（口座の目印）から同じように作り直せる
    expect(bankReviewKey(again.bank.changed)).toBe(again.bankKeys.all);

    const batch = await createTransferBatch(
      db,
      tenantId,
      NOV,
      { transferDate: "2026-12-25", scope: "all", bankChangesConfirmed: true, bankReviewKey: again.bankKeys.all },
      staffId,
    );
    expect(batch.count).toBe(4);
    expect(batch.bankChanged).toBe(2);
    const [log] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create"), eq(s.auditLog.entityId, batch.id)));
    expect((log.detail.bankChanged as { fields: string[] }[]).map((b) => b.fields)).toEqual([["支店", "口座番号"], ["口座名義"]]);
    // 作ったあとは、今の口座と比べるので「変わった人」はいない
    expect((await loadTransferReview(db, tenantId, NOV)).bank.changed).toEqual([]);
  });

  it("振込データを作ったあとに口座が変わると、ダウンロードを止める。元に戻せば出せる", async () => {
    const plan = await loadTransferPlan(db, tenantId, NOV);
    const batchId = plan.batches[0].id;
    const d01 = await driverOf(db, tenantId, "D01");
    await db.update(s.drivers).set({ accountNumber: "7654321" }).where(eq(s.drivers.id, d01.id));
    const review = await loadTransferReview(db, tenantId, NOV);
    expect(review.staleBankBatches).toEqual([{ batchId, drivers: ["青木 翔太"] }]);
    expect(review.bank.changed.map((c) => c.driverCode)).toEqual(["D01"]);
    await expect(buildTransferFile(db, tenantId, batchId)).rejects.toThrow("口座が変わった人がいます（青木 翔太）");
    // 振り込んだ記録がある 10 月のデータは、いまの口座で出し直さない（取り消せないので、取り消しは勧めない）
    const october = (await loadTransferPlan(db, tenantId, DEMO_MONTH)).batches[0];
    expect(october.executedOn).toBe("2026-11-25");
    await expect(buildTransferFile(db, tenantId, october.id)).rejects.toThrow("振り込んだ記録があるデータなので、いまの口座では出し直しません");
    await db.update(s.drivers).set({ accountNumber: "1234567" }).where(eq(s.drivers.id, d01.id));
    expect((await buildTransferFile(db, tenantId, batchId)).records).toHaveLength(1 + 4 + 2);
    // 振り込んだ日が入っている 10 月のデータは、口座が変わっても「止める」対象にしない（もう振り込んである）
    expect((await loadTransferReview(db, tenantId, DEMO_MONTH)).staleBankBatches).toEqual([]);
  });

  it("振込指定日が支払日より後なら、何日遅れかを返す", async () => {
    const d = await driverOf(db, otherTenantId, "D01");
    expect(d).toBeTruthy();
    const batch = await createTransferBatch(db, otherTenantId, DEMO_MONTH, { transferDate: "2026-11-26", scope: "all" });
    expect(batch.lateDays).toBe(1);
  });

  it("他社の振込の記録とは比べない（会社ごと）", async () => {
    const other = await loadTransferPlan(db, otherTenantId, DEMO_MONTH);
    // 他社は今作った 1 件だけと比べる：変わった人はいない
    const review = await reviewBankChanges(db, otherTenantId, other.included);
    expect(review.changed).toEqual([]);
    expect(review.firstTime).toEqual([]);
    // 他社の目印は、この会社の口座の目印と一致しない
    const [mine] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "transfer.create")));
    const [theirs] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, otherTenantId), eq(s.auditLog.action, "transfer.create")));
    const fp = (l: unknown) => (l as { bank: { fp: string } }).bank.fp;
    const mineFps = new Set((mine.detail.lines as unknown[]).map(fp));
    expect((theirs.detail.lines as unknown[]).some((l) => mineFps.has(fp(l)))).toBe(false);
    // 他社の口座を変えても、この会社の「変わった人」には出ない
    await editBank(db, otherTenantId, staffId, "D02", { accountNumber: "9999999" });
    expect((await loadTransferReview(db, tenantId, NOV)).bank.changed).toEqual([]);
  });
});

describe("前の作り方（鍵なし）の目印が残っている会社", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let staffId: string;
  const SEP = "2026-09-01";
  const OLD_BATCH = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    staffId = users.find((u) => u.role === "staff")!.id;
    await generateStatements(db, tenantId, DEMO_MONTH);
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    // 9 月の振込の記録：前の作り方の目印（操作の記録は消せないので、このまま残っている）
    await audit(db, {
      tenantId,
      userId: staffId,
      action: "transfer.create",
      entity: "transfer_batch",
      entityId: OLD_BATCH,
      detail: {
        month: SEP,
        fileName: "振込_2026年9月分_20261025.txt",
        lines: plan.included.map((r) => ({ statementId: r.statementId, driverId: r.driverId, amount: 1000, version: 1, bank: legacyStamp(tenantId, r.bank) })),
      },
    });
  });
  afterAll(async () => client.close());

  it("同じ口座の人は「変わった人」に出さない。変わった人だけを、変わった項目つきで出す", async () => {
    const plan = await loadTransferPlan(db, tenantId, DEMO_MONTH);
    const first = await reviewBankChanges(db, tenantId, plan.included);
    expect(first.changed).toEqual([]);
    expect(first.firstTime).toEqual([]);
    expect(first.unknown).toEqual([]);

    await db.update(s.drivers).set({ accountNumber: "3456780" }).where(eq(s.drivers.id, (await driverOf(db, tenantId, "D03")).id));
    const again = await reviewBankChanges(db, tenantId, (await loadTransferPlan(db, tenantId, DEMO_MONTH)).included);
    expect(again.changed.map((c) => [c.driverCode, c.fields])).toEqual([["D03", ["口座番号"]]]);
    expect(again.changed[0].previous.masked).toBe("0009-303 普通 ****789");
    expect(again.changed[0].currentMasked).toBe("0009-303 普通 ****780");
  });

  it("操作の記録の画面と CSV には、目印のハッシュ（fp・n・h）を出さない（銀行・支店・下 3 桁は出す）", async () => {
    const found = await searchAuditLog(db, tenantId, { month: SEP });
    const row = found.rows.find((r) => r.action === "transfer.create")!;
    const lines = row.detail.lines as Record<string, Record<string, unknown>>[];
    expect(lines).toHaveLength(7);
    for (const l of lines) {
      expect(Object.keys(l.bank).sort()).toEqual(["accountType", "bankCode", "branchCode", "tail"]);
      // 目印ではない値（件数・金額など）はそのまま
      expect(l.amount).toBe(1000);
    }
    const csv = JSON.stringify(await auditCsvRows(db, tenantId, { month: SEP }));
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.entityId, OLD_BATCH)));
    for (const l of log.detail.lines as { bank: { fp: string; n: string; h: string } }[]) {
      expect(csv).not.toContain(l.bank.n);
      expect(csv).not.toContain(l.bank.fp);
      expect(csv).not.toContain(l.bank.h);
    }
  });
});

describe("振込の前に知らせること（止めない）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    await generateStatements(db, tenantId, DEMO_MONTH);
  });
  afterAll(async () => client.close());

  it("未解決の質問・前の版を確認したまま・まだ確認していない人を、名前で返す", async () => {
    const statements = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH)));
    const drivers = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId));
    const driverIds = new Map(drivers.map((d) => [d.code!, d.id]));
    const byCode = (code: string) => statements.find((st) => st.driverId === driverIds.get(code))!;
    const st01 = byCode("D01");
    const st02 = byCode("D02");
    const st08 = byCode("D08");
    // 青木：質問（未解決）／井上：1 版を確認 → そのあと明細が変わる／佐藤：今の版を確認
    await db.insert(s.statementMessages).values({ tenantId, statementId: st01.id, author: "driver", body: "駐車場代が入っていません" });
    await db.insert(s.statementConfirmations).values({ tenantId, statementId: st02.id, totalAtConfirm: st02.total, version: 1, hash: st02.hash });
    await db.insert(s.statementConfirmations).values({ tenantId, statementId: st08.id, totalAtConfirm: st08.total, version: 1, hash: st08.hash });
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: st02.driverId, label: "高速代の立替", amount: 800, agreedInWriting: true });
    await generateStatements(db, tenantId, DEMO_MONTH);

    const notes = await loadTransferNotes(db, tenantId, DEMO_MONTH);
    expect(notes.openQuestions).toEqual([{ driverId: st01.driverId, driverName: "青木 翔太", driverCode: "D01", count: 1 }]);
    expect(notes.oldVersion).toEqual([{ driverId: st02.driverId, driverName: "井上 美咲", driverCode: "D02", confirmedVersion: 1, currentVersion: 2 }]);
    expect(notes.unconfirmed.map((u) => u.driverCode)).toEqual(["D01", "D03", "D04", "D05", "D06", "D07"]);
    expect(notes.unconfirmed[0].status).toBe("未送付");
    // 知らせるだけで、振込データは作れる
    const batch = await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" });
    expect(batch.count).toBe(7);
    // 質問を解決にすると消える
    await db.update(s.statementMessages).set({ resolvedAt: new Date() }).where(eq(s.statementMessages.statementId, st01.id));
    expect((await loadTransferNotes(db, tenantId, DEMO_MONTH)).openQuestions).toEqual([]);
  });

  it("明細の無い月・他社の月は空", async () => {
    expect(await loadTransferNotes(db, tenantId, "2026-12-01")).toEqual({ openQuestions: [], unconfirmed: [], oldVersion: [] });
    const { tenantId: other } = await seedDemo(db);
    expect(await loadTransferNotes(db, other, DEMO_MONTH)).toEqual({ openQuestions: [], unconfirmed: [], oldVersion: [] });
  });
});
