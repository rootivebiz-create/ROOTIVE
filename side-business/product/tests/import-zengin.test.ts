import { describe, expect, it } from "vitest";
import { buildZenginRecords, toShiftJisBytes, zenginBytes, type Requester, type Transfer } from "@/lib/payroll/zengin";
import { kanaKey, maskAccount, previewBankRows, readBankTable, rowsFromZengin, type LedgerDriver } from "~/server/features/import/bank-read";
import { looksLikeZengin, parseZengin } from "~/server/features/import/zengin-read";

/**
 * 全銀の総合振込ファイルの読み取り（SPEC P0-2.9）：@/lib/payroll/zengin の buildZenginRecords で作ったファイルを読み、
 * 銀行・支店・種目・口座番号・名義カナ・金額が同じに戻ること（往復のテスト）。口座一覧の表の読み取りと、台帳への当て方も。
 */

const requester: Requester = {
  code: "1234567890",
  nameKana: "ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ",
  bankCode: "0001",
  bankNameKana: "ﾐｽﾞﾎ",
  branchCode: "001",
  branchNameKana: "ﾎﾝﾃﾝ",
  accountType: "ordinary",
  accountNumber: "7654321",
};

const transfers: Transfer[] = [
  { bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "101", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "1234567", holderKana: "アオキ ショウタ", amount: 357555, customerCode: "D01" },
  { bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "202", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "checking", accountNumber: "0012345", holderKana: "ｲﾉｳｴ ﾐｻｷ", amount: 401940 },
  { bankCode: "9900", bankNameKana: "ﾕｳﾁﾖ", branchCode: "418", branchNameKana: "ﾖﾝｲﾁﾊﾁ", accountType: "ordinary", accountNumber: "4567890", holderKana: "えんどう だいすけ", amount: 1 },
];

describe("全銀の振込ファイルを読む", () => {
  it("buildZenginRecords で作ったファイル（CRLF つき）を読むと、振込先がそのまま戻る", () => {
    const bytes = zenginBytes(buildZenginRecords(requester, "1025", transfers));
    expect(looksLikeZengin(bytes)).toBe(true);
    const z = parseZengin(bytes);
    expect(z.problems).toEqual([]);
    expect(z).toMatchObject({ typeCode: "21", kindLabel: "総合振込", transferDate: "1025", requesterName: "ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ", trailer: { count: 3, total: 759496 } });
    expect(z.records.map((r) => [r.bankCode, r.bankNameKana, r.branchCode, r.branchNameKana, r.accountType, r.accountNumber, r.holderKana, r.amount, r.customerCode])).toEqual([
      ["0001", "ﾐｽﾞﾎ", "101", "ｻﾝﾌﾟﾙ", "ordinary", "1234567", "ｱｵｷ ｼﾖｳﾀ", 357555, "D01"],
      ["0005", "ﾐﾂﾋﾞｼUFJ", "202", "ｻﾝﾌﾟﾙ", "checking", "0012345", "ｲﾉｳｴ ﾐｻｷ", 401940, ""],
      ["9900", "ﾕｳﾁﾖ", "418", "ﾖﾝｲﾁﾊﾁ", "ordinary", "4567890", "ｴﾝﾄﾞｳ ﾀﾞｲｽｹ", 1, ""],
    ]);
  });

  it("改行の無いファイル（120 バイトが続く）・末尾の EOF も読む", () => {
    const records = buildZenginRecords(requester, "0131", transfers.slice(0, 2));
    const bytes = new Uint8Array([...toShiftJisBytes(records.join("")), 0x1a]);
    expect(looksLikeZengin(bytes)).toBe(true);
    const z = parseZengin(bytes);
    expect(z.problems).toEqual([]);
    expect(z.records).toHaveLength(2);
    expect(z.transferDate).toBe("0131");
  });

  it("件数・合計が合わない、長さが違う行は、読めた分と一緒に理由を返す", () => {
    const records = buildZenginRecords(requester, "1025", transfers);
    // 1 件目を消す（トレーラーは 3 件のまま）・途中に短い行
    const broken = [records[0], records[2], records[3], "2 short", records[4], records[5]];
    const z = parseZengin(toShiftJisBytes(broken.map((r) => r + "\r\n").join("")));
    expect(z.records).toHaveLength(2);
    expect(z.problems.join("\n")).toContain("4 行目の長さが 7 バイトです");
    expect(z.problems.join("\n")).toContain("トレーラーの件数（3件）と、読んだ件数（2件）が合いません");
    expect(z.problems.join("\n")).toContain("トレーラーの合計（759,496円）と、読んだ金額の合計（401,941円）が合いません");
    // 全銀ではないファイル（CSV）は全銀とみなさない
    expect(looksLikeZengin(new TextEncoder().encode("氏名,銀行コード\n青木,0001\n"))).toBe(false);
  });
});

