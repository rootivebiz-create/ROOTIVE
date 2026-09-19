import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTH_PACK_PARTS,
  MONTH_PACK_CSV_NAMES,
  MONTH_PACK_PARTS,
  isEmptyParts,
  monthPackEntries,
  monthPackFilename,
  monthPackPartsParam,
  monthPackReadme,
  parseMonthPackParts,
  safePackName,
  uniquePackName,
  type MonthPackParts,
} from "@/lib/exports/month-pack";

const ALL: MonthPackParts = { statements: true, invoices: true, csv: true, transfer: true, report: true };
const NONE: MonthPackParts = { statements: false, invoices: false, csv: false, transfer: false, report: false };

const drivers = [{ id: "d1", name: "相曽慧" }, { id: "d2", name: "川島幹太" }];
const invoices = [{ id: "i1", invoiceNo: "INV-0001", clientName: "ヤマト運輸" }];

/** README を除いたパスの一覧 */
const names = (parts: MonthPackParts, month = "2026-12") =>
  monthPackEntries({ month, parts, drivers, invoices })
    .filter((e) => e.kind !== "readme")
    .map((e) => e.name);

describe("月次パックのファイル名", () => {
  it("ZIP のファイル名は 月次パック_稼動月.zip になる", () => {
    expect(monthPackFilename("2026-12")).toBe("月次パック_2026-12.zip");
  });

  it("ファイル名に使えない文字（/ \\ : * ? \" < > |）を取り除く", () => {
    expect(safePackName('相/曽\\慧:*?"<>|')).toBe("相曽慧");
  });

  it("制御文字・前後の空白とドットを取り除く", () => {
    expect(safePackName("  ..山田 太郎..  ")).toBe("山田 太郎");
    expect(safePackName("山田\u0001太郎")).toBe("山田太郎");
  });

  it("使える文字が残らないときは 無題 にする", () => {
    expect(safePackName("///")).toBe("無題");
    expect(safePackName("")).toBe("無題");
  });
});

describe("月次パックのフォルダ構成", () => {
  it("明細 PDF は 稼動月/明細/ドライバー名_稼動月.pdf に入る", () => {
    expect(names({ ...NONE, statements: true })).toEqual(["2026-12/明細/相曽慧_2026-12.pdf", "2026-12/明細/川島幹太_2026-12.pdf"]);
  });

  it("請求書 PDF は 稼動月/請求書/請求書番号.pdf に入る", () => {
    expect(names({ ...NONE, invoices: true })).toEqual(["2026-12/請求書/INV-0001.pdf"]);
  });

  it("請求書番号が無いときは取引先名をファイル名に使う", () => {
    const entries = monthPackEntries({ month: "2026-12", parts: { ...NONE, invoices: true }, invoices: [{ id: "i9", invoiceNo: "", clientName: "佐川急便" }] });
    expect(entries[0].name).toBe("2026-12/請求書/佐川急便.pdf");
    expect(entries[0].label).toBe("佐川急便");
  });

  it("CSV は 稼動月/CSV/ に 5 種類入る", () => {
    expect(names({ ...NONE, csv: true })).toEqual(MONTH_PACK_CSV_NAMES.map((n) => `2026-12/CSV/${n}.csv`));
  });

  it("振込データは 稼動月/振込/振込データ.txt に入る", () => {
    expect(names({ ...NONE, transfer: true })).toEqual(["2026-12/振込/振込データ.txt"]);
  });

  it("経営レポートと README は月フォルダの直下に入る", () => {
    const entries = monthPackEntries({ month: "2026-12", parts: { ...NONE, report: true } });
    expect(entries.map((e) => e.name)).toEqual(["2026-12/経営レポート_2026-12.pdf", "2026-12/README.txt"]);
  });

  it("README は選んだ出力に関わらず必ず最後に 1 件だけ入る", () => {
    for (const parts of [NONE, ALL, DEFAULT_MONTH_PACK_PARTS]) {
      const entries = monthPackEntries({ month: "2026-12", parts, drivers, invoices });
      expect(entries.filter((e) => e.kind === "readme")).toHaveLength(1);
      expect(entries[entries.length - 1].name).toBe("2026-12/README.txt");
    }
  });

  it("ドライバー名の使えない文字はフォルダ構成でも取り除く", () => {
    const entries = monthPackEntries({ month: "2026-12", parts: { ...NONE, statements: true }, drivers: [{ id: "d9", name: "山田/太郎" }] });
    expect(entries[0].name).toBe("2026-12/明細/山田太郎_2026-12.pdf");
    expect(entries[0].label).toBe("山田/太郎");
  });

  it("元データの ID を entry に持ち回す", () => {
    const entries = monthPackEntries({ month: "2026-12", parts: { ...NONE, statements: true, invoices: true }, drivers, invoices });
    expect(entries.map((e) => e.id)).toEqual(["d1", "d2", "i1", undefined]);
  });
});

