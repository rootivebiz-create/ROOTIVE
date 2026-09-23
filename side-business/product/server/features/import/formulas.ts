import "server-only";
import ExcelJS from "exceljs";
import { parseDeductionFormula } from "./formula-read";

/**
 * Excel の数式を読む（控除の提案の手がかり）。値は server/tabular.ts が読むので、ここでは数式だけ。
 * 控除の式として読める数式（「=E5*0.1」など）だけを、シートの名前 → 番地（F5）→ 数式 で返す。読めなくても取り込みは止めない。
 */

/** これより大きいファイルは数式を読まない（読み込みの時間を延ばさないため。値からの提案はそのまま出る） */
export const FORMULA_READ_MAX_BYTES = 5 * 1024 * 1024;
/** 持っておく数式の数の上限（ブック全体で） */
const MAX_FORMULA_CELLS = 5000;

export type SheetFormulas = Record<string, Record<string, string>>;

export async function readFormulaCells(bytes: Uint8Array): Promise<SheetFormulas> {
  if (bytes.byteLength > FORMULA_READ_MAX_BYTES) return {};
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    return {};
  }
  const out: SheetFormulas = {};
  let count = 0;
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const cells: Record<string, string> = {};
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (count >= MAX_FORMULA_CELLS || cell.type !== ExcelJS.ValueType.Formula) return;
        let formula: string | undefined;
        try {
          // 共有の数式（下へコピーした数式）も、そのセルの番地に直した形で読める
          formula = cell.formula;
        } catch {
          return;
        }
        if (!formula || formula.length > 200 || !parseDeductionFormula(formula)) return;
        cells[cell.address] = formula.startsWith("=") ? formula : `=${formula}`;
        count++;
      });
    });
    if (Object.keys(cells).length > 0) out[ws.name] = cells;
  });
  return out;
}
