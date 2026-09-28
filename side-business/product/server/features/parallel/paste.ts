/**
 * Excel との比べ合わせ：Excel の「名前・振込額」の表を読む（純関数。DB に触らない）。
 * 貼り付けた 2 列でも、振込の一覧のファイル（列がたくさんある表）でも読めるように、
 * 名前の列と金額の列を見出しと中身から当てる。当て方が違えば、画面で列を選び直せる。
 */
import { matchName, type Candidate } from "~/server/names";
import { isBlankRow, isTotalRow, normalizeHeader, parseCsv, parseNumberCell } from "~/server/tabular";

const NAME_WORDS = ["氏名", "名前", "お名前", "ドライバー名", "ドライバー", "委託者名", "委託者", "委託先", "乗務員名", "乗務員", "支払先", "受取人", "name"];
/** 金額の列の見出し（先のものほど「振込額」らしい） */
const AMOUNT_WORDS = ["振込額", "振込金額", "お振込額", "差引支給額", "差引支払額", "差引振込額", "振込", "支払額", "お支払額", "支払金額", "支給額", "差引", "合計", "金額"];

export type AmountRow = {
  /** 元の表の行番号（1 始まり） */
  rowNo: number;
  rawName: string;
  rawAmount: string;
  amount: number | null;
  driverId: string | null;
  driverName: string | null;
  /** 読めなかった・当たらなかった理由（使わない行） */
  problem: string | null;
};

export type AmountTable = {
  /** 見出しの行（1 始まり。無ければ null） */
  headerRow: number | null;
  columns: { index: number; header: string }[];
  nameCol: number;
  amountCol: number;
  rows: AmountRow[];
  matched: number;
  unmatched: number;
  problem: string | null;
};

function wordScore(header: string, words: string[]): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  for (let i = 0; i < words.length; i++) {
    const w = normalizeHeader(words[i]);
    if (h === w) return 1000 - i;
    if (h.includes(w)) return 500 - i;
  }
  return 0;
}

/** 貼り付けた文字を表にする（タブがあればタブ区切り） */
export function rowsFromText(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  return parseCsv(t, t.includes("\t") ? "\t" : ",");
}

/**
 * 見出し行：上から 15 行のうち、名前らしい見出しと金額らしい見出しの両方がある最初の行。
 * 無ければ、名前らしい見出しがある最初の行（「ドライバー支払一覧」のような題の行を見出しと取り違えないため）。
 */
function findHeader(rows: string[][]): number | null {
  const limit = Math.min(rows.length, 15);
  let fallback: number | null = null;
  for (let i = 0; i < limit; i++) {
    const hasName = rows[i].some((c) => wordScore(c, NAME_WORDS) > 0);
    if (!hasName) continue;
    if (rows[i].some((c) => wordScore(c, NAME_WORDS) === 0 && wordScore(c, AMOUNT_WORDS) > 0)) return i;
    fallback ??= i;
  }
  return fallback;
}

export function readAmountTable(rows: string[][], drivers: Candidate[], opts: { nameCol?: number | null; amountCol?: number | null } = {}): AmountTable {
  const headerIndex = findHeader(rows);
  const body = rows
    .map((cells, i) => ({ rowNo: i + 1, cells }))
    .filter((r, i) => (headerIndex === null || i > headerIndex) && !isBlankRow(r.cells) && !isTotalRow(r.cells));
  const width = Math.max(0, ...rows.map((r) => r.length));
  const header = headerIndex === null ? [] : rows[headerIndex];
  const columns = Array.from({ length: width }, (_, index) => ({ index, header: header[index] ?? "" }));
  const empty: AmountTable = { headerRow: headerIndex === null ? null : headerIndex + 1, columns, nameCol: 0, amountCol: 1, rows: [], matched: 0, unmatched: 0, problem: null };
  if (width < 2) return { ...empty, problem: "「名前」と「金額」の 2 列が必要です。Excel で 2 列を選んでコピーしてください" };
  if (body.length === 0) return { ...empty, problem: "読み込める行がありません" };

  // 名前の列：選ばれた列 → 見出し → いちばん多くドライバーに当たる列
  let nameCol = opts.nameCol ?? -1;
  if (nameCol < 0 || nameCol >= width) {
    const byHeader = columns.map((c) => wordScore(c.header, NAME_WORDS));
    const best = Math.max(...byHeader);
    if (best > 0) nameCol = byHeader.indexOf(best);
    else {
      const hits = columns.map((c) => body.filter((r) => r.cells[c.index] && parseNumberCell(r.cells[c.index]) === null && matchName(r.cells[c.index], drivers)).length);
      const top = Math.max(...hits);
      nameCol = top > 0 ? hits.indexOf(top) : 0;
    }
  }

  // 金額の列：選ばれた列 → 見出し（振込額らしい順）→ 数が 6 割以上入っている列のうち、いちばん右
  let amountCol = opts.amountCol ?? -1;
  if (amountCol < 0 || amountCol >= width || amountCol === nameCol) {
    const byHeader = columns.map((c) => (c.index === nameCol ? 0 : wordScore(c.header, AMOUNT_WORDS)));
    const best = Math.max(...byHeader);
    if (best > 0) amountCol = byHeader.indexOf(best);
    else {
      const numeric = columns
        .filter((c) => c.index !== nameCol)
        .filter((c) => body.filter((r) => parseNumberCell(r.cells[c.index] ?? "") !== null).length >= Math.max(1, body.length * 0.6));
      amountCol = numeric.length ? numeric[numeric.length - 1].index : nameCol === 0 ? 1 : 0;
    }
  }

  const seen = new Set<string>();
  const out: AmountRow[] = [];
  for (const r of body) {
    const rawName = (r.cells[nameCol] ?? "").trim();
    const rawAmount = (r.cells[amountCol] ?? "").trim();
    if (!rawName && !rawAmount) continue;
    const n = parseNumberCell(rawAmount);
    let problem: string | null = null;
    let driverId: string | null = null;
    let driverName: string | null = null;
    if (!rawName) problem = "名前がありません";
    else {
      const hit = matchName(rawName, drivers);
      if (!hit) problem = "この名前のドライバーが見つかりません（設定のドライバーで名前か別名を確かめてください）";
      else {
        driverId = hit.id;
        driverName = hit.name;
      }
    }
    if (!problem && n === null) problem = `金額「${rawAmount}」が数として読めません`;
    if (!problem && driverId && seen.has(driverId)) problem = `${driverName}さんがもう 1 行あります（上の行を使います）`;
    if (!problem && driverId) seen.add(driverId);
    out.push({ rowNo: r.rowNo, rawName, rawAmount, amount: n === null ? null : Math.round(n), driverId: problem ? null : driverId, driverName, problem });
  }
  const matched = out.filter((r) => !r.problem).length;
  return {
    ...empty,
    nameCol,
    amountCol,
    rows: out,
    matched,
    unmatched: out.length - matched,
    problem: matched === 0 && out.length > 0 ? "名前がどれも当たりませんでした。名前の列と金額の列を選び直してください" : null,
  };
}