describe("月次パックの同名回避", () => {
  it("同じドライバー名が 2 人いると 2 件目に (2) を付ける", () => {
    const entries = monthPackEntries({
      month: "2026-12",
      parts: { ...NONE, statements: true },
      drivers: [{ name: "山田太郎" }, { name: "山田太郎" }, { name: "山田太郎" }],
    });
    expect(entries.map((e) => e.name)).toEqual([
      "2026-12/明細/山田太郎_2026-12.pdf",
      "2026-12/明細/山田太郎_2026-12 (2).pdf",
      "2026-12/明細/山田太郎_2026-12 (3).pdf",
      "2026-12/README.txt",
    ]);
  });

  it("使えない文字を取り除いた結果が同名になっても重ならない", () => {
    const entries = monthPackEntries({ month: "2026-12", parts: { ...NONE, invoices: true }, invoices: [{ invoiceNo: "INV:0001" }, { invoiceNo: "INV*0001" }] });
    expect(entries.map((e) => e.name)).toEqual(["2026-12/請求書/INV0001.pdf", "2026-12/請求書/INV0001 (2).pdf", "2026-12/README.txt"]);
  });

  it("大文字・小文字だけの違いも同名として扱う", () => {
    const used = new Set<string>();
    expect(uniquePackName("2026-12/明細/abc.pdf", used)).toBe("2026-12/明細/abc.pdf");
    expect(uniquePackName("2026-12/明細/ABC.pdf", used)).toBe("2026-12/明細/ABC (2).pdf");
  });

  it("フォルダが違えば同じファイル名でも番号を付けない", () => {
    const used = new Set<string>();
    expect(uniquePackName("2026-12/明細/x.pdf", used)).toBe("2026-12/明細/x.pdf");
    expect(uniquePackName("2026-12/請求書/x.pdf", used)).toBe("2026-12/請求書/x.pdf");
  });
});

