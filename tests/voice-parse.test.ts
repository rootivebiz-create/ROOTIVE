import { describe, expect, it } from "vitest";
import {
  describeVoiceEntry,
  extractQty,
  kanjiToNumber,
  matchDriver,
  matchItem,
  mergeVoiceRows,
  parseVoiceEntries,
  splitPhrases,
  toRomaji,
  type VoiceMasters,
} from "@/lib/voice/parse";

/**
 * 話した言葉から稼働の行を組み立てる純関数のテスト。
 * 運転席で片手で入れられることが目的なので、言い方のゆらぎを吸収できることを固める。
 */

const MASTERS: VoiceMasters = {
  drivers: [
    { id: "d1", name: "相曽慧", kana: "アイソサトシ" },
    { id: "d2", name: "安藤陸", kana: "アンドウリク" },
    { id: "d3", name: "黒岩亜夢莉", kana: "クロイワアムリ" },
  ],
  items: [
    { id: "i1", label: "三郷Amazon / 標準", projectName: "三郷Amazon", itemName: "標準", unit: "piece" },
    { id: "i2", label: "三郷Amazon / 大型", projectName: "三郷Amazon", itemName: "大型", unit: "piece" },
    { id: "i3", label: "川崎ヤマト / 標準", projectName: "川崎ヤマト", itemName: "標準", unit: "day" },
  ],
};

describe("kanjiToNumber", () => {
  it("漢数字を数に直す", () => {
    expect(kanjiToNumber("十")).toBe(10);
    expect(kanjiToNumber("二十三")).toBe(23);
    expect(kanjiToNumber("五")).toBe(5);
    expect(kanjiToNumber("百")).toBe(100);
    expect(kanjiToNumber("三十")).toBe(30);
  });

  it("数字はそのまま、読めないものは null", () => {
    expect(kanjiToNumber("12")).toBe(12);
    expect(kanjiToNumber("")).toBeNull();
    expect(kanjiToNumber("あいそ")).toBeNull();
  });
});

describe("extractQty", () => {
  it("単位が付いていても数だけ取り出す", () => {
    expect(extractQty("三郷アマゾン 10件").qty).toBe(10);
    expect(extractQty("川崎 5個").qty).toBe(5);
    expect(extractQty("8台").qty).toBe(8);
  });

  it("日給型の「21日」も数量として読む", () => {
    expect(extractQty("相曽 三郷アマゾン 21日").qty).toBe(21);
    expect(extractQty("相曽 三郷アマゾン 21日").rest).toContain("三郷アマゾン");
  });

  it("全角の数字でも取れる", () => {
    expect(extractQty("１２件").qty).toBe(12);
  });

  it("小数も取れる（1 日 0.5 など）", () => {
    expect(extractQty("川崎 1.5").qty).toBe(1.5);
  });

  it("漢数字でも取れる", () => {
    expect(extractQty("三郷 じゅう").qty).toBeNull(); // ひらがなは対象外
    expect(extractQty("三郷 十").qty).toBe(10);
  });

  it("数が無ければ null で、文はそのまま残る", () => {
    const r = extractQty("三郷アマゾン");
    expect(r.qty).toBeNull();
    expect(r.rest).toContain("三郷");
  });

  it("数を取り除いた残りが返る", () => {
    const r = extractQty("相曽 三郷アマゾン 10件");
    expect(r.rest).toContain("相曽");
    expect(r.rest).toContain("三郷");
    expect(r.rest).not.toContain("10");
  });
});

describe("matchDriver", () => {
  it("名前・カナ・敬称ありのどれでも当たる", () => {
    expect(matchDriver("相曽慧", MASTERS.drivers).driver?.id).toBe("d1");
    expect(matchDriver("相曽さん", MASTERS.drivers).driver?.id).toBe("d1");
    expect(matchDriver("あいそ", MASTERS.drivers).driver?.id).toBe("d1");
    expect(matchDriver("アイソ", MASTERS.drivers).driver?.id).toBe("d1");
  });

  it("別のドライバーと取り違えない", () => {
    expect(matchDriver("安藤", MASTERS.drivers).driver?.id).toBe("d2");
    expect(matchDriver("くろいわ", MASTERS.drivers).driver?.id).toBe("d3");
  });

  it("当てはまらなければ null", () => {
    expect(matchDriver("さとう", MASTERS.drivers).driver).toBeNull();
    expect(matchDriver("", MASTERS.drivers).driver).toBeNull();
  });
});

describe("matchItem", () => {
  it("案件名だけでも当たる", () => {
    expect(matchItem("三郷アマゾン", MASTERS.items).item?.id).toBe("i1");
  });

  it("案件名と内容名の組み合わせで絞れる", () => {
    expect(matchItem("三郷アマゾン大型", MASTERS.items).item?.id).toBe("i2");
  });

  it("離れて話しても、隣り合う言葉をつないで当てる", () => {
    expect(matchItem("三郷 アマゾン", MASTERS.items).item?.id).toBe("i1");
  });

  it("別の案件と取り違えない", () => {
    expect(matchItem("川崎ヤマト", MASTERS.items).item?.id).toBe("i3");
  });

  it("当てはまらなければ null", () => {
    expect(matchItem("東京クロネコ", MASTERS.items).item).toBeNull();
  });
});

describe("splitPhrases", () => {
  it("読点・「あと」「と」で分ける", () => {
    expect(splitPhrases("相曽 三郷 10、安藤 川崎 5")).toHaveLength(2);
    expect(splitPhrases("相曽 三郷 10 あと 安藤 川崎 5")).toHaveLength(2);
  });

  it("1 つだけならそのまま", () => {
    expect(splitPhrases("相曽 三郷 10")).toEqual(["相曽 三郷 10"]);
  });
});

