import { describe, expect, it } from "vitest";
import {
  compareRecords,
  describeFilter,
  filterRecords,
  inAmountRange,
  inDateRange,
  matchesQuery,
  missingFileDocs,
  normalizeQuery,
  recordsSummary,
  RECORD_KIND_LABELS,
  type RecordDoc,
} from "@/lib/records";

/** 既定値を上書きする（null を明示したときは null のままにする） */
function doc(over: Partial<RecordDoc> = {}): RecordDoc {
  return {
    id: "1",
    kind: "receipt",
    date: "2026-09-10",
    amount: 10000,
    counterparty: "エネオス三郷",
    title: "軽油",
    href: "/api/receipt/x",
    hasFile: true,
    month: "2026-09",
    memo: "",
    ...over,
  };
}

describe("検索に使う文字のそろえ方", () => {
  it("全角の英数字は半角にする", () => {
    expect(normalizeQuery("ＡＢＣ１２３")).toBe("abc123");
  });

  it("空白（半角・全角）は取り除く", () => {
    expect(normalizeQuery("エネオス 三郷　店")).toBe("エネオス三郷店");
  });

  it("大文字と小文字は区別しない", () => {
    expect(normalizeQuery("Amazon")).toBe(normalizeQuery("AMAZON"));
  });

  it("空文字・未定義でも落ちない", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery(undefined as unknown as string)).toBe("");
  });
});

