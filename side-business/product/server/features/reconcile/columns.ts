/**
 * 元請の支払通知（CSV・Excel）の列を当てて、行を読む。純関数（DB に触らない）。
 * - 列の見出し：品目/内容/案件/コース/業務 → 品目、数量/個数/件数/日数/時間 → 数量、単価、金額/支払額/小計 → 金額、
 *   ドライバー/担当/氏名 → ドライバー（無くてよい）、日付 → 日付（無くてよい）
 * - 合計・小計の行は読み飛ばし、ファイルの合計として覚える（行の合計と比べる）
 * - 消費税・振込手数料の行は突合に使わない（手数料は「差し引かれた手数料」の候補にする）
 * - 金額が無い行は 数量 × 単価（端数は会社の設定）
 */
import { roundYen } from "@/lib/payroll/money";
import type { Rounding } from "@/lib/payroll/types";
import { isBlankRow, isTotalRow, normalizeHeader, parseDateCell, parseNumberCell } from "~/server/tabular";
import { COLUMN_ROLES, EMPTY_COLUMNS, type ColumnMap, type ColumnRole } from "./roles";

export { COLUMN_ROLES, EMPTY_COLUMNS, ROLE_LABEL, type ColumnMap, type ColumnRole } from "./roles";

/** 見出しの言葉（上ほど優先） */
const PATTERNS: Record<ColumnRole, RegExp[]> = {
  unitPrice: [/^(税抜)?単価$/, /単価/],
  date: [/^日付$/, /日付/, /年月日/, /(稼働|配達|作業|運行|納品|集荷|配送)日$/],
  qty: [/^数量$/, /数量/, /個数/, /件数/, /日数/, /回数/, /便数/, /台数/, /本数/, /時間数?$/],
  amount: [/^(税抜)?金額$/, /税抜.*金額|金額.*税抜/, /^お?支払(金)?額$/, /金額/, /支払(金)?額/, /小計/, /請求額|売上額/],
  driver: [/ドライバー/, /乗務員/, /運転者/, /配達員/, /担当者?名?$/, /氏名/, /名前/, /作業者/],
  item: [/^品目$/, /品目/, /品名/, /内容/, /案件/, /コース/, /業務/, /項目/, /摘要/, /作業/, /サービス/, /区分/],
};

/** 列の中身の確かめ（数の列に文字ばかり入っていたら当てない） */
function numericShare(values: string[]): number {
  const filled = values.filter((v) => v.trim() !== "");
  if (filled.length === 0) return 0;
  return filled.filter((v) => parseNumberCell(v) !== null).length / filled.length;
}

function textShare(values: string[]): number {
  const filled = values.filter((v) => v.trim() !== "");
  if (filled.length === 0) return 0;
  return filled.filter((v) => parseNumberCell(v) === null && parseDateCell(v) === null).length / filled.length;
}

function columnValues(rows: string[][], headerIndex: number, col: number): string[] {
  return rows
    .slice(headerIndex + 1, headerIndex + 60)
    .filter((r) => !isBlankRow(r) && !isTotalRow(r))
    .map((r) => r[col] ?? "");
}

/**
 * 見出しから列を当てる。saved（前に覚えた対応：役割 → 正規化した見出し）があれば、それを先に使う。
 * 当てた順：単価 → 日付 → 数量 → 金額 → ドライバー → 品目（はっきりした言葉から）
 */
