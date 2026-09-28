import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "sales-kit", name), "utf8");

describe("お試しの報告書の例（sales-kit/10）", () => {
  const doc = read("10-diagnosis-report-template.md");
  const SUMMARY = /確認をおすすめすることが(\d+)件あります（赤(\d+)件・黄(\d+)件）/;
  /** 例の報告書（まとめの件数の行より後）の「3. 締め前の見張り番」。空欄のひな形の 3. は含めない */
  const exampleList = () => {
    const at = doc.search(SUMMARY);
    return at < 0 ? "" : (doc.slice(at).match(/^3\. 締め前の見張り番[\s\S]*?(?=^4\. )/m)?.[0] ?? "");
  };

  it("まとめの見張り番の件数が、3. の一覧（赤・黄の行）と合う", () => {
    const m = doc.match(SUMMARY);
    expect(m).not.toBeNull();
    const [, total, red, yellow] = m!.map(Number);
    const list = exampleList();
    const reds = list.split("\n").filter((l) => l.startsWith("　赤　")).length;
    const yellows = list.split("\n").filter((l) => l.startsWith("　黄　")).length;
    expect(reds + yellows).toBeGreaterThan(0);
    expect({ red: reds, yellow: yellows }).toEqual({ red, yellow });
    expect(red + yellow).toBe(total);
  });

  it("デモの控除のうち、書面はあるが合意した日が無い 3 つ（ロイヤリティ・管理費・車両リース）をすべて載せる", () => {
    const list = exampleList();
    for (const name of ["ロイヤリティ", "管理費", "車両リース"]) expect(list).toMatch(new RegExp(`^　黄　.*${name}.*合意した日の記録がありません`, "m"));
  });
});

describe("商談の台本（sales-kit/07）", () => {
  it("見本の「人 × 案件の表」を、日付の並んだ表とは言わない（見本の列は 氏名・案件・計 だけ）", () => {
    const row = read("07-meeting-and-hearing-sheet.md")
      .split("\n")
      .find((l) => l.includes("見本：人 × 案件の表"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/日付/);
    expect(row).toContain("ファイルの合計 5,205 と一致");
  });
});