describe("parseVoiceEntries", () => {
  it("ドライバー・案件・数量がそろえば、そのまま保存できる行になる", () => {
    const r = parseVoiceEntries("相曽さん 三郷アマゾン 10件", MASTERS);
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e.driverId).toBe("d1");
    expect(e.itemId).toBe("i1");
    expect(e.qty).toBe(10);
    expect(e.ready).toBe(true);
  });

  it("続けて話すと複数行になる", () => {
    const r = parseVoiceEntries("相曽 三郷アマゾン 10、安藤 川崎ヤマト 5", MASTERS);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].driverId).toBe("d1");
    expect(r.entries[1].driverId).toBe("d2");
    expect(r.entries[1].qty).toBe(5);
    expect(r.entries.every((e) => e.ready)).toBe(true);
  });

  it("2 つ目でドライバーを省いたら、直前の人を引き継ぐ", () => {
    const r = parseVoiceEntries("相曽 三郷アマゾン 10、川崎ヤマト 3", MASTERS);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[1].driverId).toBe("d1");
    expect(r.entries[1].itemId).toBe("i3");
    expect(r.entries[1].ready).toBe(true);
  });

  it("足りないところは ready にせず、そのまま画面で直せるようにする", () => {
    const r = parseVoiceEntries("相曽 三郷アマゾン", MASTERS);
    expect(r.entries[0].ready).toBe(false);
    expect(r.entries[0].qty).toBeNull();
    expect(r.entries[0].driverId).toBe("d1");
  });

  it("まったく当てはまらない言葉は leftovers に入れる", () => {
    const r = parseVoiceEntries("おはようございます", MASTERS);
    expect(r.entries).toHaveLength(0);
    expect(r.leftovers).toEqual(["おはようございます"]);
  });

  it("漢数字でも入る", () => {
    const r = parseVoiceEntries("黒岩 三郷アマゾン 十", MASTERS);
    expect(r.entries[0].qty).toBe(10);
    expect(r.entries[0].driverId).toBe("d3");
  });

  it("空文字なら何も返さない", () => {
    const r = parseVoiceEntries("", MASTERS);
    expect(r.entries).toHaveLength(0);
    expect(r.leftovers).toHaveLength(0);
  });
});

describe("describeVoiceEntry", () => {
  it("足りないところが分かる文にする", () => {
    const r = parseVoiceEntries("相曽 三郷アマゾン", MASTERS);
    expect(describeVoiceEntry(r.entries[0])).toContain("（数量未指定）");
  });
});

describe("toRomaji", () => {
  it("かなをローマ字にする（英字で登録された案件名に当てるため）", () => {
    expect(toRomaji("あまぞん")).toBe("amazon");
    expect(toRomaji("やまと")).toBe("yamato");
    expect(toRomaji("さがわ")).toBe("sagawa");
    expect(toRomaji("さっぽろ")).toBe("sapporo");
    expect(toRomaji("しゃりょう")).toBe("sharyou");
  });

  it("かな以外はそのまま残す", () => {
    expect(toRomaji("三郷あまぞん")).toBe("三郷amazon");
    expect(toRomaji("abc")).toBe("abc");
    expect(toRomaji("")).toBe("");
  });
});

describe("カタカナで話しても英字の案件名に当たる", () => {
  it("「アマゾン」と「Amazon」を同じものとして扱う", () => {
    expect(matchItem("三郷アマゾン", MASTERS.items).item?.id).toBe("i1");
    expect(matchItem("川崎ヤマト", MASTERS.items).item?.id).toBe("i3");
  });
});

describe("漢数字を名前と取り違えない", () => {
  it("「三郷」の「三」は数量にしない", () => {
    expect(extractQty("三郷アマゾン").qty).toBeNull();
    expect(extractQty("黒岩 三郷アマゾン 十").qty).toBe(10);
    expect(extractQty("黒岩 三郷アマゾン 十").rest).toContain("三郷アマゾン");
  });

  it("単位が続くときは言葉の途中でも数量として読む", () => {
    expect(extractQty("十件").qty).toBe(10);
    expect(extractQty("二十三個").qty).toBe(23);
  });
});

describe("数が 2 つ出てきたときの選び方", () => {
  it("単位が付いているほうを選ぶ（案件名の中の数字を拾わない）", () => {
    const r = extractQty("和光ヤマト2便 10件");
    expect(r.qty).toBe(10);
    expect(r.rest).toContain("2便");
  });

  it("どちらにも単位が無ければ後ろのほうを選ぶ", () => {
    expect(extractQty("2便 12").qty).toBe(12);
  });

  it("漢数字でも同じ（単位つきを優先し、無ければ後ろ）", () => {
    expect(extractQty("三 十件").qty).toBe(10);
  });
});

describe("mergeVoiceRows", () => {
  it("同じドライバー × 案件は足し合わせる", () => {
    const merged = mergeVoiceRows([
      { driverId: "d1", itemId: "i1", qty: 5 },
      { driverId: "d1", itemId: "i1", qty: 3 },
      { driverId: "d2", itemId: "i1", qty: 4 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ driverId: "d1", itemId: "i1", qty: 8 });
    expect(merged[1]).toEqual({ driverId: "d2", itemId: "i1", qty: 4 });
  });

  it("空なら空", () => {
    expect(mergeVoiceRows([])).toEqual([]);
  });
});
