import { describe, expect, it } from "vitest";
import {
  ZENGIN_RECORD_BYTES,
  accountTypeCode,
  buildDataRecord,
  buildEndRecord,
  buildHeaderRecord,
  buildTrailerRecord,
  buildZenginBytes,
  buildZenginRecords,
  buildZenginText,
  encodeShiftJis,
  missingBankFields,
  padKana,
  padNum,
  padText,
  pickTransferDate,
  toHalfWidthKana,
  toTransferTarget,
  transferDateOptions,
  transferFileName,
  transferRows,
  validateZengin,
  zenginByteLength,
  zenginTotals,
  type TransferDriverSource,
  type ZenginInput,
  type ZenginRow,
} from "@/lib/exports/zengin";

/** 振込先（ドライバー 1 名分） */
const ROW: ZenginRow = {
  bankCode: "0009",
  bankName: "ミズホ",
  branchCode: "123",
  branchName: "シンジュク",
  accountType: "ordinary",
  accountNumber: "12345",
  holderKana: "アイソ　ケイ",
  amount: 396643,
  label: "相曽慧",
};

/** 会社（振込元・当座） */
const INPUT: ZenginInput = {
  consignorCode: "1234567890",
  consignorKana: "株式会社ルーティブ",
  bank: {
    bankCode: "0005",
    bankName: "ミツビシUFJ",
    branchCode: "001",
    branchName: "シンジュク",
    accountType: "checking",
    accountNumber: "1234",
  },
  transferDate: "2026-10-31",
  rows: [ROW],
};

describe("半角カナ変換（toHalfWidthKana）", () => {
  it("濁点・半濁点は 2 文字に分解する（ガ → ｶﾞ、パ → ﾊﾟ、ヴ → ｳﾞ）", () => {
    expect(toHalfWidthKana("ガ")).toBe("ｶﾞ");
    expect(toHalfWidthKana("パ")).toBe("ﾊﾟ");
    expect(toHalfWidthKana("ヴ")).toBe("ｳﾞ");
    expect(toHalfWidthKana("ミズホ")).toBe("ﾐｽﾞﾎ");
  });

  it("ひらがなもカタカナとして半角にする", () => {
    expect(toHalfWidthKana("かわしま かんた")).toBe("ｶﾜｼﾏ ｶﾝﾀ");
    expect(toHalfWidthKana("ぱんだ")).toBe("ﾊﾟﾝﾀﾞ");
  });

  it("長音 ー は ｰ にする", () => {
    expect(toHalfWidthKana("ルーティブ")).toBe("ﾙｰﾃｲﾌﾞ");
    expect(toHalfWidthKana("ー")).toBe("ｰ");
  });

  it("株式会社は ｶ) にする（先頭・末尾どちらでも）", () => {
    expect(toHalfWidthKana("株式会社ルーティブ")).toBe("ｶ)ﾙｰﾃｲﾌﾞ");
    expect(toHalfWidthKana("ルーティブ株式会社")).toBe("ﾙｰﾃｲﾌﾞｶ)");
    expect(toHalfWidthKana("（株）ルーティブ")).toBe("ｶ)ﾙｰﾃｲﾌﾞ");
  });

  it("有限会社は ﾕ)、合同会社は ﾄﾞ) にする", () => {
    expect(toHalfWidthKana("有限会社アイソ")).toBe("ﾕ)ｱｲｿ");
    expect(toHalfWidthKana("合同会社アイソ")).toBe("ﾄﾞ)ｱｲｿ");
  });

  it("英小文字は大文字に、全角英数は半角にする", () => {
    expect(toHalfWidthKana("rootive")).toBe("ROOTIVE");
    expect(toHalfWidthKana("ＡＢＣ１２３")).toBe("ABC123");
    expect(toHalfWidthKana("ｍｉｚｕｈｏ")).toBe("MIZUHO");
  });

  it("小書き文字は大文字にする（既定）", () => {
    expect(toHalfWidthKana("キャッシュ")).toBe("ｷﾔﾂｼﾕ");
    expect(toHalfWidthKana("ジャパン")).toBe("ｼﾞﾔﾊﾟﾝ");
  });

  it("keepSmallKana を付けると小書き文字を残す", () => {
    expect(toHalfWidthKana("キャッシュ", { keepSmallKana: true })).toBe("ｷｬｯｼｭ");
  });

  it("使えない文字（漢字・記号）は空白に落とす", () => {
    expect(toHalfWidthKana("相曽慧")).toBe("   ");
    expect(toHalfWidthKana("ア＊イ")).toBe("ｱ ｲ");
    expect(toHalfWidthKana("ア%イ")).toBe("ｱ ｲ");
  });

  it("使える記号（. , ( ) - / 空白 ¥）は残す", () => {
    expect(toHalfWidthKana("A.B,C(D)E-F/G")).toBe("A.B,C(D)E-F/G");
    expect(toHalfWidthKana("￥100")).toBe("¥100");
    expect(toHalfWidthKana("　")).toBe(" ");
  });

  it("中黒は . に、読点は , にする", () => {
    expect(toHalfWidthKana("マクドナルド・ジャパン")).toBe("ﾏｸﾄﾞﾅﾙﾄﾞ.ｼﾞﾔﾊﾟﾝ");
    expect(toHalfWidthKana("ア、イ")).toBe("ｱ,ｲ");
  });

  it("すでに半角のものは変わらない（何度かけても同じ）", () => {
    const once = toHalfWidthKana("ｶ)ﾙｰﾃｲﾌﾞ");
    expect(once).toBe("ｶ)ﾙｰﾃｲﾌﾞ");
    expect(toHalfWidthKana(once)).toBe(once);
  });
});

