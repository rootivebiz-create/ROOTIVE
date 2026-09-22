/**
 * 配車予定の CSV（§8.1 と同じ体裁：UTF-8 BOM・CRLF・数値は生の値）
 *
 * 「来週だれがどこに入るか」を紙で配る・元請へ渡すためのもの。
 * 予定の売上・支払は 単価 × 予定数量 で、計算は `lib/calc` の `mulMoney` を使う（独自の丸めを書かない）。
 */
import { mulMoney, sumMoney } from "@/lib/calc";
import { UNIT_LABELS, type Unit } from "@/lib/calc/types";
import { DISPATCH_STATUS_LABELS, type DispatchListRow, type DispatchStatus } from "@/lib/db/types";
import { weekdayJa } from "@/lib/daily/helpers";
import { rawNumber } from "@/lib/format";
import { toCsv, type CsvValue } from "./csv";

export const DISPATCH_CSV_HEADERS = [
  "日付",
  "曜日",
  "ドライバー",
  "案件",
  "案件内容",
  "状態",
  "予定数量",
  "単位",
  "受注単価",
  "支払単価",
  "予定売上",
  "予定支払",
  "予定粗利",
  "報告",
  "備考",
] as const;

export type DispatchCsvSource = Pick<
  DispatchListRow,
  "on_date" | "driver_name" | "project_name" | "item_name" | "status" | "qty_plan" | "unit" | "bill_rate" | "pay_rate" | "has_report" | "note"
>;

/** 1 行ぶん */
export function dispatchToCsvRow(r: DispatchCsvSource): CsvValue[] {
  const qty = Number(r.qty_plan ?? 0);
  const bill = mulMoney(Number(r.bill_rate ?? 0), qty);
  const pay = mulMoney(Number(r.pay_rate ?? 0), qty);
  return [
    r.on_date ?? "",
    r.on_date ? weekdayJa(r.on_date) : "",
    r.driver_name ?? "",
    r.project_name ?? "",
    r.item_name ?? "",
    DISPATCH_STATUS_LABELS[(r.status ?? "planned") as DispatchStatus] ?? "",
    rawNumber(qty),
    UNIT_LABELS[(r.unit ?? "day") as Unit] ?? "",
    rawNumber(Number(r.bill_rate ?? 0)),
    rawNumber(Number(r.pay_rate ?? 0)),
    rawNumber(bill),
    rawNumber(pay),
    rawNumber(sumMoney([bill, -pay])),
    r.has_report ? "あり" : "",
    r.note ?? "",
  ];
}

/** 見出し ＋ 明細 */
export function dispatchCsvRows(rows: DispatchCsvSource[]): CsvValue[][] {
  return [[...DISPATCH_CSV_HEADERS], ...rows.map(dispatchToCsvRow)];
}

export function dispatchToCsv(rows: DispatchCsvSource[]): string {
  return toCsv(dispatchCsvRows(rows));
}

/** ファイル名（期間が分かるようにする） */
export function dispatchCsvFilename(from: string, to: string): string {
  return `配車_${from}_${to}.csv`;
}
