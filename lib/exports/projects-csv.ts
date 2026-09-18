/**
 * 案件別採算 CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は rawNumber）
 * 値はすべて v_project_pl の列をそのまま出す（案件利益 ＝ 稼働の利益 − 直課経費）。
 * 率は 0.1 のような率のまま。目標利益率が未設定の案件は空欄・判定は「目標なし」。
 * 管理費・調整はドライバー単位のため案件には配賦していない。
 */
import { judgeTarget, TARGET_JUDGEMENT_CSV_LABELS, type ProjectPlRow } from "@/components/projects/helpers";
import { rawNumber } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";

export const PROJECTS_CSV_HEADERS = [
  "稼動月",
  "案件",
  "取引先",
  "稼働件数",
  "ドライバー数",
  "数量",
  "売上",
  "ドライバー支払",
  "単価差額利益",
  "ロイヤリティ",
  "稼働の利益",
  "直課経費",
  "案件利益",
  "利益率",
  "目標利益率",
  "判定",
] as const;

export function projectToCsvRow(r: ProjectPlRow): CsvValue[] {
  return [
    r.month,
    r.projectName,
    r.clientName,
    r.entryCount,
    r.driverCount,
    rawNumber(r.qtyTotal),
    rawNumber(r.bill),
    rawNumber(r.pay),
    rawNumber(r.margin),
    rawNumber(r.royalty),
    rawNumber(r.entryProfit),
    rawNumber(r.expenseDirect),
    rawNumber(r.projectProfit),
    rawNumber(r.projectMargin),
    r.targetMargin == null ? "" : rawNumber(r.targetMargin),
    TARGET_JUDGEMENT_CSV_LABELS[judgeTarget(r)],
  ];
}

/** 案件別採算 CSV（ヘッダー行付き） */
export function toProjectsCsv(rows: ProjectPlRow[]): string {
  return toCsv([[...PROJECTS_CSV_HEADERS], ...rows.map(projectToCsvRow)]);
}