describe("Shift_JIS エンコード（encodeShiftJis）", () => {
  it("半角カナは 0xA1–0xDF、ASCII はそのまま", () => {
    expect([...encodeShiftJis("ｱ")]).toEqual([0xb1]);
    expect([...encodeShiftJis("ｶﾞ")]).toEqual([0xb6, 0xde]);
    expect([...encodeShiftJis("ﾟ")]).toEqual([0xdf]);
    expect([...encodeShiftJis("A1 ")]).toEqual([0x41, 0x31, 0x20]);
  });

  it("¥ は 0x5C にする", () => {
    expect([...encodeShiftJis("¥")]).toEqual([0x5c]);
    expect([...encodeShiftJis(toHalfWidthKana("￥"))]).toEqual([0x5c]);
  });

  it("CRLF はそのまま 0x0D 0x0A", () => {
    expect([...encodeShiftJis("A\r\n")]).toEqual([0x41, 0x0d, 0x0a]);
  });

  it("使えない文字は日本語の例外（どの文字かを含む）", () => {
    expect(() => encodeShiftJis("漢字")).toThrow(/全銀フォーマット/);
    expect(() => encodeShiftJis("ア")).toThrow(/ア/);
    expect(() => encodeShiftJis("ﾃｽﾄ漢")).toThrow("全銀フォーマット（Shift_JIS 半角）に使えない文字が含まれています：漢");
  });

  it("zenginByteLength は半角 1 文字 ＝ 1 バイトで数える", () => {
    expect(zenginByteLength("ｱｲｳ")).toBe(3);
    expect(zenginByteLength("ｶﾞ")).toBe(2);
    expect(zenginByteLength(" ".repeat(120))).toBe(120);
  });
});

describe("桁合わせ（padNum / padText / padKana）", () => {
  it("padNum は右詰め 0 埋め", () => {
    expect(padNum(396643, 10)).toBe("0000396643");
    expect(padNum(0, 6)).toBe("000000");
    expect(padNum("123", 4)).toBe("0123");
  });

  it("padNum は数字以外を落とし、空は 0 にする", () => {
    expect(padNum("12-34", 7)).toBe("0001234");
    expect(padNum("", 4)).toBe("0000");
    expect(padNum(1234.6, 6)).toBe("001235");
  });

  it("padNum は桁あふれ・マイナスで日本語の例外", () => {
    expect(() => padNum(12345, 4)).toThrow(/4 桁に収まらない/);
    expect(() => padNum(-1, 10)).toThrow(/マイナス/);
    expect(() => padNum(Number.NaN, 10)).toThrow(/数値/);
  });

  it("padText は左詰め・空白埋め、超過時は切り詰め", () => {
    expect(padText("ABC", 5)).toBe("ABC  ");
    expect(padText("ABCDEF", 3)).toBe("ABC");
    expect(padText("", 3)).toBe("   ");
  });

  it("padKana は半角カナへ変換してから空白埋めする", () => {
    expect(padKana("ミズホ", 15)).toBe("ﾐｽﾞﾎ" + " ".repeat(11));
    expect(padKana("  アイソ　　ケイ ", 10)).toBe("ｱｲｿ ｹｲ    ");
    expect(zenginByteLength(padKana("株式会社ルーティブ", 40))).toBe(40);
  });

  it("padKana は桁を超える名義を切り詰める", () => {
    const long = padKana("アイウエオカキクケコサシスセソタチツテトナニヌネノ", 30);
    expect(long.length).toBe(30);
    expect(long).toBe("ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ     ");
    expect(padKana("ガギグゲゴザジズゼゾダヂヅデドバビブベボ", 10)).toBe("ｶﾞｷﾞｸﾞｹﾞｺﾞ");
  });
});

