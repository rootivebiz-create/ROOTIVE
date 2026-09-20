import { describe, expect, it } from "vitest";
import {
  detectNoticeDelimiter,
  detectNoticeHeader,
  guessNoticeColumns,
  guessNoticeColumnsByShape,
  isNoticeTotalRow,
  noticeCsvSummaryText,
  noticeCsvTotal,
  noticeHeaderScore,
  normalizePastedTable,
  parseNoticeCsv,
  parseNoticeNumber,
} from "@/lib/notices/csv";
import {
  diffCause,
  explainDiff,
  noticeDiffSummary,
  noticeDiffSummaryText,
  noticeDiffTone,
  noticeListSummary,
  noticeStatusTone,
  noticeTotalMismatchText,
  type NoticeDiffLike,
} from "@/lib/notices/diff";
import { groupItemOptions, itemOptionLabel, toNoticeDiffItem, toNoticeListItem } from "@/lib/notices/view";
import { noticeDiffCsvFilename, noticeDiffToCsv } from "@/lib/exports/notice-csv";
import { importNoticeItemsSchema, noticeInputSchema, noticeItemSchema, noticeStatusSchema } from "@/lib/schemas/notices";
import type { PaymentNoticeDiffRow, PaymentNoticeRow } from "@/lib/db/types";

// ===========================================================================
// A. CSV・貼り付けの読み取り（lib/notices/csv.ts）
// ===========================================================================

const BASIC_CSV = ["内容,数量,単価,金額", "板橋エリア 定期便,20,23025,460500", "スポット便,3,12000,36000"].join("\n");

describe("parseNoticeCsv（見出しのある CSV）", () => {
  it("内容・数量・単価・金額の 4 列をそのまま読み取る", () => {
    const result = parseNoticeCsv(BASIC_CSV);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ raw_name: "板橋エリア 定期便", qty: 20, unit_price: 23025, amount: 460500, derived: null });
    expect(result.rows[1]).toMatchObject({ raw_name: "スポット便", qty: 3, unit_price: 12000, amount: 36000 });
    expect(result.errors).toEqual([]);
  });

  it("どの列をどう読んだかを日本語で返す", () => {
    const result = parseNoticeCsv(BASIC_CSV);
    expect(result.columnReport).toEqual([
      "内容 ← 「内容」（1 列目）",
      "数量 ← 「数量」（2 列目）",
      "単価 ← 「単価」（3 列目）",
      "金額 ← 「金額」（4 列目）",
    ]);
  });

  it("列名の言い方が違っても読み取る（コース名・稼働日数・支払単価・支払金額）", () => {
    const csv = ["コース名,稼働日数,支払単価,支払金額", "川越ルート,18,22500,405000"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.columns).toEqual({ name: 0, qty: 1, unit_price: 2, amount: 3 });
    expect(result.rows[0]).toMatchObject({ raw_name: "川越ルート", qty: 18, unit_price: 22500, amount: 405000 });
  });

  it("全角数字・カンマ・「¥」「円」・単位が付いていても数値として読む", () => {
    const csv = ["内容,数量,単価,金額", "定期便,２０個,¥23,025,460,500円"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows[0]).toMatchObject({ qty: 20, unit_price: 23025, amount: 460500 });
  });

  it("前置きの行（宛名・タイトル）があってもヘッダー行を見つける", () => {
    const csv = ["株式会社ROOTIVE 御中", "2026年9月分 支払明細書", "", "内容,数量,単価,金額", "定期便,20,23025,460500"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.headerRow).toBe(3);
    expect(result.rows).toHaveLength(1);
  });

  it("BOM 付きのテキストでも 1 列目の見出しを読み違えない", () => {
    const result = parseNoticeCsv(`﻿${BASIC_CSV}`);
    expect(result.columns.name).toBe(0);
    expect(result.rows).toHaveLength(2);
  });

  it("合計・消費税の行は取り込まずに理由を返す", () => {
    const csv = [BASIC_CSV, "小計,,,496500", "消費税,,,49650", "合計,,,546150"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(3);
    expect(result.errors.join("")).toContain("合計・消費税の行のため取り込みませんでした");
  });

  it("内容が空の行は取り込まずに理由を返す", () => {
    const csv = ["内容,数量,単価,金額", ",5,1000,5000", "定期便,20,23025,460500"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.join("")).toContain("内容が空のため取り込みませんでした");
  });

  it("数量・単価・金額をどれも読めない行は取り込まない", () => {
    const csv = ["内容,数量,単価,金額", "備考欄です,,,", "定期便,20,23025,460500"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.join("")).toContain("どれも読み取れませんでした");
  });
});

