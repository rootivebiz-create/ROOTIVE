import { describe, expect, it } from "vitest";
import { buildStatements } from "@/lib/payroll/calc";
import { sampleData } from "@/lib/payroll/sample";
import { buildZenginRecords, validateTransfers, zenginBytes } from "@/lib/payroll/zengin";
import {
  isDate,
  isMonth,
  isRegistrationNo,
  jpDate,
  jpMonth,
  parseNonNegative,
  parseYen,
  percentTextToRate,
  periodText,
  qtyText,
  rateToPercentText,
  toMMDD,
  unitPrice,
  zenginFileName,
} from "@/components/demo/format";
import { sampleRequester } from "@/components/demo/persist";
import { groupIssues, transferRows } from "@/components/demo/transfers";

describe("日付と月", () => {
  it("形と実在する日付を確かめる", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isDate("2026-11-25")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("")).toBe(false);
  });

  it("日本語の表記", () => {
    expect(jpDate("2026-11-05")).toBe("2026年11月5日");
    expect(jpDate("?")).toBe("?");
    expect(jpMonth("2026-09")).toBe("2026年9月");
    expect(periodText("2026-10")).toBe("2026年10月1日〜10月31日");
    expect(periodText("2028-02")).toBe("2028年2月1日〜2月29日");
  });

  it("振込日の MMDD とファイル名", () => {
    expect(toMMDD("2026-11-25")).toBe("1125");
    expect(toMMDD("2026-11-31")).toBeNull();
    expect(zenginFileName("2026-10")).toBe("furikomi_202610.txt");
  });
});

describe("数と率の入力", () => {
  it("数量・単価（小数あり）と円（整数だけ）", () => {
    expect(parseNonNegative("１，２００")).toBe(1200);
    expect(parseNonNegative("7.5")).toBe(7.5);
    expect(parseNonNegative("-1")).toBeNull();
    expect(parseNonNegative("abc")).toBeNull();
    expect(parseYen("15,000")).toBe(15000);
    expect(parseYen("100.5")).toBeNull();
    expect(parseYen("-3")).toBeNull();
  });

  it("% の入力と率の行き来で誤差が出ない", () => {
    expect(percentTextToRate("10")).toBe(0.1);
    expect(percentTextToRate("10.5%")).toBe(0.105);
    expect(percentTextToRate("８％")).toBe(0.08);
    expect(percentTextToRate("101")).toBeNull();
    expect(rateToPercentText(0.07)).toBe("7");
    expect(rateToPercentText(0.105)).toBe("10.5");
    expect(rateToPercentText(0.1 + 0.2)).toBe("30");
  });

  it("表示", () => {
    expect(qtyText(2310)).toBe("2,310");
    expect(qtyText(7.25)).toBe("7.25");
    expect(unitPrice(152.5)).toBe("¥152.5");
    expect(unitPrice(18000)).toBe("¥18,000");
    expect(unitPrice(-20)).toBe("-¥20");
  });

  it("登録番号の形", () => {
    expect(isRegistrationNo("T1234567890123")).toBe(true);
    expect(isRegistrationNo("Ｔ１２３４５６７８９０１２３")).toBe(true);
    expect(isRegistrationNo("T123")).toBe(false);
    expect(isRegistrationNo("1234567890123")).toBe(false);
  });
});

describe("支払明細 → 振込データ", () => {
  it("サンプルは 5 人全員が振込対象で、そのまま 120 桁のデータになる", () => {
    const statements = buildStatements(sampleData());
    const { rows, transfers } = transferRows(statements);
    expect(rows.every((r) => r.kind === "transfer")).toBe(true);
    expect(transfers.map((t) => t.amount)).toEqual(statements.map((st) => st.total));
    expect(validateTransfers(sampleRequester(), transfers)).toEqual([]);
    const records = buildZenginRecords(sampleRequester(), "1125", transfers);
    expect(records).toHaveLength(transfers.length + 3);
    expect(records.every((r) => r.length === 120)).toBe(true);
    expect(zenginBytes(records).length).toBe(records.length * 122);
  });

  it("口座のない方・振込額が 0 円以下の方は外し、位置（index）は振込先だけで数える", () => {
    const data = sampleData();
    data.drivers[0] = { ...data.drivers[0], bank: undefined };
    data.adjustments.push({ driverId: "d2", label: "相殺", amount: -10_000_000 });
    const { rows, transfers } = transferRows(buildStatements(data));
    expect(rows.map((r) => r.kind)).toEqual(["no-bank", "no-amount", "transfer", "transfer", "transfer"]);
    expect(transfers).toHaveLength(3);
    const third = rows[2];
    expect(third.kind === "transfer" && third.index).toBe(0);
  });

  it("確認の結果を振込元と振込先ごとに分ける", () => {
    const data = sampleData();
    data.drivers[1] = { ...data.drivers[1], bank: { ...data.drivers[1].bank!, accountNumber: "12345678", holderKana: "" } };
    const { transfers } = transferRows(buildStatements(data));
    const issues = groupIssues(validateTransfers({ ...sampleRequester(), code: "123" }, transfers));
    expect(issues.requester).toEqual(["振込依頼人コードは 10 桁の数字です"]);
    expect(issues.byIndex.get(1)).toEqual(["口座番号は 7 桁までの数字です", "口座名義（カナ）がありません"]);
    expect(issues.byIndex.has(0)).toBe(false);
  });
});