describe("預金種目コード", () => {
  it("普通 1・当座 2・貯蓄 4、未設定は普通", () => {
    expect(accountTypeCode("ordinary")).toBe("1");
    expect(accountTypeCode("checking")).toBe("2");
    expect(accountTypeCode("savings")).toBe("4");
    expect(accountTypeCode(null)).toBe("1");
  });

  it("データレコードの預金種目が種別ごとに変わる", () => {
    expect(buildDataRecord({ ...ROW, accountType: "savings" }).slice(42, 43)).toBe("4");
    expect(buildDataRecord({ ...ROW, accountType: "checking" }).slice(42, 43)).toBe("2");
  });
});

describe("ヘッダレコード（データ区分 1）", () => {
  const header = buildHeaderRecord(INPUT);

  it("120 バイトちょうど", () => {
    expect(encodeShiftJis(header).length).toBe(ZENGIN_RECORD_BYTES);
  });

  it("データ区分 1・種別コード 21・コード区分 0・委託者コード・取組日 MMDD", () => {
    expect(header.slice(0, 1)).toBe("1");
    expect(header.slice(1, 3)).toBe("21");
    expect(header.slice(3, 4)).toBe("0");
    expect(header.slice(4, 14)).toBe("1234567890");
    expect(header.slice(54, 58)).toBe("1031");
  });

  it("委託者名・仕向銀行・支店・預金種目・口座番号が正しい位置に入る", () => {
    expect(header.slice(14, 54)).toBe("ｶ)ﾙｰﾃｲﾌﾞ".padEnd(40, " "));
    expect(header.slice(58, 62)).toBe("0005");
    expect(header.slice(62, 77)).toBe("ﾐﾂﾋﾞｼUFJ".padEnd(15, " "));
    expect(header.slice(77, 80)).toBe("001");
    expect(header.slice(80, 95)).toBe("ｼﾝｼﾞﾕｸ".padEnd(15, " "));
    expect(header.slice(95, 96)).toBe("2");
    expect(header.slice(96, 103)).toBe("0001234");
    expect(header.slice(103)).toBe(" ".repeat(17));
  });

  it("取組日が YYYY-MM-DD でなければ日本語の例外", () => {
    expect(() => buildHeaderRecord({ ...INPUT, transferDate: "2026/10/31" })).toThrow(/取組日/);
    expect(() => buildHeaderRecord({ ...INPUT, transferDate: "" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("データレコード（データ区分 2）", () => {
  const data = buildDataRecord(ROW);

  it("120 バイトちょうど", () => {
    expect(encodeShiftJis(data).length).toBe(ZENGIN_RECORD_BYTES);
  });

  it("銀行・支店・手形交換所（空白）・預金種目・口座番号", () => {
    expect(data.slice(0, 1)).toBe("2");
    expect(data.slice(1, 5)).toBe("0009");
    expect(data.slice(5, 20)).toBe("ﾐｽﾞﾎ".padEnd(15, " "));
    expect(data.slice(20, 23)).toBe("123");
    expect(data.slice(23, 38)).toBe("ｼﾝｼﾞﾕｸ".padEnd(15, " "));
    expect(data.slice(38, 42)).toBe("    "); // 手形交換所番号（空白）
    expect(data.slice(42, 43)).toBe("1");
    expect(data.slice(43, 50)).toBe("0012345");
  });

  it("受取人名 30 桁・振込金額 10 桁・新規コード 0・振込指定区分 7", () => {
    expect(data.slice(50, 80)).toBe("ｱｲｿ ｹｲ".padEnd(30, " "));
    expect(data.slice(80, 90)).toBe("0000396643");
    expect(data.slice(90, 91)).toBe("0");
    expect(data.slice(91, 101)).toBe(" ".repeat(10)); // 顧客コード 1（未指定）
    expect(data.slice(101, 111)).toBe(" ".repeat(10)); // 顧客コード 2
    expect(data.slice(111, 112)).toBe("7");
    expect(data.slice(112, 113)).toBe(" ");
    expect(data.slice(113)).toBe(" ".repeat(7));
  });

  it("顧客コードを指定すると顧客コード 1 に左詰めで入る", () => {
    const withCode = buildDataRecord({ ...ROW, customerCode: "D0001" });
    expect(withCode.slice(91, 101)).toBe("D0001     ");
    expect(encodeShiftJis(withCode).length).toBe(ZENGIN_RECORD_BYTES);
  });

  it("金額が 10 桁を超えると日本語の例外", () => {
    expect(() => buildDataRecord({ ...ROW, amount: 12345678901 })).toThrow(/10 桁/);
  });
});

describe("トレーラ・エンドレコード", () => {
  it("トレーラは 120 バイト・合計件数 6 桁・合計金額 12 桁", () => {
    const trailer = buildTrailerRecord([ROW, { ...ROW, amount: 100000 }]);
    expect(encodeShiftJis(trailer).length).toBe(ZENGIN_RECORD_BYTES);
    expect(trailer.slice(0, 1)).toBe("8");
    expect(trailer.slice(1, 7)).toBe("000002");
    expect(trailer.slice(7, 19)).toBe("000000496643");
    expect(trailer.slice(19)).toBe(" ".repeat(101));
  });

  it("エンドレコードは 9 ＋ 空白 119 桁", () => {
    const end = buildEndRecord();
    expect(encodeShiftJis(end).length).toBe(ZENGIN_RECORD_BYTES);
    expect(end).toBe(`9${" ".repeat(119)}`);
  });

  it("合計件数・合計金額はデータレコードと一致する", () => {
    const rows = [ROW, { ...ROW, amount: 250000 }, { ...ROW, amount: 1 }];
    const totals = zenginTotals(rows);
    expect(totals).toEqual({ count: 3, amount: 396643 + 250000 + 1 });
    const records = buildZenginRecords({ ...INPUT, rows });
    const dataTotal = records
      .filter((r) => r.startsWith("2"))
      .reduce((a, r) => a + Number(r.slice(80, 90)), 0);
    const trailer = records[records.length - 2];
    expect(Number(trailer.slice(1, 7))).toBe(3);
    expect(Number(trailer.slice(7, 19))).toBe(dataTotal);
  });
});

describe("全体の組み立て（buildZenginRecords / buildZenginText）", () => {
  it("1 件：ヘッダ → データ → トレーラ → エンドの 4 レコード、すべて 120 バイト", () => {
    const records = buildZenginRecords(INPUT);
    expect(records.length).toBe(4);
    expect(records.map((r) => r.slice(0, 1))).toEqual(["1", "2", "8", "9"]);
    for (const r of records) expect(encodeShiftJis(r).length).toBe(ZENGIN_RECORD_BYTES);
  });

  it("複数件：件数分のデータレコードが並ぶ", () => {
    const rows = [ROW, { ...ROW, holderKana: "カワシマ　カンタ", amount: 120000, label: "川島幹太" }];
    const records = buildZenginRecords({ ...INPUT, rows });
    expect(records.length).toBe(4 + 1);
    expect(records[2].slice(50, 80)).toBe("ｶﾜｼﾏ ｶﾝﾀ".padEnd(30, " "));
    expect(records[2].slice(80, 90)).toBe("0000120000");
    expect(records[3].slice(1, 7)).toBe("000002");
    expect(records[3].slice(7, 19)).toBe("000000516643");
  });

  it("CRLF で連結し、最終レコードの後にも CRLF を付ける", () => {
    const text = buildZenginText(INPUT);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
    const lines = text.split("\r\n");
    expect(lines.length).toBe(5); // 4 レコード ＋ 末尾の空文字
    expect(lines[4]).toBe("");
    for (const line of lines.slice(0, 4)) expect(line.length).toBe(ZENGIN_RECORD_BYTES);
  });

  it("Shift_JIS のバイト数は（120 ＋ 2）× レコード数", () => {
    expect(buildZenginBytes(INPUT).length).toBe((ZENGIN_RECORD_BYTES + 2) * 4);
    const rows = [ROW, ROW, ROW];
    expect(buildZenginBytes({ ...INPUT, rows }).length).toBe((ZENGIN_RECORD_BYTES + 2) * 6);
  });

  it("1 件分の全文が期待どおり（固定長の並び）", () => {
    const expected =
      "1210" +
      "1234567890" +
      "ｶ)ﾙｰﾃｲﾌﾞ".padEnd(40, " ") +
      "1031" +
      "0005" +
      "ﾐﾂﾋﾞｼUFJ".padEnd(15, " ") +
      "001" +
      "ｼﾝｼﾞﾕｸ".padEnd(15, " ") +
      "2" +
      "0001234" +
      " ".repeat(17) +
      "\r\n" +
      "2" +
      "0009" +
      "ﾐｽﾞﾎ".padEnd(15, " ") +
      "123" +
      "ｼﾝｼﾞﾕｸ".padEnd(15, " ") +
      "    " +
      "1" +
      "0012345" +
      "ｱｲｿ ｹｲ".padEnd(30, " ") +
      "0000396643" +
      "0" +
      " ".repeat(20) + // 顧客コード 1・2（未指定）
      "7" +
      " ".repeat(8) + // 識別表示 ＋ ダミー
      "\r\n" +
      "8" +
      "000001" +
      "000000396643" +
      " ".repeat(101) +
      "\r\n" +
      `9${" ".repeat(119)}` +
      "\r\n";
    expect(buildZenginText(INPUT)).toBe(expected);
  });

  it("漢字の名義でも空白に落ちるので出力は 120 バイトのまま", () => {
    const records = buildZenginRecords({ ...INPUT, rows: [{ ...ROW, holderKana: "相曽慧" }] });
    for (const r of records) expect(encodeShiftJis(r).length).toBe(ZENGIN_RECORD_BYTES);
    expect(records[1].slice(50, 80)).toBe(" ".repeat(30));
  });
});

describe("検証（validateZengin）", () => {
  it("そろっていれば警告なし", () => {
    expect(validateZengin(INPUT)).toEqual([]);
  });

  it("委託者コード・委託者名が未設定なら警告", () => {
    const w = validateZengin({ ...INPUT, consignorCode: "", consignorKana: "" });
    expect(w.some((m) => m.includes("委託者コード"))).toBe(true);
    expect(w.some((m) => m.includes("委託者名"))).toBe(true);
    expect(validateZengin({ ...INPUT, consignorCode: "ABC" }).some((m) => m.includes("数字 10 桁"))).toBe(true);
  });

  it("振込元の口座の桁数が不正なら警告", () => {
    const w = validateZengin({ ...INPUT, bank: { ...INPUT.bank, bankCode: "5", branchCode: "1", accountNumber: "12345678" } });
    expect(w.some((m) => m.includes("振込元の銀行コード"))).toBe(true);
    expect(w.some((m) => m.includes("振込元の支店コード"))).toBe(true);
    expect(w.some((m) => m.includes("振込元の口座番号"))).toBe(true);
  });

  it("ドライバーの口座が未登録なら名前つきで警告", () => {
    const w = validateZengin({
      ...INPUT,
      rows: [{ ...ROW, bankCode: "", bankName: "", branchCode: "", branchName: "", accountNumber: "", holderKana: "", accountType: null }],
    });
    expect(w.some((m) => m.startsWith("相曽慧：") && m.includes("銀行コード"))).toBe(true);
    expect(w.some((m) => m.includes("口座名義"))).toBe(true);
    expect(w.some((m) => m.includes("預金種目"))).toBe(true);
  });

  it("金額 0 円・端数ありを警告する", () => {
    expect(validateZengin({ ...INPUT, rows: [{ ...ROW, amount: 0 }] }).some((m) => m.includes("0 円"))).toBe(true);
    expect(validateZengin({ ...INPUT, rows: [{ ...ROW, amount: 1000.5 }] }).some((m) => m.includes("端数"))).toBe(true);
  });

  it("取組日の形式・対象 0 件を警告する", () => {
    expect(validateZengin({ ...INPUT, transferDate: "20261031" }).some((m) => m.includes("取組日"))).toBe(true);
    expect(validateZengin({ ...INPUT, rows: [] }).some((m) => m.includes("振込対象がありません"))).toBe(true);
  });

  it("同じ口座が 2 件あれば二重振込の警告", () => {
    const w = validateZengin({ ...INPUT, rows: [ROW, { ...ROW, label: "川島幹太" }] });
    expect(w.some((m) => m.includes("同じ口座"))).toBe(true);
  });

  it("口座名義が 30 桁を超えると切り詰めの警告", () => {
    const w = validateZengin({ ...INPUT, rows: [{ ...ROW, holderKana: "ガギグゲゴザジズゼゾダヂヅデドバビブベボ" }] });
    expect(w.some((m) => m.includes("30 桁"))).toBe(true);
  });
});

describe("振込対象の組み立て（画面・CSV と共用）", () => {
  const driver: TransferDriverSource = {
    driverId: "d1",
    driverName: "相曽慧",
    bankCode: "0009",
    bankName: "ミズホ",
    branchCode: "123",
    branchName: "シンジュク",
    accountType: "ordinary",
    accountNumber: "12345",
    holderKana: "アイソ　ケイ",
  };

  it("口座がそろっていれば ready、足りない項目は日本語で返す", () => {
    expect(missingBankFields(driver)).toEqual([]);
    expect(missingBankFields({ ...driver, bankCode: "", accountType: null, holderKana: "" })).toEqual([
      "銀行コード（4 桁）",
      "預金種目",
      "口座名義（カナ）",
    ]);
    expect(missingBankFields({ ...driver, branchCode: "12", accountNumber: "12345678" })).toEqual(["支店コード（3 桁）", "口座番号（7 桁以内）"]);
  });

  it("toTransferTarget は金額を整数にして ready を判定する", () => {
    const t = toTransferTarget(driver, 396643.4, "2026-10-31");
    expect(t).toMatchObject({ driverId: "d1", driverName: "相曽慧", amount: 396643, payoutDate: "2026-10-31", ready: true, missing: [] });
    const ng = toTransferTarget({ ...driver, bankCode: null }, 1000, "2026-10-31");
    expect(ng.ready).toBe(false);
    expect(ng.missing).toContain("銀行コード（4 桁）");
  });

  it("transferRows は口座がそろって金額 1 円以上のものだけを全銀の行にする", () => {
    const targets = [
      toTransferTarget(driver, 396643, "2026-10-31"),
      toTransferTarget({ ...driver, driverId: "d2", driverName: "川島幹太", holderKana: null }, 50000, "2026-10-31"),
      toTransferTarget({ ...driver, driverId: "d3", driverName: "0 円" }, 0, "2026-10-31"),
    ];
    const rows = transferRows(targets);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ amount: 396643, label: "相曽慧", holderKana: "アイソ　ケイ" });
    expect(validateZengin({ ...INPUT, rows })).toEqual([]);
  });

  it("取組日は指定があればそれ、無ければ一番多い振込予定日（同数なら早い日）", () => {
    const targets = [{ payoutDate: "2026-10-31" }, { payoutDate: "2026-11-15" }, { payoutDate: "2026-11-15" }];
    expect(pickTransferDate(targets)).toBe("2026-11-15");
    expect(pickTransferDate(targets, "2026-12-01")).toBe("2026-12-01");
    expect(pickTransferDate(targets, "12/01")).toBe("2026-11-15");
    expect(pickTransferDate([{ payoutDate: "2026-11-30" }, { payoutDate: "2026-10-31" }])).toBe("2026-10-31");
    expect(pickTransferDate([])).toBe("");
  });

  it("振込予定日の候補は重複なし・日付順", () => {
    expect(transferDateOptions([{ payoutDate: "2026-11-15" }, { payoutDate: "2026-10-31" }, { payoutDate: "2026-11-15" }, { payoutDate: "" }])).toEqual([
      "2026-10-31",
      "2026-11-15",
    ]);
  });

  it("ファイル名は日本語（月つき）", () => {
    expect(transferFileName("2026-12", "txt")).toBe("振込データ_2026-12.txt");
    expect(transferFileName("2026-12", "csv")).toBe("振込一覧_2026-12.csv");
  });
});