describe("取引年月日の範囲（電子帳簿保存法の検索要件）", () => {
  it("範囲の指定が無ければすべて通す", () => {
    expect(inDateRange("2026-09-10")).toBe(true);
    expect(inDateRange(null)).toBe(true);
  });

  it("開始日はその日を含む", () => {
    expect(inDateRange("2026-09-10", "2026-09-10")).toBe(true);
    expect(inDateRange("2026-09-09", "2026-09-10")).toBe(false);
  });

  it("終了日はその日を含む", () => {
    expect(inDateRange("2026-09-10", undefined, "2026-09-10")).toBe(true);
    expect(inDateRange("2026-09-11", undefined, "2026-09-10")).toBe(false);
  });

  it("開始と終了の両方を指定できる", () => {
    expect(inDateRange("2026-09-10", "2026-09-01", "2026-09-30")).toBe(true);
    expect(inDateRange("2026-10-01", "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("日付が分からない書類は、範囲を指定したときは外す", () => {
    expect(inDateRange(null, "2026-09-01")).toBe(false);
  });
});

describe("取引金額の範囲", () => {
  it("範囲の指定が無ければすべて通す", () => {
    expect(inAmountRange(10000)).toBe(true);
    expect(inAmountRange(null)).toBe(true);
  });

  it("下限・上限はその金額を含む", () => {
    expect(inAmountRange(10000, 10000, 10000)).toBe(true);
    expect(inAmountRange(9999, 10000)).toBe(false);
    expect(inAmountRange(10001, undefined, 10000)).toBe(false);
  });

  it("金額が無い書類（契約書など）は、範囲を指定したときは外す", () => {
    expect(inAmountRange(null, 1)).toBe(false);
    expect(inAmountRange(null, null, null)).toBe(true);
  });

  it("数値でない値は範囲に入らない", () => {
    expect(inAmountRange(Number.NaN, 0, 100)).toBe(false);
  });

  it("マイナスの金額も範囲で拾える", () => {
    expect(inAmountRange(-5000, -10000, 0)).toBe(true);
  });
});

describe("取引先・件名の部分一致", () => {
  it("取引先で見つかる", () => {
    expect(matchesQuery(doc({ counterparty: "エネオス三郷" }), "エネオス")).toBe(true);
  });

  it("件名で見つかる", () => {
    expect(matchesQuery(doc({ title: "高速代" }), "高速")).toBe(true);
  });

  it("メモでも見つかる", () => {
    expect(matchesQuery(doc({ memo: "領収書の番号 A-12" }), "A-12")).toBe(true);
  });

  it("空白の入り方が違っても見つかる", () => {
    expect(matchesQuery(doc({ counterparty: "エネオス 三郷" }), "エネオス三郷")).toBe(true);
  });

  it("条件が空ならすべて通す", () => {
    expect(matchesQuery(doc(), "")).toBe(true);
    expect(matchesQuery(doc(), undefined)).toBe(true);
  });
});

describe("組み合わせて絞り込む", () => {
  const docs: RecordDoc[] = [
    doc({ id: "1", kind: "receipt", date: "2026-09-10", amount: 10000, counterparty: "エネオス三郷" }),
    doc({ id: "2", kind: "invoice", date: "2026-09-30", amount: 1266375, counterparty: "テスト運輸", title: "202609-01" }),
    doc({ id: "3", kind: "notice", date: "2026-10-20", amount: 1200000, counterparty: "テスト運輸", title: "PN-001" }),
    doc({ id: "4", kind: "contract", date: "2026-04-01", amount: null, counterparty: "相曽慧", title: "業務委託契約書", hasFile: false, href: null }),
  ];

  it("日付と金額と取引先を同時に指定できる", () => {
    const got = filterRecords(docs, { from: "2026-09-01", to: "2026-10-31", minAmount: 1000000, q: "テスト運輸" });
    expect(got.map((d) => d.id)).toEqual(["3", "2"]);
  });

  it("種類で絞り込める", () => {
    expect(filterRecords(docs, { kinds: ["contract"] }).map((d) => d.id)).toEqual(["4"]);
  });

  it("ファイルが無いものだけを出せる", () => {
    expect(filterRecords(docs, { missingFileOnly: true }).map((d) => d.id)).toEqual(["4"]);
  });

  it("条件が無ければ日付の新しい順で全件返す", () => {
    expect(filterRecords(docs).map((d) => d.id)).toEqual(["3", "2", "1", "4"]);
  });

  it("金額の範囲を指定すると、金額の無い契約書は外れる", () => {
    expect(filterRecords(docs, { minAmount: 0 }).map((d) => d.id)).not.toContain("4");
  });

  it("該当が無ければ空", () => {
    expect(filterRecords(docs, { q: "存在しない取引先" })).toEqual([]);
  });
});

describe("並び順", () => {
  it("日付が同じなら レシート → 請求書 → 支払通知 → 契約書 の順", () => {
    const a = doc({ kind: "notice", date: "2026-09-10" });
    const b = doc({ kind: "receipt", date: "2026-09-10" });
    expect(compareRecords(a, b)).toBeGreaterThan(0);
  });

  it("日付が無いものは最後", () => {
    const a = doc({ date: null });
    const b = doc({ date: "2026-01-01" });
    expect(compareRecords(a, b)).toBeGreaterThan(0);
  });
});

describe("集計と案内", () => {
  const docs: RecordDoc[] = [
    doc({ id: "1", amount: 10000, date: "2026-09-10" }),
    doc({ id: "2", kind: "invoice", amount: 20000, date: "2026-09-30" }),
    doc({ id: "3", kind: "contract", amount: null, date: "2026-04-01", hasFile: false }),
  ];

  it("件数と合計金額が出る", () => {
    const s = recordsSummary(docs);
    expect(s.count).toBe(3);
    expect(s.total).toBe(30000);
  });

  it("ファイルの有無を数える", () => {
    const s = recordsSummary(docs);
    expect(s.withFile).toBe(2);
    expect(s.missingFile).toBe(1);
  });

  it("種類ごとの件数が出る", () => {
    const s = recordsSummary(docs);
    expect(s.byKind.receipt).toBe(1);
    expect(s.byKind.invoice).toBe(1);
    expect(s.byKind.notice).toBe(0);
  });

  it("いちばん古い日といちばん新しい日が出る", () => {
    const s = recordsSummary(docs);
    expect(s.oldest).toBe("2026-04-01");
    expect(s.newest).toBe("2026-09-30");
  });

  it("0 件でも落ちない", () => {
    const s = recordsSummary([]);
    expect(s.count).toBe(0);
    expect(s.total).toBe(0);
    expect(s.oldest).toBeNull();
  });

  it("ファイルが無い書類を取り出せる", () => {
    expect(missingFileDocs(docs).map((d) => d.id)).toEqual(["3"]);
  });

  it("検索条件を日本語にできる", () => {
    expect(describeFilter({})).toBe("すべての書類");
    expect(describeFilter({ from: "2026-09-01", to: "2026-09-30" })).toContain("取引年月日");
    expect(describeFilter({ minAmount: 10000 })).toContain("取引金額");
    expect(describeFilter({ q: "エネオス" })).toContain("エネオス");
    expect(describeFilter({ kinds: ["receipt"] })).toContain(RECORD_KIND_LABELS.receipt);
    expect(describeFilter({ missingFileOnly: true })).toContain("未保存");
  });
});
