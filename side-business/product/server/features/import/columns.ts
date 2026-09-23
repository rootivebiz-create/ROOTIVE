/**
 * 取り込み：稼働の表にある「金額の列」（今の Excel の振込額・委託料・控除・振込手数料）を見つけて、人ごとの値を読む（純関数。DB に触らない）。
 * 数量として読む列（読み方で役目を付けた列）には触らない。「使わない」の列だけを見る。
 */
import { isBlankRow, isTotalRow, normalizeHeader, parseNumberCell } from "~/server/tabular";
import { colLetter, isTotalHeader } from "./detect";
import type { ColumnRole, WorkMapping } from "./types";

/** 控除の区分（見出しの言葉から） */
export type DeductionCategory = "royalty" | "admin" | "lease" | "insurance" | "fuel" | "advance";

export const CATEGORY_LABEL: Record<DeductionCategory, string> = {
  royalty: "ロイヤリティ",
  admin: "管理費・事務手数料",
  lease: "リース・車両代",
  insurance: "保険",
  fuel: "燃料",
  advance: "立替の精算",
};

export type MoneyColumn =
  /** 今の Excel の振込額（strength が大きいほど「振込額」らしい） */
  | { col: number; header: string; kind: "payout"; strength: number }
  /** 委託料（控除の率の元にする） */
  | { col: number; header: string; kind: "base" }
  /** 振込手数料（控除のルールにはしない） */
  | { col: number; header: string; kind: "fee" }
  | { col: number; header: string; kind: "deduction"; category: DeductionCategory };

type Classified = { kind: "payout"; strength: number } | { kind: "base" } | { kind: "fee" } | { kind: "deduction"; category: DeductionCategory };

const DEDUCTION_WORDS: [DeductionCategory, RegExp][] = [
  ["royalty", /ロイヤリティ|ロイヤルティ|ロイヤリテイ|royalty/],
  ["admin", /管理費|事務手数料|事務費|手数料|システム利用料|システム料/],
  ["lease", /リース|車両代|車両費|車両賃|車両レンタル|レンタル料|車代/],
  ["insurance", /保険/],
  ["fuel", /燃料|ガソリン|軽油/],
  ["advance", /立替|立て替え|たてかえ/],
];

/** 見出しの言葉から、金額の列の種類を当てる（当たらなければ null） */
export function classifyMoneyHeader(header: string): Classified | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  // 率・単価・合計の列、消費税の列は、額の列ではない
  if (/率|単価|%|％|消費税|^税$|控除合?計|控除額計|差引計/.test(h)) return null;
  if (/振込手数料|振込料|送金手数料|振替手数料/.test(h)) return { kind: "fee" };
  for (const [category, re] of DEDUCTION_WORDS) if (re.test(h)) return { kind: "deduction", category };
  if (/委託料|報酬|税抜|小計/.test(h) && !/税込/.test(h)) return { kind: "base" };
  if (/税込|税抜/.test(h)) return null;
  if (/振込額|振込金額|お振込|差引支給|差引支払|差引振込|差引額|振込予定額/.test(h)) return { kind: "payout", strength: 3 };
  if (/支給額|支給金額|手取/.test(h)) return { kind: "payout", strength: 2 };
  if (/^お?支払(金)?額$|支払合計|支払総額/.test(h)) return { kind: "payout", strength: 1 };
  return null;
}

/** 稼働として読まない列（役目が「使わない」）のうち、金額の列 */
export function findMoneyColumns(header: string[], roles: ColumnRole[]): MoneyColumn[] {
  const out: MoneyColumn[] = [];
  header.forEach((h, col) => {
    const role = roles[col] ?? "ignore";
    if (role !== "ignore" || !h.trim() || isTotalHeader(h)) return;
    const c = classifyMoneyHeader(h);
    if (c) out.push({ col, header: h.trim(), ...c } as MoneyColumn);
  });
  return out;
}

export type PerDriver = {
  /** 人ごとの値（perRow なら行の合計、そうでなければ 1 回だけ） */
  values: Map<string, number>;
  /** 同じ人の行で値が違う＝行ごとの額（そうでなければ、人ごとの額を行ごとに書き写したもの） */
  perRow: boolean;
  /** 値が入っていた行の数 */
  rowsWithValue: number;
  /** 数として読めなかったセル（番地） */
  unreadable: string[];
};

/**
 * ある列の値を、人ごとに読む。当たった行（resolved の行番号）だけを見る。
 * 縦持ちの表で、人ごとの額（振込額など）が毎行に書いてあっても、1 人 1 回にする。
 * 同じ人の行で値が違えば「行ごとの額」とみなし、人ごとに足す。
 */
export function perDriverValues(rows: string[][], mapping: WorkMapping, resolved: { rowNo: number; driverId: string }[], col: number): PerDriver {
  const rowDriver = new Map<number, string>();
  for (const r of resolved) if (!rowDriver.has(r.rowNo)) rowDriver.set(r.rowNo, r.driverId);
  const lists = new Map<string, number[]>();
  const unreadable: string[] = [];
  let rowsWithValue = 0;
  for (let i = mapping.headerRow + mapping.headerDepth; i < rows.length; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row) || isTotalRow(row)) continue;
    const driverId = rowDriver.get(i + 1);
    if (!driverId) continue;
    const raw = (row[col] ?? "").trim();
    if (!raw) continue;
    const n = parseNumberCell(raw);
    if (n === null) {
      unreadable.push(`${colLetter(col)}${i + 1}`);
      continue;
    }
    rowsWithValue++;
    const list = lists.get(driverId) ?? [];
    list.push(n);
    lists.set(driverId, list);
  }
  const perRow = [...lists.values()].some((l) => l.some((v) => Math.abs(v - l[0]) > 1e-6));
  const values = new Map<string, number>();
  for (const [d, l] of lists) values.set(d, perRow ? Math.round(l.reduce((a, b) => a + b, 0) * 1e4) / 1e4 : l[0]);
  return { values, perRow, rowsWithValue, unreadable };
}

// ---------------------------------------------------------------- 今の Excel の振込額

export type PayoutRead = {
  col: number;
  header: string;
  /** 人ごとの振込額（円の整数） */
  entries: { driverId: string; name: string; amount: number }[];
  /** 行ごとに違う額が入っていた（振込額とはみなさない） */
  perRow: boolean;
  unreadable: string[];
};

/**
 * 振込額らしい列（振込額・差引支給額・支払額・支給額）を読む。いちばん振込額らしい列を 1 つだけ使う。
 * 同じ人の行で額が違う列は、行ごとの金額（数量 × 単価 など）なので、振込額とはみなさない（entries は空）。
 */
export function readPayout(
  rows: string[][],
  mapping: WorkMapping,
  header: string[],
  resolved: { rowNo: number; driverId: string }[],
  names: Map<string, string>,
): PayoutRead | null {
  const cols = findMoneyColumns(header, mapping.roles).filter((c): c is Extract<MoneyColumn, { kind: "payout" }> => c.kind === "payout");
  if (cols.length === 0) return null;
  // 振込額らしさが同じなら、右の列（差し引いたあとの額が右に来ることが多い）
  const best = [...cols].sort((a, b) => b.strength - a.strength || b.col - a.col)[0];
  const read = perDriverValues(rows, mapping, resolved, best.col);
  const entries = read.perRow
    ? []
    : [...read.values.entries()]
        .map(([driverId, v]) => ({ driverId, name: names.get(driverId) ?? "", amount: Math.round(v) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return { col: best.col, header: best.header, entries, perRow: read.perRow, unreadable: read.unreadable };
}
