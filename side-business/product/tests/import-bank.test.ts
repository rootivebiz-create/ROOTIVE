import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildZenginRecords, zenginBytes, type Requester, type Transfer } from "@/lib/payroll/zengin";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { applyBankImport, assignBankRow, createBankDraft, discardBankDraft, listBankBatches, loadBankView } from "~/server/features/import/bank";
import { bankStamp, reviewBankChanges } from "~/server/features/transfer";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 口座の取り込み（SPEC P0-2.9）：先月の全銀の振込ファイル・口座一覧の CSV から、台帳のドライバーの口座を入れる。
 * 見せる前に書かない・見たあとで変わっていたら止める・記録は下 3 桁だけ・別の会社には触れない。
 */

const requester: Requester = {
  code: "1234567890",
  nameKana: "ｻﾝﾌﾟﾙｳﾝｿｳ",
  bankCode: "0001",
  bankNameKana: "ﾐｽﾞﾎ",
  branchCode: "001",
  branchNameKana: "ﾎﾝﾃﾝ",
  accountType: "ordinary",
  accountNumber: "7654321",
};

const tr = (holderKana: string, accountNumber: string, bank = ["0001", "ﾐｽﾞﾎ", "101", "ｻﾝﾌﾟﾙ"], amount = 1000): Transfer => ({
  bankCode: bank[0],
  bankNameKana: bank[1],
  branchCode: bank[2],
  branchNameKana: bank[3],
  accountType: "ordinary",
  accountNumber,
  holderKana,
  amount,
});

/** 先月（9 月）の振込ファイル：青木さんの口座番号が変わった・木村さん（台帳に口座なし）・井上さん（同じ）・台帳にいない人 */
function septemberFile(): Uint8Array {
  return zenginBytes(
    buildZenginRecords(requester, "1031", [
      tr("ｱｵｷ ｼﾖｳﾀ", "7654321", ["0001", "ﾐｽﾞﾎ", "101", "ｻﾝﾌﾟﾙ"], 357555),
      tr("ｲﾉｳｴ ﾐｻｷ", "2345678", ["0005", "ﾐﾂﾋﾞｼUFJ", "202", "ｻﾝﾌﾟﾙ"], 401940),
      tr("ｷﾑﾗ ﾏｺﾄ", "1112223", ["0009", "ﾐﾂｲｽﾐﾄﾓ", "303", "ｻﾝﾌﾟﾙ"], 57000),
      tr("ﾔﾏﾀﾞ ﾀﾛｳ", "5556667", ["0001", "ﾐｽﾞﾎ", "101", "ｻﾝﾌﾟﾙ"], 12000),
    ]),
  );
}

async function driver(db: Db, tenantId: string, code: string) {
  const [d] = await db
    .select()
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, code)));
  return d;
}

async function staffUser(db: Db, tenantId: string) {
  const [u] = await db
    .select()
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  return { id: u.id };
}