describe("口座一覧の表を読む", () => {
  it("Excel が落とした先頭の 0 を戻す（1 → 0001・12345 → 0012345）。種目の空は普通。漢字の名義・貯蓄は読めない理由を出す", () => {
    const rows = [
      ["ドライバー口座一覧"],
      ["番号", "氏名", "銀行コード", "銀行名", "支店コード", "支店名", "種目", "口座番号", "名義カナ"],
      ["D01", "青木 翔太", "1", "ﾐｽﾞﾎ", "101", "ｻﾝﾌﾟﾙ", "普通", "1234567", "アオキ ショウタ"],
      ["D02", "井上 美咲", "5", "三菱UFJ銀行", "202", "", "", "12345", "ｲﾉｳｴ ﾐｻｷ"],
      ["D03", "上田 健", "9", "", "303", "", "貯蓄", "3456789", "上田 健"],
      ["", "", "", "", "", "", "", "", ""],
    ];
    const out = readBankTable(rows);
    expect(out.problem).toBeNull();
    expect(out.headerRow).toBe(1);
    expect(out.rows.map((r) => [r.where, r.code, r.name, r.bankCode, r.branchCode, r.accountType, r.accountNumber, r.holderKana])).toEqual([
      ["3 行目", "D01", "青木 翔太", "0001", "101", "ordinary", "1234567", "アオキ ショウタ"],
      ["4 行目", "D02", "井上 美咲", "0005", "202", "ordinary", "0012345", "ｲﾉｳｴ ﾐｻｷ"],
      ["5 行目", "D03", "上田 健", "0009", "303", null, "3456789", "上田 健"],
    ]);
    expect(out.rows[1].notes).toEqual(["種目が空なので「普通」にします"]);
    expect(out.rows[2].problems.join("\n")).toContain("貯蓄などは振込データで扱えません");
    expect(out.rows[2].problems.join("\n")).toContain("口座名義に使えない文字があります");
    expect(readBankTable([["名前", "住所"], ["青木", "東京"]]).problem).toContain("見出し");
  });

  it("カナは全銀の書き方にそろえて比べる（ショウタ ＝ ｼﾖｳﾀ・ひらがな・長音・法人の略号）", () => {
    expect(kanaKey("アオキ ショウタ")).toBe(kanaKey("ｱｵｷ ｼﾖｳﾀ"));
    expect(kanaKey("あおき　しょうた")).toBe(kanaKey("ｱｵｷｼﾖｳﾀ"));
    expect(kanaKey("ｶ)ﾔﾏﾀﾞｳﾝｿｳ")).toBe(kanaKey("ヤマダウンソウ"));
    expect(kanaKey("青木 翔太")).toBe("");
    expect(maskAccount("1234567")).toBe("****567");
  });
});

