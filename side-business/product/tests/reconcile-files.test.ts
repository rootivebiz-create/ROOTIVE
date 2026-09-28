/**
 * 同じ元請・同じ月に何通も届くお支払通知（営業所ごとなど）：足す・1 つだけ入れ替える・外す・列の選び直し。
 * あわせて、PDF しか無いときの「表の貼り付け」を TSV にする部分。
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { importNotice, listMonth, loadNoticeView, loadReport, removeNoticeFile, runReconcile, setItemStatus, updateNoticeColumns } from "~/server/features/reconcile";
import { assignLines, joinFileNames, sameLines } from "~/server/features/reconcile/files";
import { pastedTableToTsv, pasteFileName } from "~/server/features/reconcile/paste";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { parseCsv } from "~/server/tabular";
import { createTestDb } from "./helpers/db";

const csv = (text: string) => new TextEncoder().encode(text);
const HEAD = "品目,数量,単価,金額\n";

async function setup() {
  const { db, client } = await createTestDb();
  const { tenantId } = await seedDemo(db);
  const clients = await db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId));
  const a = clients.find((c) => c.name.startsWith("A物流"))!;
  const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  return { db, client, tenantId, a, noticeId: notice.id, userId: owner.id };
}

async function items(db: Db, tenantId: string, noticeId: string) {
  const rows = await db
    .select()
    .from(s.reconciliationItems)
    .where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
  return rows.map((r) => ({ kind: r.kind, label: r.label, diff: r.diff, status: r.status, note: r.note, id: r.id })).sort((x, y) => x.label.localeCompare(y.label, "ja"));
}

async function noticeRow(db: Db, noticeId: string) {
  const [n] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.id, noticeId));
  return n;
}

async function lineCount(db: Db, noticeId: string) {
  return (await db.select().from(s.paymentNoticeLines).where(eq(s.paymentNoticeLines.noticeId, noticeId))).length;
}

// デモの A物流・10 月：お支払通知（見本）は 宅配 4,520 個・企業配 61 日・夜間便 20 便 × 11,500円。当社の記録は 宅配 4,950 個・夜間便 12,000円
const SEED_TOTAL = 858800 + 1342000 + 230000;

describe("ファイルの割り当て（純関数）", () => {
  it("行の id を持つファイルはその行、持たない前の版のファイルは残りの行。どちらも無い行は unclaimed", () => {
    const lines = ["l1", "l2", "l3", "l4"];
    const both = assignLines(
      [
        { id: "old", lineIds: null },
        { id: "new", lineIds: ["l3", "l4", "gone"] },
      ],
      lines,
    );
    expect(both.byFile.get("new")).toEqual(["l3", "l4"]);
    expect(both.byFile.get("old")).toEqual(["l1", "l2"]);
    expect(both.unclaimed).toEqual([]);
    const noLegacy = assignLines([{ id: "new", lineIds: ["l4"] }], lines);
    expect(noLegacy.unclaimed).toEqual(["l1", "l2", "l3"]);
    // 同じ行を 2 つのファイルが持っていても、先のファイルのものにする（二重に消さない）
    const twice = assignLines(
      [
        { id: "a", lineIds: ["l1"] },
        { id: "b", lineIds: ["l1", "l2"] },
      ],
      ["l1", "l2"],
    );
    expect(twice.byFile.get("b")).toEqual(["l2"]);
  });

  it("中身が同じかは並びを問わず比べる。空のファイル同士は同じとしない", () => {
    const x = { rawProject: "宅配", rawDriver: null, qty: 430, unitPrice: 190, amount: 81700 };
    const y = { rawProject: "夜間便 ", rawDriver: "青木", qty: 1, unitPrice: 12000, amount: 12000 };
    expect(sameLines([x, y], [{ ...y, rawProject: "夜間便" }, x])).toBe(true);
    expect(sameLines([x, y], [x, { ...y, amount: 12001 }])).toBe(false);
    expect(sameLines([x], [x, x])).toBe(false);
    expect(sameLines([], [])).toBe(false);
    expect(joinFileNames(["本社.csv", " ", "北営業所.csv"])).toBe("本社.csv、北営業所.csv");
  });
});

describe("表の貼り付け（純関数）", () => {
  it("タブで区切られた表（Excel・画面の表のコピー）は、そのまま使う", () => {
    const t = pastedTableToTsv("品目\t数量\t単価\t金額\r\n宅配\t4,520\t190\t858,800\r\n\r\n");
    expect(t).toMatchObject({ rows: 2, columns: 4, splitBySpaces: false });
    expect(parseCsv(t.tsv, "\t").filter((r) => r.some(Boolean))).toEqual([
      ["品目", "数量", "単価", "金額"],
      ["宅配", "4,520", "190", "858,800"],
    ]);
  });

  it("PDF のコピー（空白で区切られた文字）：見出しの列の数に合わせ、名前の空白はまとめ、足りない行は数字を右に寄せる", () => {
    const pdf = [
      "A物流（架空）　お支払通知書　2026年10月分",
      "品目 数量 単価 金額",
      "宅配 個建て 4,520 190 858,800",
      "企業配 61 22,000 1,342,000",
      "待機料 3,000",
      "合計 2,433,800",
    ].join("\n");
    const t = pastedTableToTsv(pdf);
    expect(t.splitBySpaces).toBe(true);
    expect(parseCsv(t.tsv, "\t").filter((r) => r.some(Boolean))).toEqual([
      ["A物流（架空）", "お支払通知書", "2026年10月分"],
      ["品目", "数量", "単価", "金額"],
      ["宅配 個建て", "4,520", "190", "858,800"],
      ["企業配", "61", "22,000", "1,342,000"],
      ["待機料", "", "", "3,000"],
      ["合計", "", "", "2,433,800"],
    ]);
    // ドライバーの列があって、列の数が見出しと同じ行は、そのまま
    const withDriver = pastedTableToTsv("品目 ドライバー 数量 単価 金額\n宅配 青木 2,310 190 438,900");
    expect(parseCsv(withDriver.tsv, "\t")[1]).toEqual(["宅配", "青木", "2,310", "190", "438,900"]);
    // " の入った名前も、区切りを壊さない
    const quoted = pastedTableToTsv('品目 金額\n"特急" 1,000');
    expect(parseCsv(quoted.tsv, "\t")[1]).toEqual(['"特急"', "1,000"]);
  });

  it("ファイル名：入れた名前を .tsv にする（区切りの文字は外す）。無ければ「貼り付けた表」", () => {
    expect(pasteFileName("北営業所の分")).toBe("北営業所の分.tsv");
    expect(pasteFileName(" ../a/b:c ")).toBe("..abc.tsv");
    expect(pasteFileName("")).toBe("貼り付けた表.tsv");
    expect(pasteFileName(null)).toBe("貼り付けた表.tsv");
  });
});

describe("同じ元請・同じ月に何通も届くお支払通知（DB）", () => {
  it("足す：前のファイルの行に足して、合計で突き合わせる。見本（ファイルの記録が無い行）も 1 つのファイルとして残る", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await runReconcile(db, tenantId, noticeId, userId);
    const [, yakan] = await items(db, tenantId, noticeId);
    await setItemStatus(db, tenantId, userId, { itemId: yakan.id, status: "asked", note: "11/2 メールで確認中" });

    // 北営業所の分：宅配 430 個 → 本社の 4,520 個と合わせて 4,950 個（当社の記録と同じ）
    const res = await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北営業所.csv", bytes: csv(`${HEAD}宅配,430,190,81700\n`), replace: false, add: true });
    expect(res).toMatchObject({ noticeId, added: true, replaced: false, replacedFile: null, lineCount: 1 });
    const notice = await noticeRow(db, noticeId);
    expect(notice.total).toBe(SEED_TOTAL + 81700);
    expect(notice.fileName).toBe("A物流_支払通知_2026年10月.csv、北営業所.csv");
    expect(await lineCount(db, noticeId)).toBe(4);

    // 宅配の数量の差は無くなり、夜間便の単価の差（問い合わせ中・メモつき）はそのまま残る
    expect(await items(db, tenantId, noticeId)).toEqual([expect.objectContaining({ kind: "price", label: "夜間便", diff: -10000, status: "asked", note: "11/2 メールで確認中" })]);
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.files.map((f) => [f.fileName, f.lineCount, f.total, f.detail === null])).toEqual([
      ["A物流_支払通知_2026年10月.csv", 3, SEED_TOTAL, true],
      ["北営業所.csv", 1, 81700, false],
    ]);
    expect(view.batch?.total).toBe(81700);
    expect(view.live.theirTotal).toBe(SEED_TOTAL + 81700);
    expect(view.totals).toMatchObject({ short: 10000, shortCount: 1 });
    const month = await listMonth(db, tenantId, DEMO_MONTH);
    expect(month.rows.find((r) => r.clientId === a.id)?.notice).toMatchObject({ short: 10000, shortCount: 1, lineCount: 4, total: SEED_TOTAL + 81700 });
    const report = await loadReport(db, tenantId, DEMO_MONTH, DEMO_MONTH);
    expect(report.totals).toMatchObject({ short: 10000, notices: 1 });

    // 操作の記録には「取り込んだ（足した）」として残る
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "reconcile.notice_import")));
    expect(logs.at(-1)?.detail).toMatchObject({ mode: "add", fileName: "北営業所.csv", lines: 1, total: 81700 });
    await client.close();
  });

  it("同じファイル・同じ中身のファイルは二重に足さない（止めて知らせる。何も変えない）", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    const file = csv(`${HEAD}宅配,430,190,81700\n`);
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北営業所.csv", bytes: file, replace: false, add: true });
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北営業所(1).csv", bytes: file, replace: false, add: true })).rejects.toThrow(
      "同じファイルが、もう入っています（北営業所.csv）",
    );
    // バイトは違っても（BOM・改行）、行の中身が同じなら止める
    const sameContent = csv(`﻿${HEAD.replace("\n", "\r\n")}宅配,430,190,"81,700"\r\n合計,,,81700\r\n`);
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北_再送.csv", bytes: sameContent, replace: false, add: true })).rejects.toThrow(
      "中身が同じです。二重に数えないように止めました。直したお支払通知なら「入れ替える」を使ってください。別の営業所の分で、たまたま同じ中身のときは「中身が同じでも足す」",
    );
    // 見本（ファイルの記録が無い行）と同じ中身も止める
    await expect(
      importNotice(db, tenantId, userId, {
        clientId: a.id,
        month: DEMO_MONTH,
        fileName: "本社の写し.csv",
        bytes: csv(`${HEAD}宅配,4520,190,858800\n企業配,61,22000,1342000\n夜間便,20,11500,230000\n`),
        replace: false,
        add: true,
      }),
    ).rejects.toThrow("A物流_支払通知_2026年10月.csv");
    expect(await lineCount(db, noticeId)).toBe(4);
    expect((await noticeRow(db, noticeId)).total).toBe(SEED_TOTAL + 81700);
    // 別の営業所の分で、たまたま同じ中身のときは、チェックを入れれば足せる（同じファイルそのものは足せないまま）
    await expect(
      importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北営業所(1).csv", bytes: file, replace: false, add: true, allowSameContent: true }),
    ).rejects.toThrow("同じファイルが、もう入っています");
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "南営業所.csv", bytes: sameContent, replace: false, add: true, allowSameContent: true });
    expect(await lineCount(db, noticeId)).toBe(5);
    expect((await noticeRow(db, noticeId)).total).toBe(SEED_TOTAL + 81700 * 2);
    // 列の分からないファイルは足さない（その分が 0 のまま突き合わせないように）
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "メモ.csv", bytes: csv("メモ\nよろしくお願いします\n"), replace: false, add: true })).rejects.toThrow(
      "どの列が品目・金額か分かりませんでした",
    );
    // 選ばなければ止めて、「入れ替える」「足す」を案内する
    await expect(importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "南.csv", bytes: csv(`${HEAD}宅配,1,190,190\n`), replace: false })).rejects.toThrow(
      "「足す」を選んでください",
    );
    await client.close();
  });

  it("1 つのファイルだけ入れ替える・外す：ほかのファイルの行は残し、合計・ファイル名・手数料を出し直す", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    const added = await importNotice(db, tenantId, userId, {
      clientId: a.id,
      month: DEMO_MONTH,
      fileName: "北営業所.csv",
      bytes: csv(`${HEAD}宅配,430,190,81700\n振込手数料,,,-660\n`),
      replace: false,
      add: true,
    });
    expect((await noticeRow(db, noticeId)).feeDeducted).toBe(660);
    const north = (await loadNoticeView(db, tenantId, noticeId)).files[1];
    expect(north.fileName).toBe("北営業所.csv");

    // 北営業所の分を直したもの（宅配 400 個）に入れ替える → 宅配は 4,920 個で −5,700円
    const re = await importNotice(db, tenantId, userId, {
      clientId: a.id,
      month: DEMO_MONTH,
      fileName: "北営業所_訂正.csv",
      bytes: csv(`${HEAD}宅配,400,190,76000\n`),
      replace: false,
      replaceFileId: north.id,
    });
    expect(re).toMatchObject({ noticeId: added.noticeId, replacedFile: "北営業所.csv", added: false, replaced: true });
    let notice = await noticeRow(db, noticeId);
    expect(notice.total).toBe(SEED_TOTAL + 76000);
    expect(notice.fileName).toBe("A物流_支払通知_2026年10月.csv、北営業所_訂正.csv");
    expect(notice.feeDeducted).toBe(0);
    expect(await lineCount(db, noticeId)).toBe(4);
    expect((await items(db, tenantId, noticeId)).map((i) => [i.kind, i.label, i.diff])).toEqual([
      ["qty", "宅配（個建て）", -5700],
      ["price", "夜間便", -10000],
    ]);
    // 入れ替えたファイルは、もう入れ替えられない（画面が古いとき）
    await expect(
      importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "x.csv", bytes: csv(`${HEAD}宅配,1,190,190\n`), replace: false, replaceFileId: north.id }),
    ).rejects.toThrow("入れ替えるファイルが見つかりません");

    // 外す：見本の 3 行だけに戻り、宅配の差は −81,700円 に戻る
    const files = (await loadNoticeView(db, tenantId, noticeId)).files;
    expect(files).toHaveLength(2);
    const out = await removeNoticeFile(db, tenantId, userId, { noticeId, fileId: files[1].id });
    expect(out.fileName).toBe("北営業所_訂正.csv");
    notice = await noticeRow(db, noticeId);
    expect(notice.total).toBe(SEED_TOTAL);
    expect(notice.fileName).toBe("A物流_支払通知_2026年10月.csv");
    expect(await lineCount(db, noticeId)).toBe(3);
    expect((await items(db, tenantId, noticeId)).find((i) => i.label === "宅配（個建て）")?.diff).toBe(-81700);
    // 最後の 1 つは外せない（削除か入れ替えを使う）
    await expect(removeNoticeFile(db, tenantId, userId, { noticeId, fileId: files[0].id })).rejects.toThrow("ファイルが 1 つだけ");
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "reconcile.notice_replace")));
    expect(logs.map((l) => (l.detail as { mode?: string }).mode)).toEqual(["replaceFile", "removeFile"]);
    await client.close();
  });

  it("列の選び直しは、選んだファイルの行だけを読み直す（ほかのファイルの行は消さない）。中身の記録が無いファイルは選び直せない", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "北営業所.csv", bytes: csv(`${HEAD}宅配,430,190,81700\n`), replace: false, add: true });
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "待機料.csv", bytes: csv(`${HEAD}待機料,3,1000,3000\n`), replace: false, add: true });
    const files = (await loadNoticeView(db, tenantId, noticeId)).files;
    expect(files.map((f) => f.fileName)).toEqual(["A物流_支払通知_2026年10月.csv", "北営業所.csv", "待機料.csv"]);

    // 北営業所の分を「金額の列を使わない（数量 × 単価）」で読み直す
    const res = await updateNoticeColumns(db, tenantId, userId, {
      noticeId,
      fileId: files[1].id,
      headerRow: 1,
      columns: { item: 0, qty: 1, unitPrice: 2, amount: null, driver: null, date: null },
    });
    expect(res.lineCount).toBe(1);
    expect(await lineCount(db, noticeId)).toBe(5);
    expect((await noticeRow(db, noticeId)).total).toBe(SEED_TOTAL + 81700 + 3000);
    const after = (await loadNoticeView(db, tenantId, noticeId)).files;
    expect(after[1].detail?.columns.amount).toBeNull();
    expect(after[2].detail?.columns.amount).toBe(3);
    await expect(
      updateNoticeColumns(db, tenantId, userId, { noticeId, fileId: files[0].id, headerRow: 1, columns: { item: 0, qty: 1, unitPrice: 2, amount: 3, driver: null, date: null } }),
    ).rejects.toThrow("読み取ったファイルの記録がありません");

    // 全部を入れ替える：足したファイルもまとめて入れ替わり、1 つに戻る
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: "まとめ.csv", bytes: csv(`${HEAD}宅配,4950,190,940500\n`), replace: true });
    const one = await loadNoticeView(db, tenantId, noticeId);
    expect(one.files.map((f) => f.fileName)).toEqual(["まとめ.csv"]);
    expect(await lineCount(db, noticeId)).toBe(1);
    expect((await noticeRow(db, noticeId)).fileName).toBe("まとめ.csv");
    await client.close();
  });

  it("貼り付けた表（PDF のコピー）も、同じ流れで足せる", async () => {
    const { db, client, tenantId, a, noticeId, userId } = await setup();
    const table = pastedTableToTsv("品目 数量 単価 金額\n宅配 430 190 81,700\n合計 81,700");
    await importNotice(db, tenantId, userId, { clientId: a.id, month: DEMO_MONTH, fileName: pasteFileName("北営業所の分"), bytes: csv(table.tsv), replace: false, add: true });
    const view = await loadNoticeView(db, tenantId, noticeId);
    expect(view.files.at(-1)).toMatchObject({ fileName: "北営業所の分.tsv", lineCount: 1, total: 81700 });
    expect(view.batch).toMatchObject({ fileTotal: 81700, total: 81700, warnings: [] });
    expect(view.live.theirTotal).toBe(SEED_TOTAL + 81700);
    await client.close();
  });
});