export function detectColumns(rows: string[][], headerIndex: number, saved?: Partial<Record<ColumnRole, string>> | null): { columns: ColumnMap; fromSaved: boolean; notes: string[] } {
  const header = (rows[headerIndex] ?? []).map((h) => normalizeHeader(h ?? ""));
  const notes: string[] = [];
  const used = new Set<number>();
  const columns: ColumnMap = { ...EMPTY_COLUMNS };

  if (saved && saved.item) {
    let ok = true;
    for (const role of COLUMN_ROLES) {
      const want = saved[role];
      if (!want) continue;
      const idx = header.findIndex((h, i) => h === want && !used.has(i));
      if (idx < 0) {
        if (role === "item") ok = false;
        continue;
      }
      columns[role] = idx;
      used.add(idx);
    }
    if (ok && (columns.amount !== null || (columns.qty !== null && columns.unitPrice !== null))) {
      return { columns, fromSaved: true, notes };
    }
    // 覚えた対応が合わなければ、見出しから当て直す
    used.clear();
    Object.assign(columns, EMPTY_COLUMNS);
  }

  const order: ColumnRole[] = ["unitPrice", "date", "qty", "amount", "driver", "item"];
  for (const role of order) {
    let picked: number | null = null;
    for (const re of PATTERNS[role]) {
      const candidates = header
        .map((h, i) => ({ h, i }))
        .filter(({ h, i }) => h && !used.has(i) && re.test(h))
        // 税込・消費税の列は金額として後回し（当社の単価は税抜なので）
        .sort((a, b) => (role === "amount" ? taxPenalty(a.h) - taxPenalty(b.h) : 0) || a.i - b.i);
      for (const { h, i } of candidates) {
        if (role === "amount" && /^(うち)?消費税(額|等)?$/.test(h)) continue;
        const values = columnValues(rows, headerIndex, i);
        if ((role === "qty" || role === "unitPrice" || role === "amount") && numericShare(values) < 0.5) continue;
        if ((role === "item" || role === "driver") && textShare(values) < 0.5) continue;
        picked = i;
        break;
      }
      if (picked !== null) break;
    }
    if (picked !== null) {
      columns[role] = picked;
      used.add(picked);
    }
  }

  // 金額が税込だけで、数量と単価があるなら、金額は 数量 × 単価（税抜）で出す
  if (columns.amount !== null && /税込/.test(header[columns.amount]) && columns.qty !== null && columns.unitPrice !== null) {
    notes.push(`「${rows[headerIndex][columns.amount]}」は税込のようなので使わず、数量 × 単価（税抜）で金額を出しました。`);
    used.delete(columns.amount);
    columns.amount = null;
  } else if (columns.amount !== null && /税込/.test(header[columns.amount])) {
    notes.push(`金額の列「${rows[headerIndex][columns.amount]}」は税込のようです。当社の単価は税抜なので、差が大きく出るときは税抜の列を選んでください。`);
  }

  // 品目の見出しが見つからないときは、文字の入った最初の列を品目にする
  if (columns.item === null) {
    for (let i = 0; i < header.length; i++) {
      if (used.has(i)) continue;
      const values = columnValues(rows, headerIndex, i);
      if (values.some((v) => v.trim()) && textShare(values) >= 0.8) {
        columns.item = i;
        used.add(i);
        notes.push(`品目の列が見出しから分からなかったので「${rows[headerIndex][i] || `${i + 1}列目`}」を品目にしました。違うときは列を選び直してください。`);
        break;
      }
    }
  }
  return { columns, fromSaved: false, notes };
}

function taxPenalty(h: string): number {
  if (/税抜/.test(h)) return -1;
  if (/税込|消費税/.test(h)) return 1;
  return 0;
}

/** 列の対応を「役割 → 正規化した見出し」にする（覚えておく形） */
export function columnsToMapping(header: string[], columns: ColumnMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of COLUMN_ROLES) {
    const idx = columns[role];
    if (idx !== null && header[idx] !== undefined) out[role] = normalizeHeader(header[idx]);
  }
  return out;
}

/** 突合に使える列がそろっているか。足りなければ、何が足りないかを日本語で */
export function columnsProblem(columns: ColumnMap): string | null {
  if (columns.item === null) return "品目（案件・内容）の列が分かりません。どの列が品目かを選んでください。";
  if (columns.amount === null && (columns.qty === null || columns.unitPrice === null)) {
    return "金額の列が分かりません。金額の列（無ければ数量と単価の両方）を選んでください。";
  }
  return null;
}

// ---------------------------------------------------------------- 行を読む

export type ParsedLine = {
  rowNo: number;
  rawProject: string;
  rawDriver: string | null;
  qty: number | null;
  unitPrice: number | null;
  amount: number;
  date: string | null;
};

export type SkippedRow = { rowNo: number; reason: string; text: string };

export type ParsedNotice = {
  lines: ParsedLine[];
  skipped: SkippedRow[];
  /** ファイルの合計行の金額（あれば） */
  fileTotal: number | null;
  /** 消費税の行の合計（突合に使わない） */
  taxTotal: number;
  /** 振込手数料の行の合計（正の数。入金のときに差し引かれた手数料の候補） */
  feeTotal: number;
  /** 行の合計 */
  total: number;
  /** 日付の列があれば、いちばん早い日・遅い日と、その月の外の行数 */
  dates: { from: string; to: string; outside: number } | null;
  warnings: string[];
};

