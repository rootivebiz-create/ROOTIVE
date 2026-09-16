/**
 * 個人明細 CSV（§8.1「個人明細：稼働行・ロイヤリティ・管理費・調整・支払額」）
 * 会社売上・会社利益は含めない（ドライバー本人にも渡せる内容）。
 * 金額は「支払額に対する符号」で出す（控除はマイナス）ので、支払額の行を除いた金額の合計 ＝ 支払額 になる。
 */
import type { StatementData } from "@/lib/statement";
import { rawNumber, pct } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";

export const STATEMENT_CSV_HEADERS = ["種別", "案件", "内容", "数量", "単価", "金額", "備考"] as const;

export interface StatementCsvOptions {
  /** ロイヤリティ率を出すか（ドライバー本人向けは会社設定に従う） */
  showRoyaltyRate?: boolean;
}

/** 明細データ → CSV の行（ヘッダー行を含む） */
export function statementToCsvRows(s: StatementData, opts: StatementCsvOptions = {}): CsvValue[][] {
  const showRate = opts.showRoyaltyRate ?? true;
  const rows: CsvValue[][] = [[...STATEMENT_CSV_HEADERS]];
  for (const e of s.entries) {
    rows.push(["稼働", e.projectName, e.itemName, rawNumber(e.qty), rawNumber(e.payRate), rawNumber(e.pay), e.memo]);
  }
  rows.push(["ロイヤリティ", "", showRate && s.royaltyRate != null ? `率 ${pct(s.royaltyRate)}` : "", "", "", rawNumber(-s.royalty), ""]);
  if (s.mgmtFee !== 0) rows.push(["管理費", "", "", "", "", rawNumber(-s.mgmtFee), ""]);
  for (const a of s.adjustments) rows.push(["調整", "", a.label, "", "", rawNumber(a.amount), ""]);
  rows.push(["支払額", "", "", "", "", rawNumber(s.payout), `振込予定日 ${s.payoutDateLabel}`]);
  return rows;
}

/** 個人明細 CSV 文字列 */
export function statementToCsv(s: StatementData, opts: StatementCsvOptions = {}): string {
  return toCsv(statementToCsvRows(s, opts));
}