describe("月次パックの parts（含める出力の絞り込み）", () => {
  it("省略時は振込データ以外をすべて含む", () => {
    expect(parseMonthPackParts(undefined)).toEqual(DEFAULT_MONTH_PACK_PARTS);
    expect(parseMonthPackParts("")).toEqual(DEFAULT_MONTH_PACK_PARTS);
    expect(DEFAULT_MONTH_PACK_PARTS.transfer).toBe(false);
  });

  it("指定した出力だけを true にする", () => {
    expect(parseMonthPackParts("statements,csv")).toEqual({ statements: true, invoices: false, csv: true, transfer: false, report: false });
  });

  it("前後の空白・大文字・知らない名前を無視する", () => {
    expect(parseMonthPackParts(" Statements , unknown ,CSV")).toEqual({ statements: true, invoices: false, csv: true, transfer: false, report: false });
  });

  it("知らない名前だけのときは既定に戻す", () => {
    expect(parseMonthPackParts("foo,bar")).toEqual(DEFAULT_MONTH_PACK_PARTS);
  });

  it("all を指定すると振込データも含める", () => {
    expect(parseMonthPackParts("all")).toEqual(ALL);
  });

  it("振込データは明示したときだけ含まれる", () => {
    expect(parseMonthPackParts("transfer").transfer).toBe(true);
    expect(names(parseMonthPackParts("transfer"))).toEqual(["2026-12/振込/振込データ.txt"]);
    expect(names(DEFAULT_MONTH_PACK_PARTS).some((n) => n.includes("振込"))).toBe(false);
  });

  it("parts をクエリ文字列に戻せる（並びは MONTH_PACK_PARTS の順）", () => {
    expect(monthPackPartsParam({ ...NONE, csv: true, statements: true })).toBe("statements,csv");
    expect(monthPackPartsParam(ALL)).toBe(MONTH_PACK_PARTS.join(","));
    expect(parseMonthPackParts(monthPackPartsParam({ ...NONE, report: true }))).toEqual({ ...NONE, report: true });
  });

  it("1 つも選ばれていないことを判定できる", () => {
    expect(isEmptyParts(NONE)).toBe(true);
    expect(isEmptyParts({ ...NONE, report: true })).toBe(false);
  });

  it("選ばれていない出力のファイルは一覧に入らない", () => {
    const list = names({ ...ALL, statements: false });
    expect(list.some((n) => n.includes("/明細/"))).toBe(false);
    expect(list.some((n) => n.includes("/請求書/"))).toBe(true);
  });
});

describe("月次パックの README", () => {
  const base = {
    companyName: "ROOTIVE 株式会社",
    month: "2026-12",
    entries: monthPackEntries({ month: "2026-12", parts: DEFAULT_MONTH_PACK_PARTS, drivers, invoices }),
    generatedAt: new Date("2026-12-31T09:05:00Z"),
  };

  it("会社名・対象月・作成日時・件数を載せる", () => {
    const text = monthPackReadme({ ...base, closed: true });
    expect(text).toContain("ROOTIVE 株式会社");
    expect(text).toContain("2026年12月（2026-12）");
    expect(text).toContain("2026/12/31 18:05");
    expect(text).toContain(`ファイル数：${base.entries.length - 1} 件`);
  });

  it("締め済みなら確定値、未締めなら速報値と注記する", () => {
    expect(monthPackReadme({ ...base, closed: true })).toContain("締め済み（確定値）");
    const open = monthPackReadme({ ...base, closed: false });
    expect(open).toContain("未締め（速報値）");
    expect(open).toContain("この月はまだ締めていません");
  });

  it("入っているファイルを種類ごとに列挙する", () => {
    const text = monthPackReadme({ ...base, closed: true });
    expect(text).toContain("■ 支払明細 PDF（2 件）");
    expect(text).toContain("2026-12/明細/相曽慧_2026-12.pdf");
    expect(text).toContain("■ CSV（5 件）");
    expect(text).not.toContain("■ 振込データ");
  });

  it("作成できなかったファイルを理由つきで残す", () => {
    const text = monthPackReadme({ ...base, closed: true, errors: [{ name: "2026-12/請求書/INV-0002.pdf", message: "請求書が見つかりません。" }] });
    expect(text).toContain("【作成できなかったファイル】（1 件）");
    expect(text).toContain("2026-12/請求書/INV-0002.pdf：請求書が見つかりません。");
  });

  it("エラーが無ければその見出しを出さない", () => {
    expect(monthPackReadme({ ...base, closed: true })).not.toContain("【作成できなかったファイル】");
  });

  it("改行は CRLF で、税の扱いを明記する", () => {
    const text = monthPackReadme({ ...base, closed: true });
    expect(text.includes("\r\n")).toBe(true);
    expect(text.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
    expect(text).toContain("金額は税抜です");
  });
});