const TAX_ROW = /^(うち|内)?消費税(等|額|等額)?(\d+%|\(\d+%\))?(対象)?$|^消費税/;
const FEE_ROW = /振込手数料|送金手数料|振替手数料/;
const TOTAL_ROW = /^(総?合計|小計|計|合計額|合計金額|お?支払合計|お?支払総?額合計|差引.*額|税込合計|税抜合計)$/;

/**
 * 見出し行より下を読む。month は YYYY-MM-01（日付の年を補う・月の外の行を数える）
 */
export function parseNoticeRows(rows: string[][], headerIndex: number, columns: ColumnMap, opts: { rounding: Rounding; month: string }): ParsedNotice {
  const lines: ParsedLine[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: string[] = [];
  let fileTotal: number | null = null;
  let taxTotal = 0;
  let feeTotal = 0;
  const year = Number(opts.month.slice(0, 4));
  const ym = opts.month.slice(0, 7);
  const dates: string[] = [];
  let outside = 0;
  const cell = (r: string[], idx: number | null) => (idx === null ? "" : (r[idx] ?? "").trim());

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (isBlankRow(r)) continue;
    const rowNo = i + 1;
    const item = cell(r, columns.item);
    const itemKey = item.normalize("NFKC").replace(/[\s　]/g, "");
    const qty = parseNumberCell(cell(r, columns.qty));
    const unitPrice = parseNumberCell(cell(r, columns.unitPrice));
    const amountCell = parseNumberCell(cell(r, columns.amount));
    const text = r.filter(Boolean).join(" ").slice(0, 80);

    // 合計・小計の行：取り込まず、ファイルの合計として覚える（小計より合計を優先）
    if (isTotalRow(r) || TOTAL_ROW.test(itemKey)) {
      const v = amountCell ?? lastNumber(r);
      if (v !== null && (fileTotal === null || !/小計/.test(itemKey))) fileTotal = roundYen(v, "round");
      skipped.push({ rowNo, reason: "合計の行", text });
      continue;
    }
    if (!item) {
      if (r.some((c) => parseNumberCell(c) !== null)) skipped.push({ rowNo, reason: "品目が空の行", text });
      continue;
    }
    let amount: number | null = amountCell === null ? null : roundYen(amountCell, opts.rounding);
    if (amount === null && qty !== null && unitPrice !== null) amount = roundYen(qty * unitPrice, opts.rounding);

    if (TAX_ROW.test(itemKey)) {
      taxTotal += amount ?? 0;
      skipped.push({ rowNo, reason: "消費税の行（単価・金額は税抜で比べます）", text });
      continue;
    }
    if (FEE_ROW.test(itemKey)) {
      feeTotal += Math.abs(amount ?? 0);
      skipped.push({ rowNo, reason: "振込手数料の行（「差し引かれた手数料」として扱います）", text });
      continue;
    }
    if (amount === null) {
      skipped.push({ rowNo, reason: "金額も単価も読めない行", text });
      continue;
    }
    let date: string | null = null;
    if (columns.date !== null) {
      date = parseDateCell(cell(r, columns.date), year);
      if (date) {
        dates.push(date);
        if (date.slice(0, 7) !== ym) outside++;
      }
    }
    const driver = cell(r, columns.driver);
    lines.push({ rowNo, rawProject: item, rawDriver: driver || null, qty, unitPrice, amount, date });
  }

  const total = lines.reduce((a, l) => a + l.amount, 0);
  if (fileTotal !== null && fileTotal !== total && fileTotal !== total + taxTotal && fileTotal !== total + taxTotal - feeTotal && fileTotal !== total - feeTotal) {
    warnings.push(`ファイルの合計（${fileTotal.toLocaleString("ja-JP")}円）と、読み取った行の合計（${total.toLocaleString("ja-JP")}円）が合いません。読み飛ばした行や、列の選び方を確かめてください。`);
  }
  if (outside > 0) warnings.push(`${ym.replace("-", "年")}月の外の日付の行が ${outside} 行あります。別の月の分が入っていないか確かめてください。`);
  const sortedDates = [...dates].sort();
  return {
    lines,
    skipped,
    fileTotal,
    taxTotal,
    feeTotal,
    total,
    dates: sortedDates.length ? { from: sortedDates[0], to: sortedDates[sortedDates.length - 1], outside } : null,
    warnings,
  };
}

function lastNumber(r: string[]): number | null {
  for (let i = r.length - 1; i >= 0; i--) {
    const v = parseNumberCell(r[i] ?? "");
    if (v !== null) return v;
  }
  return null;
}
