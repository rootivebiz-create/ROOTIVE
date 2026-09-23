/**
 * 取り込みの見本ファイル（架空のデータ）を作る。実際の会社の Excel によくある「崩れ」を入れてある：
 * タイトル行・空行・合計行・表記ゆれ（全角/半角・空白・略称）・横持ち（ドライバー × 案件）・Shift_JIS の CSV。
 * npx tsx scripts/make-samples.ts
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const out = path.join(process.cwd(), "public", "samples");

async function main() {
  fs.mkdirSync(out, { recursive: true });

  // 1) 縦持ち（1 行 1 件）。上にタイトル、途中に空行、最後に合計行。名前の表記ゆれあり
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("10月稼働");
    ws.addRow(["サンプル運送株式会社（架空）　2026年10月 稼働集計"]);
    ws.addRow(["作成：事務　山本"]);
    ws.addRow([]);
    ws.addRow(["No", "日付", "ドライバー", "コース", "個数・日数", "備考"]);
    const rows: [string, string, string, number, string?][] = [
      ["2026/10/31", "青木翔太", "宅配", 2310],
      ["2026/10/31", "青木　翔太", "スポット", 4],
      ["2026/10/31", "井上 美咲", "企業配", 21],
      ["2026/10/31", "上田健", "宅配", 1840],
      ["2026/10/31", "遠藤 大輔", "ルート", 168, "時間"],
      ["2026/10/31", "遠藤 大輔", "スポット便", 2],
      ["2026/10/31", "岡田 拓也", "企業配（日当）", 18],
      ["2026/10/31", "岡田 拓也", "宅配", 420],
      ["2026/10/31", "加藤由美", "夜間", 20],
      ["2026/10/31", "木村 誠", "宅配", 380],
      ["2026/10/31", "佐藤 亮", "企業配", 22],
    ] as never;
    rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
    ws.addRow([]);
    ws.addRow(["", "", "合計", "", 5205]);
    await wb.xlsx.writeFile(path.join(out, "稼働_縦持ち_2026年10月.xlsx"));
  }

  // 2) 横持ち（行：ドライバー、列：案件）
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("集計");
    ws.addRow(["2026年10月分 ドライバー別 稼働"]);
    ws.addRow(["氏名", "宅配（個）", "企業配（日）", "スポット（件）", "ルート（時間）", "夜間便（便）", "計"]);
    const data: [string, number, number, number, number, number][] = [
      ["青木 翔太", 2310, 0, 4, 0, 0],
      ["井上 美咲", 0, 21, 0, 0, 0],
      ["上田 健", 1840, 0, 0, 0, 0],
      ["遠藤 大輔", 0, 0, 2, 168, 0],
      ["岡田 拓也", 420, 18, 0, 0, 0],
      ["加藤 由美", 0, 0, 0, 0, 20],
      ["木村 誠", 380, 0, 0, 0, 0],
      ["佐藤 亮", 0, 22, 0, 0, 0],
    ];
    for (const r of data) ws.addRow([...r, r.slice(1).reduce((a, b) => (a as number) + (b as number), 0)]);
    await wb.xlsx.writeFile(path.join(out, "稼働_横持ち_2026年10月.xlsx"));
  }

  // 3) 元請の支払通知（CSV・Shift_JIS）。宅配の個数が少ない・夜間便の単価が違う・待機料の行がある
  {
    const lines = [
      "A物流（架空）　お支払通知書　2026年10月分",
      "品目,数量,単価,金額",
      "宅配,4520,190,858800",
      "企業配,61,22000,1342000",
      "夜間便,20,11500,230000",
      "待機料,3,1000,3000",
      "合計,,,2433800",
    ].join("\r\n");
    // Node の TextEncoder は UTF-8 しか出せないため、ここでは UTF-8（BOM 付き）を作る。
    // Shift_JIS 版（_SJIS.csv）は同じ中身を cp932 に変えたものを同梱している
    fs.writeFileSync(path.join(out, "元請_支払通知_2026年10月_UTF8.csv"), "﻿" + lines);
  }
  console.log("見本を作りました：", fs.readdirSync(out).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