describe("台帳に当てる（純関数）", () => {
  const ledger: LedgerDriver[] = [
    { id: "a", name: "青木 翔太", code: "D01", kana: "アオキ ショウタ", aliases: [], active: true, bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "101", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "1234567", holderKana: "アオキ ショウタ" },
    { id: "b", name: "井上 美咲", code: "D02", kana: "イノウエ ミサキ", aliases: [], active: true, bankCode: "0005", bankNameKana: "ﾐﾂﾋﾞｼUFJ", branchCode: "202", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "2345678", holderKana: "イノウエ ミサキ" },
    { id: "c", name: "木村 誠", code: "D07", kana: "キムラ マコト", aliases: [], active: true, bankCode: null, bankNameKana: null, branchCode: null, branchNameKana: null, accountType: "ordinary", accountNumber: null, holderKana: null },
    { id: "d", name: "佐藤 亮", code: "D08", kana: "サトウ リョウ", aliases: [], active: true, bankCode: "0009", bankNameKana: "ﾐﾂｲｽﾐﾄﾓ", branchCode: "310", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "7890123", holderKana: "サトウ リョウ" },
    { id: "e", name: "佐藤 良", code: "D09", kana: "サトウ リョウ", aliases: [], active: true, bankCode: null, bankNameKana: null, branchCode: null, branchNameKana: null, accountType: "ordinary", accountNumber: null, holderKana: null },
  ];
  const tr = (holderKana: string, accountNumber: string, bankCode = "0001", branchCode = "101"): Transfer => ({
    bankCode,
    bankNameKana: "ﾐｽﾞﾎ",
    branchCode,
    branchNameKana: "ｻﾝﾌﾟﾙ",
    accountType: "ordinary",
    accountNumber,
    holderKana,
    amount: 1000,
  });

  it("新しく入る・変わる・同じ・当たらない・同じ読みが 2 人を分ける。口座番号は下 3 桁だけ見せる", () => {
    const z = parseZengin(
      zenginBytes(
        buildZenginRecords(requester, "1025", [
          tr("ｱｵｷ ｼﾖｳﾀ", "7654321"), // 青木：口座番号が変わる
          { ...tr("ｲﾉｳｴ ﾐｻｷ", "2345678", "0005", "202"), bankNameKana: "ﾐﾂﾋﾞｼUFJ" }, // 井上：同じ
          tr("ｷﾑﾗ ﾏｺﾄ", "1112223", "0009", "303"), // 木村：新しく入る
          tr("ﾔﾏﾀﾞ ﾀﾛｳ", "5556667"), // 台帳にいない
          tr("ｻﾄｳ ﾘﾖｳ", "9990001"), // 同じ読みが 2 人
        ]),
      ),
    );
    const rows = previewBankRows(rowsFromZengin(z), ledger, {}, (b) => `${b.bankCode}:${b.accountNumber}`);
    expect(rows.map((r) => [r.input.where, r.driver?.name ?? null, r.how, r.status])).toEqual([
      ["1 件目", "青木 翔太", "kana", "changed"],
      ["2 件目", "井上 美咲", "kana", "same"],
      ["3 件目", "木村 誠", "kana", "new"],
      ["4 件目", null, null, "unmatched"],
      ["5 件目", null, null, "unmatched"],
    ]);
    expect(rows[0].changes).toEqual([{ field: "accountNumber", label: "口座番号", before: "****567", after: "****321" }]);
    // 名義は読みが同じなら台帳の書き方を残す
    expect(rows[0].next!.holderKana).toBe("アオキ ショウタ");
    expect(rows[0].seen).toBe("0001:1234567");
    expect(rows[2].next).toEqual({ bankCode: "0009", bankNameKana: "ﾐｽﾞﾎ", branchCode: "303", branchNameKana: "ｻﾝﾌﾟﾙ", accountType: "ordinary", accountNumber: "1112223", holderKana: "ｷﾑﾗ ﾏｺﾄ" });
    expect(rows[4].candidates.map((c) => c.name).sort()).toEqual(["佐藤 亮", "佐藤 良"]);
    // 選んで当てる → その人の口座として比べる
    const chosen = previewBankRows(rowsFromZengin(z), ledger, { "4": "e" }, () => "");
    expect(chosen[4]).toMatchObject({ how: "chosen", status: "new", driver: { name: "佐藤 良" } });
  });

  it("同じ人に違う口座が 2 行あれば、2 行目は入れない（どちらか決めてもらう）", () => {
    const z = parseZengin(zenginBytes(buildZenginRecords(requester, "1025", [tr("ｱｵｷ ｼﾖｳﾀ", "7654321"), tr("ｱｵｷ ｼﾖｳﾀ", "1111111")])));
    const rows = previewBankRows(rowsFromZengin(z), ledger, {}, () => "");
    expect(rows.map((r) => r.status)).toEqual(["changed", "duplicate"]);
    expect(rows[1].next).toBeNull();
  });
});