describe("口座の取り込み（全銀の振込ファイル）", () => {
  it("置いただけでは台帳に書かない。見て選んだ人だけ書き、記録は口座番号の下 3 桁だけ。振込データの「口座が変わった人」にも出る", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const staff = await staffUser(db, tenantId);
    // 9 月に振込データを作ったときの記録（そのときの青木さんの口座の目印）
    const before = await driver(db, tenantId, "D01");
    const oldBank = {
      bankCode: "0001",
      bankNameKana: "ﾐｽﾞﾎ",
      branchCode: "101",
      branchNameKana: "ｻﾝﾌﾟﾙ",
      accountType: "ordinary" as const,
      accountNumber: "1234567",
      holderKana: "アオキ ショウタ",
    };
    await db.insert(s.auditLog).values({
      tenantId,
      action: "transfer.create",
      entity: "transfer_batch",
      entityId: "00000000-0000-4000-8000-00000000abcd",
      detail: { month: "2026-09-01", fileName: "振込_2026年9月分.txt", lines: [{ driverId: before.id, bank: bankStamp(tenantId, oldBank) }] },
      createdAt: new Date(Date.now() - 60_000),
    });
    const { id } = await createBankDraft(db, tenantId, staff, { fileName: "振込_2026年9月分.txt", bytes: septemberFile(), pageMonth: DEMO_MONTH });

    // 置いただけでは変わらない
    expect((await driver(db, tenantId, "D01")).accountNumber).toBe("1234567");
    const view = (await loadBankView(db, tenantId, id))!;
    expect(view.draft.source).toEqual({ kind: "zengin", typeLabel: "総合振込", transferDate: "1031", count: 4, total: 828495 });
    expect(view.draft.problems).toEqual([]);
    expect(view.counts).toEqual({ new: 1, changed: 1, same: 1, unmatched: 1, problem: 0, duplicate: 0 });
    const byName = Object.fromEntries(view.rows.map((r) => [r.driver?.name ?? r.input.holderKana, r]));
    expect(byName["青木 翔太"].changes).toEqual([{ field: "accountNumber", label: "口座番号", before: "****567", after: "****321" }]);
    expect(byName["木村 誠"].status).toBe("new");
    expect(byName["ﾔﾏﾀﾞ ﾀﾛｳ"].status).toBe("unmatched");

    // 選ばないと書かない・入れられない行は選べない
    const seen = Object.fromEntries(view.rows.map((r) => [String(r.index), r.seen]));
    await expect(applyBankImport(db, tenantId, staff, id, { rows: [], seen })).rejects.toThrow("チェック");
    await expect(applyBankImport(db, tenantId, staff, id, { rows: [byName["井上 美咲"].index], seen })).rejects.toThrow("入れられる行ではありません");

    const res = await applyBankImport(db, tenantId, staff, id, { rows: [byName["青木 翔太"].index, byName["木村 誠"].index], seen });
    expect(res).toMatchObject({ created: 1, updated: 1 });
    const aoki = await driver(db, tenantId, "D01");
    expect(aoki).toMatchObject({ bankCode: "0001", branchCode: "101", accountNumber: "7654321", holderKana: "アオキ ショウタ" });
    const kimura = await driver(db, tenantId, "D07");
    expect(kimura).toMatchObject({ bankCode: "0009", bankNameKana: "ﾐﾂｲｽﾐﾄﾓ", branchCode: "303", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "1112223", holderKana: "ｷﾑﾗ ﾏｺﾄ" });

    // 記録：driver.update に前後の値（口座番号は下 3 桁だけ）
    const logs = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "driver.update")));
    const aokiLog = logs.find((l) => l.entityId === aoki.id)!;
    expect(aokiLog.userId).toBe(staff.id);
    expect(aokiLog.detail).toMatchObject({ name: "青木 翔太", source: "import.bank", changed: { accountNumber: { from: "****567", to: "****321" } } });
    expect(JSON.stringify(logs.map((l) => l.detail))).not.toContain("7654321");
    expect(JSON.stringify(logs.map((l) => l.detail))).not.toContain("1112223");
    // 反映したあとは、下書きに口座番号を丸ごと持たない
    const [batch] = await db.select().from(s.importBatches).where(eq(s.importBatches.id, id));
    expect(batch.status).toBe("applied");
    expect(JSON.stringify(batch.summary)).not.toContain("7654321");
    // 2 回目は反映できない
    await expect(applyBankImport(db, tenantId, staff, id, { rows: [byName["青木 翔太"].index], seen })).rejects.toThrow("もう反映した");

    // 振込データの画面：前の振込（9 月）の口座から変わった人として、変えた人（デモ 事務）と項目つきで出る
    const review = await reviewBankChanges(db, tenantId, [
      { driverId: aoki.id, driverName: aoki.name, driverCode: aoki.code, bank: { ...oldBank, accountNumber: "7654321" } },
    ]);
    expect(review.changed).toHaveLength(1);
    expect(review.changed[0].fields).toEqual(["口座番号"]);
    expect(review.changed[0].edits).toEqual([expect.objectContaining({ userName: "デモ 事務", fields: ["口座番号"] })]);
    expect(await listBankBatches(db, tenantId)).toEqual([expect.objectContaining({ id, status: "applied", source: "zengin", created: 1, updated: 1 })]);
    await client.close();
  });

  it("画面を開いたあとで台帳の口座が変わっていたら、書かずに止める（見ていない値で上書きしない）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { id } = await createBankDraft(db, tenantId, { id: null }, { fileName: "振込.txt", bytes: septemberFile(), pageMonth: DEMO_MONTH });
    const view = (await loadBankView(db, tenantId, id))!;
    const aokiRow = view.rows.find((r) => r.driver?.name === "青木 翔太")!;
    const seen = { [String(aokiRow.index)]: aokiRow.seen };
    // ほかの画面で、青木さんの口座を直した
    await db
      .update(s.drivers)
      .set({ accountNumber: "9999999" })
      .where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    await expect(applyBankImport(db, tenantId, { id: null }, id, { rows: [aokiRow.index], seen })).rejects.toThrow("画面を開いたあとで変わっています");
    expect((await driver(db, tenantId, "D01")).accountNumber).toBe("9999999");
    await client.close();
  });

  it("当たらない行は、台帳の人を選んで当てられる（選ぶと、その人の口座として比べ直す）。やめると何も書かない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { id } = await createBankDraft(db, tenantId, { id: null }, { fileName: "振込.txt", bytes: septemberFile(), pageMonth: DEMO_MONTH });
    const view = (await loadBankView(db, tenantId, id))!;
    const yamada = view.rows.find((r) => r.status === "unmatched")!;
    const sato = await driver(db, tenantId, "D08");
    const msg = await assignBankRow(db, tenantId, id, yamada.index, sato.id);
    expect(msg).toContain("佐藤 亮さんに当てました");
    const v2 = (await loadBankView(db, tenantId, id))!;
    expect(v2.rows[yamada.index]).toMatchObject({ how: "chosen", status: "changed", driver: { name: "佐藤 亮" } });
    expect(v2.rows[yamada.index].changes.map((c) => c.label)).toEqual(["銀行コード", "銀行名", "支店コード", "口座番号", "口座名義"]);
    // 外す
    await assignBankRow(db, tenantId, id, yamada.index, null);
    expect((await loadBankView(db, tenantId, id))!.rows[yamada.index].status).toBe("unmatched");
    // やめる：何も書かず、口座番号も下 3 桁だけにする
    await discardBankDraft(db, tenantId, { id: null }, id);
    const [batch] = await db.select().from(s.importBatches).where(eq(s.importBatches.id, id));
    expect(batch.status).toBe("discarded");
    expect(JSON.stringify(batch.summary)).not.toContain("5556667");
    expect((await driver(db, tenantId, "D01")).accountNumber).toBe("1234567");
    await client.close();
  });
});