describe("parseNoticeCsv（足りない列を計算で補う）", () => {
  it("金額が空なら 数量 × 単価 で埋める", () => {
    const csv = ["内容,数量,単価,金額", "定期便,20,23025,"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows[0].amount).toBe(460500);
    expect(result.rows[0].derived).toBe("amount");
  });

  it("金額の列が無いときは案内を返して 数量 × 単価 で埋める", () => {
    const csv = ["内容,数量,単価", "定期便,20,23025"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.columnReport).toContain("金額 ← 見つかりませんでした（数量 × 単価 で計算します）");
    expect(result.rows[0].amount).toBe(460500);
  });

  it("単価が空なら 金額 ÷ 数量 で埋める", () => {
    const csv = ["内容,数量,単価,金額", "定期便,20,,460500"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows[0].unit_price).toBe(23025);
    expect(result.rows[0].derived).toBe("unit_price");
  });

  it("数量が空なら 金額 ÷ 単価 で埋める", () => {
    const csv = ["内容,数量,単価,金額", "定期便,,23025,460500"].join("\n");
    const result = parseNoticeCsv(csv);
    expect(result.rows[0].qty).toBe(20);
  });
});

describe("parseNoticeCsv（貼り付けたテキスト）", () => {
  it("タブ区切りの貼り付けを読み取る", () => {
    const text = ["内容\t数量\t単価\t金額", "定期便\t20\t23,025\t460,500"].join("\n");
    const result = parseNoticeCsv(text);
    expect(result.delimiter).toBe("\t");
    expect(result.rows[0]).toMatchObject({ raw_name: "定期便", qty: 20, amount: 460500 });
  });

  it("空白で桁を揃えた表（PDF からの貼り付け）も読み取る", () => {
    const text = ["内容     数量   単価     金額", "定期便    20   23025   460500"].join("\n");
    const result = parseNoticeCsv(text);
    expect(result.notes.join("")).toContain("空白で桁を揃えた表");
    expect(result.rows[0]).toMatchObject({ raw_name: "定期便", qty: 20, unit_price: 23025, amount: 460500 });
  });

  it("見出しが無いときは列の並びから推測し、その旨を案内する", () => {
    const text = ["定期便,20,23025,460500", "スポット便,3,12000,36000"].join("\n");
    const result = parseNoticeCsv(text);
    expect(result.headerRow).toBe(-1);
    expect(result.columns).toEqual({ name: 0, qty: 1, unit_price: 2, amount: 3 });
    expect(result.notes.join("")).toContain("列の並びから推測");
    expect(result.rows).toHaveLength(2);
  });

  it("見出しが無く数値が 2 列のときは、小さい数を数量・大きい数を金額とみなす", () => {
    const text = ["定期便,20,460500", "スポット便,3,36000"].join("\n");
    const result = parseNoticeCsv(text);
    expect(result.columns.qty).toBe(1);
    expect(result.columns.amount).toBe(2);
    expect(result.rows[0].unit_price).toBe(23025);
  });

  it("中身が空なら日本語のエラーを返す", () => {
    const result = parseNoticeCsv("   ");
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain("中身がありません");
  });

  it("上限を超えた行は取り込まずに知らせる", () => {
    const lines = ["内容,数量,単価,金額"];
    for (let i = 0; i < 5; i += 1) lines.push(`便${i},1,1000,1000`);
    const result = parseNoticeCsv(lines.join("\n"), { maxRows: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.errors.join("")).toContain("3 行を超えたため");
  });
});

describe("読み取りの部品", () => {
  it("parseNoticeNumber は全角・カンマ・記号つきでも読み、読めなければ null", () => {
    expect(parseNoticeNumber("1,200円")).toBe(1200);
    expect(parseNoticeNumber("２０個")).toBe(20);
    expect(parseNoticeNumber("¥23,025")).toBe(23025);
    expect(parseNoticeNumber("（税抜）")).toBeNull();
    expect(parseNoticeNumber("")).toBeNull();
  });

  it("isNoticeTotalRow は合計行だけを見分ける", () => {
    expect(isNoticeTotalRow("合計")).toBe(true);
    expect(isNoticeTotalRow("消費税")).toBe(true);
    expect(isNoticeTotalRow("計量作業")).toBe(false);
    expect(isNoticeTotalRow("定期便")).toBe(false);
  });

  it("detectNoticeDelimiter はタブとコンマを数で比べる", () => {
    expect(detectNoticeDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectNoticeDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("normalizePastedTable はコンマもタブも無いときだけタブに直す", () => {
    expect(normalizePastedTable("定期便   20").converted).toBe(true);
    expect(normalizePastedTable("定期便,20").converted).toBe(false);
  });

  it("noticeHeaderScore は完全一致を部分一致より強くする", () => {
    expect(noticeHeaderScore("数量", "qty")).toBeGreaterThan(noticeHeaderScore("配達数量計", "qty"));
    expect(noticeHeaderScore("単価", "amount")).toBe(0);
  });

  it("guessNoticeColumns は同じ列を 2 つの項目に割り当てない", () => {
    const columns = guessNoticeColumns(["内容", "数量", "単価", "金額"]);
    const used = [columns.name, columns.qty, columns.unit_price, columns.amount];
    expect(new Set(used).size).toBe(4);
  });

  it("detectNoticeHeader は明細だけの表ではヘッダーを見つけない", () => {
    const detected = detectNoticeHeader([["定期便", "20", "23025", "460500"]]);
    expect(detected.headerRow).toBe(-1);
  });

  it("guessNoticeColumnsByShape は数値以外の最初の列を内容とみなす", () => {
    const columns = guessNoticeColumnsByShape([
      ["定期便", "20", "23025", "460500"],
      ["スポット便", "3", "12000", "36000"],
    ]);
    expect(columns.name).toBe(0);
    expect(columns.amount).toBe(3);
  });

  it("noticeCsvTotal と noticeCsvSummaryText は合計を誤差なく出す", () => {
    const result = parseNoticeCsv(BASIC_CSV);
    expect(noticeCsvTotal(result.rows)).toBe(496500);
    expect(noticeCsvSummaryText(result)).toContain("2 行・合計 ¥496,500");
  });
});

// ===========================================================================
// B. 差の集計と説明（lib/notices/diff.ts）
// ===========================================================================

/** 突合の 1 行を作る（数量と単価から金額を組み立てる） */
function diffRow(over: Partial<NoticeDiffLike> & { noticeQty: number; noticeRate: number; ourQty: number; ourRate: number }): NoticeDiffLike {
  const noticeAmount = over.noticeQty * over.noticeRate;
  const ourAmount = over.ourQty * over.ourRate;
  const status = over.ourQty === 0 && ourAmount === 0 ? "notice_more" : Math.abs(noticeAmount - ourAmount) < 1 ? "ok" : noticeAmount > ourAmount ? "notice_more" : "notice_less";
  return {
    diff_status: status,
    raw_name: "定期便",
    project_name: "板橋エリア",
    item_name: "定期便",
    notice_qty: over.noticeQty,
    notice_unit_price: over.noticeRate,
    notice_amount: noticeAmount,
    our_qty: over.ourQty,
    our_amount: ourAmount,
    our_unit_price: over.ourQty === 0 ? null : over.ourRate,
    qty_diff: over.noticeQty - over.ourQty,
    amount_diff: noticeAmount - ourAmount,
    ...over,
  };
}

const QTY_SHORT = diffRow({ noticeQty: 18, noticeRate: 23025, ourQty: 20, ourRate: 23025 });
const RATE_OLD = diffRow({ noticeQty: 20, noticeRate: 22500, ourQty: 20, ourRate: 23025 });
const MATCHED = diffRow({ noticeQty: 20, noticeRate: 23025, ourQty: 20, ourRate: 23025 });

describe("explainDiff（1 行の日本語の説明）", () => {
  it("数量が足りないときは数量の差として説明する", () => {
    const text = explainDiff(QTY_SHORT);
    expect(text).toContain("通知の数量が 2 少ない");
    expect(text).toContain("¥46,050");
    expect(text).toContain("通知 18・自社 20");
  });

  it("数量が多いときも数量の差として説明する", () => {
    const text = explainDiff(diffRow({ noticeQty: 22, noticeRate: 23025, ourQty: 20, ourRate: 23025 }));
    expect(text).toContain("通知の数量が 2 多い");
  });

  it("単価が古いままのときは単価の差として説明する", () => {
    const text = explainDiff(RATE_OLD);
    expect(text).toContain("単価が ¥23,025 ではなく ¥22,500 で計算されています");
    expect(text).toContain("¥10,500");
  });

  it("数量も単価も違うときは両方を並べて説明する", () => {
    const text = explainDiff(diffRow({ noticeQty: 18, noticeRate: 22500, ourQty: 20, ourRate: 23025 }));
    expect(text).toContain("数量も単価も違います");
    expect(text).toContain("通知 18 × ¥22,500");
    expect(text).toContain("自社 20 × ¥23,025");
  });

  it("一致しているときは一致と伝える", () => {
    expect(explainDiff(MATCHED)).toBe("通知の金額と自社の売上は一致しています。");
  });

  it("案件内容が未紐づけのときは選ぶように案内する", () => {
    const row = { ...MATCHED, diff_status: "unmatched", project_name: "", item_name: "" };
    expect(explainDiff(row)).toContain("案件内容が紐づいていないため");
  });

  it("自社に稼働が無いときは登録漏れを疑うよう案内する", () => {
    const row = diffRow({ noticeQty: 5, noticeRate: 10000, ourQty: 0, ourRate: 0 });
    const text = explainDiff(row);
    expect(text).toContain("自社にこの案件内容の稼働がありません");
    expect(text).toContain("¥50,000");
  });

  it("数量も単価も同じなのに金額だけ違うときはそのまま伝える", () => {
    const row: NoticeDiffLike = {
      ...MATCHED,
      notice_amount: 460000,
      amount_diff: -500,
      qty_diff: 0,
      diff_status: "notice_less",
    };
    expect(explainDiff(row)).toContain("数量と単価は同じですが");
  });

  it("diffCause は差の原因を見分ける", () => {
    expect(diffCause(QTY_SHORT)).toBe("qty");
    expect(diffCause(RATE_OLD)).toBe("price");
    expect(diffCause(MATCHED)).toBe("ok");
    expect(diffCause({ ...MATCHED, diff_status: "unmatched" })).toBe("unmatched");
    expect(diffCause(diffRow({ noticeQty: 5, noticeRate: 10000, ourQty: 0, ourRate: 0 }))).toBe("missing");
  });
});

describe("noticeDiffSummary（突合のまとめ）", () => {
  const rows = [MATCHED, QTY_SHORT, RATE_OLD, { ...MATCHED, diff_status: "unmatched" }];

  it("判定ごとの件数を数える", () => {
    const summary = noticeDiffSummary(rows);
    expect(summary.count).toBe(4);
    expect(summary.ok).toBe(1);
    expect(summary.noticeLess).toBe(2);
    expect(summary.unmatched).toBe(1);
    expect(summary.mismatched).toBe(2);
  });

  it("合計は誤差なく足す（sumMoney）", () => {
    const summary = noticeDiffSummary([QTY_SHORT, RATE_OLD]);
    expect(summary.noticeTotal).toBe(18 * 23025 + 20 * 22500);
    expect(summary.ourTotal).toBe(20 * 23025 * 2);
    expect(summary.diffTotal).toBe(-56550);
    expect(summary.lessTotal).toBe(-56550);
    expect(summary.moreTotal).toBe(0);
  });

  it("明細が無いときは 0 件として返す", () => {
    const summary = noticeDiffSummary([]);
    expect(summary.count).toBe(0);
    expect(summary.diffTotal).toBe(0);
    expect(noticeDiffSummaryText(summary)).toBe("明細がまだ取り込まれていません。");
  });

  it("まとめの 1 行は差の件数と差額を伝える", () => {
    expect(noticeDiffSummaryText(noticeDiffSummary(rows))).toContain("2 件に差があります");
    expect(noticeDiffSummaryText(noticeDiffSummary([MATCHED]))).toContain("すべてが自社の売上と一致");
  });
});

describe("バッジの色とラベル", () => {
  it("noticeDiffTone は判定ごとに色を変える", () => {
    expect(noticeDiffTone("ok")).toEqual({ label: "一致", variant: "success", attention: false });
    expect(noticeDiffTone("notice_more").variant).toBe("warning");
    expect(noticeDiffTone("notice_less").variant).toBe("destructive");
    expect(noticeDiffTone("unmatched").attention).toBe(true);
  });

  it("noticeDiffTone は知らない値でも落ちない", () => {
    expect(noticeDiffTone(null).label).toBe("判定できません");
  });

  it("noticeStatusTone は状態ごとにラベルを返す", () => {
    expect(noticeStatusTone("received").label).toBe("受領");
    expect(noticeStatusTone("checked").label).toBe("確認済み");
    expect(noticeStatusTone("resolved").variant).toBe("success");
  });
});

describe("一覧の集計", () => {
  const listRows = [
    { total_amount: 460500, our_bill: 460500, total_diff: 0, item_total: 460500, item_count: 1, unmatched_count: 0 },
    { total_amount: 405000, our_bill: 460500, total_diff: -55500, item_total: 405000, item_count: 2, unmatched_count: 1 },
  ];

  it("差額のある通知と未紐づけの通知を数える", () => {
    const summary = noticeListSummary(listRows);
    expect(summary.count).toBe(2);
    expect(summary.diffCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.diffTotal).toBe(-55500);
  });

  it("通知書の合計と明細の合計がずれていたら案内を返す", () => {
    expect(noticeTotalMismatchText(listRows[0])).toBe("");
    const text = noticeTotalMismatchText({ ...listRows[0], item_total: 400000 });
    expect(text).toContain("ずれています");
    expect(text).toContain("¥60,500");
  });

  it("明細が 1 件も無いときはずれの案内を出さない", () => {
    expect(noticeTotalMismatchText({ total_amount: 460500, our_bill: 0, total_diff: 460500, item_total: 0, item_count: 0, unmatched_count: 0 })).toBe("");
  });
});

// ===========================================================================
// C. 画面用の変換（lib/notices/view.ts）
// ===========================================================================

describe("画面用の変換", () => {
  it("toNoticeListItem は null を既定値で埋める", () => {
    const row = {
      id: "n1",
      company_id: "c1",
      client_id: null,
      month: "2026-09-01",
      notice_no: null,
      received_on: null,
      total_amount: null,
      tax_amount: null,
      status: null,
      memo: null,
      created_by: null,
      created_at: null,
      updated_at: null,
      client_name: null,
      item_count: null,
      unmatched_count: null,
      item_total: null,
      our_bill: null,
      total_diff: null,
    } as PaymentNoticeRow;
    const item = toNoticeListItem(row);
    expect(item.month).toBe("2026-09");
    expect(item.status).toBe("received");
    expect(item.totalAmount).toBe(0);
    expect(item.clientName).toBe("");
  });

  it("toNoticeDiffItem は説明とメモを受け取る", () => {
    const row = { id: "i1", raw_name: "定期便", our_unit_price: null, diff_status: "unmatched" } as PaymentNoticeDiffRow;
    const item = toNoticeDiffItem(row, "説明です", "メモです");
    expect(item.explanation).toBe("説明です");
    expect(item.memo).toBe("メモです");
    expect(item.ourUnitPrice).toBeNull();
  });

  it("案件内容の選択肢は案件ごとにまとめる", () => {
    const options = [
      { id: "i1", name: "定期便", projectId: "p1", projectName: "板橋エリア", isActive: true },
      { id: "i2", name: "スポット", projectId: "p1", projectName: "板橋エリア", isActive: true },
      { id: "i3", name: "定期便", projectId: "p2", projectName: "川越ルート", isActive: false },
    ];
    const groups = groupItemOptions(options);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(itemOptionLabel(options[0])).toBe("板橋エリア / 定期便");
  });
});

// ===========================================================================
// D. CSV 出力（lib/exports/notice-csv.ts）
// ===========================================================================

describe("突合 CSV の出力", () => {
  const notice = { notice_no: "2026-09-001", client_name: "ヤマト運輸", month: "2026-09-01" };
  const rows = [
    {
      month: "2026-09-01",
      client_name: "ヤマト運輸",
      raw_name: "板橋エリア 定期便",
      project_name: "板橋エリア",
      item_name: "定期便",
      notice_qty: 18,
      notice_unit_price: 23025,
      notice_amount: 414450,
      our_qty: 20,
      our_amount: 460500,
      our_unit_price: 23025,
      qty_diff: -2,
      amount_diff: -46050,
      diff_status: "notice_less",
    },
  ];

  it("見出し行と明細を BOM 付き CRLF で出す", () => {
    const csv = noticeDiffToCsv(notice, rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("稼動月,通知番号,取引先");
    expect(csv).toContain("\r\n");
    expect(csv).toContain("2026-09,2026-09-001,ヤマト運輸");
  });

  it("判定は日本語、説明は explainDiff と同じ文章を出す", () => {
    const csv = noticeDiffToCsv(notice, rows);
    expect(csv).toContain("通知のほうが少ない");
    expect(csv).toContain("通知の数量が 2 少ない");
  });

  it("ファイル名に稼動月と取引先を入れる", () => {
    expect(noticeDiffCsvFilename(notice)).toBe("支払通知突合_2026-09_ヤマト運輸_2026-09-001.csv");
  });
});

// ===========================================================================
// E. 入力スキーマ（lib/schemas/notices.ts）
// ===========================================================================

describe("入力スキーマ", () => {
  const base = { id: null, client_id: "", month: "2026-09", notice_no: "2026-09-001", received_on: "", total_amount: "４６０,５００", tax_amount: "46050", memo: "" };

  it("全角・カンマの金額を数値に直し、空欄は null にする", () => {
    const parsed = noticeInputSchema.parse(base);
    expect(parsed.total_amount).toBe(460500);
    expect(parsed.client_id).toBeNull();
    expect(parsed.received_on).toBeNull();
  });

  it("稼動月の形式が違えば日本語のエラーになる", () => {
    const result = noticeInputSchema.safeParse({ ...base, month: "2026/09" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("YYYY-MM");
  });

  it("状態は 3 つのどれかだけ受け付ける", () => {
    expect(noticeStatusSchema.safeParse({ id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b", status: "checked" }).success).toBe(true);
    expect(noticeStatusSchema.safeParse({ id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b", status: "unknown" }).success).toBe(false);
  });

  it("明細は内容が空だと弾く", () => {
    const result = noticeItemSchema.safeParse({
      id: null,
      notice_id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b",
      project_item_id: "",
      raw_name: "  ",
      qty: "1",
      unit_price: "1000",
      amount: "1000",
      memo: "",
    });
    expect(result.success).toBe(false);
  });

  it("まとめて取り込みは 1 行以上を求める", () => {
    const empty = importNoticeItemsSchema.safeParse({ notice_id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b", mode: "replace", rows: [] });
    expect(empty.success).toBe(false);
    const ok = importNoticeItemsSchema.safeParse({
      notice_id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b",
      mode: "append",
      rows: [{ raw_name: "定期便", qty: 20, unit_price: 23025, amount: 460500 }],
    });
    expect(ok.success).toBe(true);
  });

  it("読み取った CSV の行がそのまま取り込みの入力として通る", () => {
    const parsed = parseNoticeCsv(BASIC_CSV);
    const result = importNoticeItemsSchema.safeParse({
      notice_id: "8f1a1f4a-0d47-4a9f-9a1e-1c2d3e4f5a6b",
      mode: "replace",
      rows: parsed.rows.map((r) => ({ raw_name: r.raw_name, qty: r.qty, unit_price: r.unit_price, amount: r.amount })),
    });
    expect(result.success).toBe(true);
  });
});
