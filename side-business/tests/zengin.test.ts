import { describe, expect, it } from "vitest";
import { buildZenginRecords, toShiftJisBytes, toZenginKana, validateTransfers, zenginBytes, type Requester, type Transfer } from "@/lib/payroll/zengin";

const requester: Requester = {
  code: "1234567890",
  nameKana: "サンプルウンソウ（カ",
  bankCode: "0001",
  bankNameKana: "ﾐｽﾞﾎ",
  branchCode: "001",
  branchNameKana: "ﾎﾝﾃﾝ",
  accountType: "ordinary",
  accountNumber: "7654321",
};

const transfers: Transfer[] = [
  { bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "202", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "234567", holderKana: "イノウエ ミサキ", amount: 350000, customerCode: "D2" },
  { bankCode: "9900", bankNameKana: "ﾕｳﾁﾖ", branchCode: "418", branchNameKana: "ﾖﾝｲﾁﾊﾁ", accountType: "checking", accountNumber: "4567890", holderKana: "えんどう　だいすけ", amount: 12345 },
];

describe("振込データ用のカナ", () => {
  it("カタカナ・ひらがな・英字を半角の大きい文字にする", () => {
    expect(toZenginKana("アオキ ショウタ").value).toBe("ｱｵｷ ｼﾖｳﾀ");
    expect(toZenginKana("がっこう").value).toBe("ｶﾞﾂｺｳ");
    expect(toZenginKana("パン　ヴィ").value).toBe("ﾊﾟﾝ ｳﾞｲ");
    expect(toZenginKana("yamada ＴＡＲＯ").value).toBe("YAMADA TARO");
    expect(toZenginKana("カ）サンプル").value).toBe("ｶ)ｻﾝﾌﾟﾙ");
    expect(toZenginKana("ｶﾞｯｺｳ").value).toBe("ｶﾞﾂｺｳ");
    expect(toZenginKana("スーパー").value).toBe("ｽ-ﾊﾟ-");
  });

  it("使えない文字は返す", () => {
    expect(toZenginKana("山田").invalid).toEqual(["山", "田"]);
  });
});

describe("全銀の総合振込データ", () => {
  it("どの行も 120 桁で、見出し・明細・合計・終わりが並ぶ", () => {
    const records = buildZenginRecords(requester, "1125", transfers);
    expect(records).toHaveLength(5);
    for (const r of records) expect(r.length).toBe(120);
    expect(records[0].slice(0, 4)).toBe("1210");
    expect(records[0].slice(4, 14)).toBe("1234567890");
    expect(records[0].slice(54, 58)).toBe("1125");
    expect(records[1][0]).toBe("2");
    expect(records[1].slice(1, 5)).toBe("0005");
    expect(records[1].slice(42, 43)).toBe("1");
    expect(records[1].slice(43, 50)).toBe("0234567");
    expect(records[1].slice(50, 80).trimEnd()).toBe("ｲﾉｳｴ ﾐｻｷ");
    expect(records[1].slice(80, 90)).toBe("0000350000");
    expect(records[2].slice(42, 43)).toBe("2");
    expect(records[2].slice(50, 80).trimEnd()).toBe("ｴﾝﾄﾞｳ ﾀﾞｲｽｹ");
    expect(records[3]).toBe("8" + "000002" + "000000362345" + " ".repeat(101));
    expect(records[4]).toBe("9" + " ".repeat(119));
  });

  it("終わりのレコードまで CRLF 付きの Shift_JIS になる", () => {
    const records = [...buildZenginRecords(requester, "1125", transfers)];
    const bytes = zenginBytes(records);
    expect(bytes.length).toBe(records.length * 122);
    expect(toShiftJisBytes("ｱﾞ")).toEqual(new Uint8Array([0xb1, 0xde]));
  });

  it("入力の誤りを見つける", () => {
    const bad: Transfer[] = [{ ...transfers[0], bankCode: "5", accountNumber: "12345678", amount: 0, holderKana: "山田" }];
    const msgs = validateTransfers({ ...requester, code: "12" }, bad).map((i) => i.message);
    expect(msgs).toContain("振込依頼人コードは 10 桁の数字です");
    expect(msgs).toContain("金融機関コードは 4 桁の数字です");
    expect(msgs).toContain("口座番号は 7 桁までの数字です");
    expect(msgs).toContain("振込金額は 1 円以上の整数です");
    expect(msgs.some((m) => m.startsWith("口座名義に使えない文字"))).toBe(true);
    expect(() => buildZenginRecords(requester, "1125", bad)).toThrow();
  });
});