describe("口座の取り込み（口座一覧の CSV）", () => {
  it("氏名・銀行コード・支店コード・種目・口座番号・名義カナの一覧を名前で当てる。読めない行は入れない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const csv = [
      "氏名,銀行コード,支店コード,種目,口座番号,名義カナ",
      "木村 誠,9,303,普通,1112223,キムラ マコト",
      "佐藤 亮,9,310,当座,7890123,サトウ リョウ",
      "上田 健,9,303,普通,12345678,ウエダ ケン",
    ].join("\n");
    const { id, rows } = await createBankDraft(db, tenantId, { id: null }, { fileName: "口座一覧.csv", bytes: new TextEncoder().encode(csv), pageMonth: DEMO_MONTH });
    expect(rows).toBe(3);
    const view = (await loadBankView(db, tenantId, id))!;
    expect(view.draft.source).toEqual({ kind: "table", sheetName: "口座一覧", headerRow: 1 });
    expect(view.rows.map((r) => [r.driver?.name, r.how, r.status])).toEqual([
      ["木村 誠", "name", "new"],
      ["佐藤 亮", "name", "changed"],
      ["上田 健", "name", "problem"],
    ]);
    // 佐藤さん：種目だけ変わる（当座）
    expect(view.rows[1].changes).toEqual([{ field: "accountType", label: "種目", before: "普通", after: "当座" }]);
    expect(view.rows[2].input.problems[0]).toContain("7 桁までの数字ではありません");
    const seen = Object.fromEntries(view.rows.map((r) => [String(r.index), r.seen]));
    await applyBankImport(db, tenantId, { id: null }, id, { rows: [0, 1], seen });
    expect(await driver(db, tenantId, "D07")).toMatchObject({ bankCode: "0009", accountNumber: "1112223", holderKana: "キムラ マコト" });
    expect((await driver(db, tenantId, "D08")).accountType).toBe("checking");
    await client.close();
  });

  it("名義が振込データに入らない長さの行は入れない。長すぎる銀行名・支店名は入れず、コードで入れる", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const csv = [
      "氏名,銀行コード,銀行名,支店コード,支店名,種目,口座番号,名義カナ",
      // 名義：半角にすると 32 文字（30 文字まで）
      "木村 誠,9,ミツイスミトモ,303,サンプル,普通,1112223,キムラ マコト ホンニンメイギノナマエガトテモナガイデス",
      // 銀行名：半角にすると 18 文字（15 文字まで）→ 入れない（台帳に無いので空のまま）。コード・番号・名義は入れる
      "佐藤 亮,5,ミツビシユーエフジェイギンコウ,310,サンプル,普通,7890123,サトウ リョウ",
    ].join("\n");
    const { id } = await createBankDraft(db, tenantId, { id: null }, { fileName: "口座一覧.csv", bytes: new TextEncoder().encode(csv), pageMonth: DEMO_MONTH });
    const view = (await loadBankView(db, tenantId, id))!;
    expect(view.rows.map((r) => [r.driver?.name, r.status])).toEqual([
      ["木村 誠", "problem"],
      ["佐藤 亮", "changed"],
    ]);
    expect(view.rows[0].input.problems).toEqual([expect.stringContaining("半角 30 文字までです（いまは 32 文字）")]);
    expect(view.rows[1].input.notes).toEqual([expect.stringContaining("銀行名「ミツビシユーエフジェイギンコウ」は半角 15 文字を超える")]);
    // 銀行が変わるので、今の銀行名（ﾐﾂｲｽﾐﾄﾓ）は残さず空にする
    expect(view.rows[1].next).toMatchObject({ bankCode: "0005", bankNameKana: "", branchCode: "310", branchNameKana: "サンプル" });
    await client.close();
  });

  it("読めないファイルは、次にすることを添えて断る", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const up = (fileName: string, text: string) =>
      createBankDraft(db, tenantId, { id: null }, { fileName, bytes: new TextEncoder().encode(text), pageMonth: DEMO_MONTH });
    await expect(up("名簿.csv", "名前,住所\n青木,東京\n")).rejects.toThrow("見出し");
    await expect(up("振込.txt", "abc")).rejects.toThrow("全銀の振込ファイル");
    await expect(up("空.csv", "")).rejects.toThrow("空");
    await client.close();
  });
});

describe("口座の取り込み：ほかの会社", () => {
  it("別の会社の取り込みは見えず・当てられず・反映できない。別の会社のドライバーには当てられない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId: t1 } = await seedDemo(db);
    const { tenantId: t2 } = await seedDemo(db);
    const { id } = await createBankDraft(db, t1, { id: null }, { fileName: "振込.txt", bytes: septemberFile(), pageMonth: DEMO_MONTH });
    const view = (await loadBankView(db, t1, id))!;
    const seen = Object.fromEntries(view.rows.map((r) => [String(r.index), r.seen]));
    expect(await loadBankView(db, t2, id)).toBeNull();
    await expect(applyBankImport(db, t2, { id: null }, id, { rows: [0], seen })).rejects.toThrow("見つかりません");
    await expect(discardBankDraft(db, t2, { id: null }, id)).rejects.toThrow("見つかりません");
    const other = await driver(db, t2, "D08");
    const unmatched = view.rows.find((r) => r.status === "unmatched")!;
    await expect(assignBankRow(db, t1, id, unmatched.index, other.id)).rejects.toThrow("見つかりません");
    expect(await listBankBatches(db, t2)).toEqual([]);
    // 会社 1 で反映しても、会社 2 の同じ名前の人の口座は変わらない
    await applyBankImport(db, t1, { id: null }, id, { rows: view.rows.filter((r) => r.status === "new" || r.status === "changed").map((r) => r.index), seen });
    expect((await driver(db, t2, "D01")).accountNumber).toBe("1234567");
    expect((await driver(db, t2, "D07")).accountNumber).toBeNull();
    expect((await driver(db, t1, "D01")).accountNumber).toBe("7654321");
    await client.close();
  });
});

describe("稼働の取り込みに振込ファイルを置いたとき", () => {
  it("全銀の振込ファイルは稼働の表として読まず、口座の取り込みへ案内する", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { createDraftFromFile } = await import("~/server/features/import/service");
    await expect(createDraftFromFile(db, tenantId, { id: null }, { fileName: "振込.txt", bytes: septemberFile(), pageMonth: DEMO_MONTH })).rejects.toThrow(
      "口座の一覧を取り込む",
    );
    await client.close();
  });
});
