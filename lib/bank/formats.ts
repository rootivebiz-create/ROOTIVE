/**
 * 銀行の入出金明細 CSV の書式判定（純関数。DB・ネットワークに触らない）
 *
 * 日本のネット銀行の CSV は書式がまちまちなので、ヘッダーの語からそれぞれの列を推測する。
 *  - 2 列型：日付, お取引内容, お預入金額, お支払金額, 残高（入金・出金が別の列）
 *  - 1 列型：取引日, 摘要, 金額, 残高（出金がマイナス）
 *  - ヘッダー無し：日付らしい列・数値らしい列の並びから推測する
 *
 * 金額は「入金 ＋ / 出金 −」に揃える（bank_transactions.amount と同じ向き）。
 */

/** 解析できた明細 1 行 */
export interface ParsedTxn {
  /** 取引日 "YYYY-MM-DD" */
  txnDate: string;
  /** 摘要（正規化済み） */
  description: string;
  /** 入金は ＋、出金は − */
  amount: number;
  /** 残高（無ければ null） */
  balance: number | null;
  /** 元の行（CSV のセルをカンマでつないだもの。原本の確認用） */
  raw: string;
}

/** 列の種類 */
export type BankColumnKind = "date" | "description" | "deposit" | "withdrawal" | "amount" | "balance";

/** 判定した列の位置（列が無ければ null） */
export interface BankColumns {
  date: number;
  description: number | null;
  /** 入金の列（2 列型） */
  deposit: number | null;
  /** 出金の列（2 列型） */
  withdrawal: number | null;
  /** 金額の列（1 列型。符号付き） */
  amount: number | null;
  balance: number | null;
  /** ヘッダー行の位置（空行を除いた 0 始まりの位置）。ヘッダー無しなら null */
  headerRow: number | null;
  /** 判定した書式名（画面・取り込み履歴に出す） */
  format: string;
}

/** 書式を判定できなかったときの書式名 */
export const UNKNOWN_FORMAT = "不明";

// ---------------------------------------------------------------------------
// ヘッダーの語
// ---------------------------------------------------------------------------

/** 完全一致で判定する語（部分一致だと取り違えるもの。例：入出金金額 は 1 列型） */
const EXACT_HEADERS: [BankColumnKind, string[]][] = [
  ["amount", ["金額", "お取引金額", "取引金額", "入出金金額", "入出金額", "取引金額(円)", "金額(円)", "入出金"]],
  ["date", ["日付", "年月日", "取扱日", "お取引日", "取引日", "取引日付", "日付(起算日)", "勘定日"]],
  ["description", ["摘要", "内容", "備考", "明細", "お取引内容", "取引内容", "入出金先内容", "取引先", "お取引明細"]],
  ["balance", ["残高", "差引残高", "現在残高", "取引後残高", "残高(円)"]],
  ["deposit", ["お預入金額", "預入金額", "入金金額", "入金額", "入金", "お預り金額", "預入", "お預入れ額", "入金(円)"]],
  ["withdrawal", ["お支払金額", "支払金額", "出金金額", "出金額", "出金", "お引出金額", "引出金額", "引出", "払戻金額", "支払", "出金(円)"]],
];

/** 部分一致で判定する語（上から順に試す） */
const CONTAINS_HEADERS: [BankColumnKind, string[]][] = [
  ["date", ["取引日", "お取引日", "取扱日", "年月日", "日付", "勘定日"]],
  ["description", ["摘要", "内容", "備考", "取引先", "明細"]],
  ["balance", ["残高"]],
  ["deposit", ["預入", "預り", "入金"]],
  ["withdrawal", ["支払", "出金", "引出", "払戻"]],
  ["amount", ["金額"]],
];

/** ヘッダーの比較用に正規化する（全角→半角、空白・記号を落とす） */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\s"']/g, "")
    .trim();
}

/** ヘッダー 1 つの列の種類を判定する（判定できなければ null） */
export function classifyHeader(raw: string): BankColumnKind | null {
  const h = normalizeHeader(raw);
  if (h === "") return null;
  for (const [kind, words] of EXACT_HEADERS) {
    if (words.some((w) => normalizeHeader(w) === h)) return kind;
  }
  for (const [kind, words] of CONTAINS_HEADERS) {
    if (words.some((w) => h.includes(w))) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** 和暦の元号 → 西暦の基準年（元年 = 基準年 ＋ 1） */
const ERA_BASE: Record<string, number> = { R: 2018, H: 1988, S: 1925, T: 1911, M: 1867 };
const ERA_KANJI: Record<string, string> = { 令: "R", 平: "H", 昭: "S", 大: "T", 明: "M" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 実在する日付なら "YYYY-MM-DD"、しなければ null */
function toIsoDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const YMD_RE = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/;
const YMD8_RE = /^(\d{4})(\d{2})(\d{2})$/;
const YY_RE = /^(\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})$/;
const ERA_RE = /^([RHSTMrhstm令平昭大明])(?:和|成)?\.?(\d{1,2})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/;

/**
 * 日付セルを "YYYY-MM-DD" へ。読めなければ null
 * 受け付ける形：2026/9/18・2026-09-18・2026.9.18・2026年9月18日・20260918・26/9/18・R8.9.18・令和8年9月18日
 */
export function parseBankDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/\([月火水木金土日]\)$/, "")
    .trim();
  if (s === "") return null;

  const era = ERA_RE.exec(s);
  if (era) {
    const letter = (ERA_KANJI[era[1]] ?? era[1]).toUpperCase();
    const base = ERA_BASE[letter];
    if (base == null) return null;
    return toIsoDate(base + Number(era[2]), Number(era[3]), Number(era[4]));
  }
  const ymd = YMD_RE.exec(s);
  if (ymd) return toIsoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const ymd8 = YMD8_RE.exec(s);
  if (ymd8) return toIsoDate(Number(ymd8[1]), Number(ymd8[2]), Number(ymd8[3]));
  const yy = YY_RE.exec(s);
  if (yy) return toIsoDate(2000 + Number(yy[1]), Number(yy[2]), Number(yy[3]));
  return null;
}

// ---------------------------------------------------------------------------
// 金額
// ---------------------------------------------------------------------------

/**
 * 金額セルを数値へ。空欄・読めない値は null
 * カンマ・全角数字・¥・円・△▲（マイナス）・括弧（マイナス）・後置マイナスに対応する。
 */
export function parseBankAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw.normalize("NFKC").trim();
  if (s === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/[△▲▼]/g, "-")
    .replace(/[−－‐‑–—―ー]/g, "-")
    .replace(/[¥￥円,、\s]/g, "");
  if (s === "" || s === "-") return null;
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    sign = -sign;
    s = s.slice(0, -1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

// ---------------------------------------------------------------------------
// 列の判定
// ---------------------------------------------------------------------------

function headerLabel(row: string[], index: number | null): string {
  if (index == null) return "";
  return normalizeHeader(row[index] ?? "");
}

/** 判定した列から書式名を組み立てる */
export function formatNameOf(columns: Omit<BankColumns, "format">, headerRow: string[] | null): string {
  if (!headerRow) {
    if (columns.deposit != null && columns.withdrawal != null) return "ヘッダー無し・2列型";
    return "ヘッダー無し・1列型";
  }
  if (columns.deposit != null && columns.withdrawal != null) {
    return `2列型（${headerLabel(headerRow, columns.deposit)}／${headerLabel(headerRow, columns.withdrawal)}）`;
  }
  if (columns.amount != null) return `1列型（${headerLabel(headerRow, columns.amount)}）`;
  if (columns.deposit != null) return `1列型（${headerLabel(headerRow, columns.deposit)}・入金）`;
  if (columns.withdrawal != null) return `1列型（${headerLabel(headerRow, columns.withdrawal)}・出金）`;
  return UNKNOWN_FORMAT;
}

/** ヘッダー行から列を判定する（見つからなければ null） */
export function detectFromHeader(rows: string[][], limit = 20): BankColumns | null {
  const end = Math.min(rows.length, limit);
  for (let i = 0; i < end; i += 1) {
    const row = rows[i] ?? [];
    if (row.length < 2) continue;
    const found: Partial<Record<BankColumnKind, number>> = {};
    row.forEach((cell, index) => {
      const kind = classifyHeader(cell);
      if (kind && found[kind] == null) found[kind] = index;
    });
    const hasAmount = found.deposit != null || found.withdrawal != null || found.amount != null;
    if (found.date == null || !hasAmount) continue;
    const base: Omit<BankColumns, "format"> = {
      date: found.date,
      description: found.description ?? null,
      deposit: found.deposit ?? null,
      withdrawal: found.withdrawal ?? null,
      amount: found.amount ?? null,
      balance: found.balance ?? null,
      headerRow: i,
    };
    // 2 列型なら金額列は使わない（「入出金金額」などの取り違えを避ける）
    if (base.deposit != null && base.withdrawal != null) base.amount = null;
    return { ...base, format: formatNameOf(base, row) };
  }
  return null;
}

/** 1 列分の統計（ヘッダー無しの推測に使う） */
interface ColumnStat {
  nonEmpty: number;
  dates: number;
  numbers: number;
}

function statsOf(rows: string[][], width: number): ColumnStat[] {
  const stats: ColumnStat[] = Array.from({ length: width }, () => ({ nonEmpty: 0, dates: 0, numbers: 0 }));
  for (const row of rows) {
    for (let c = 0; c < width; c += 1) {
      const cell = (row[c] ?? "").trim();
      if (cell === "") continue;
      const stat = stats[c];
      stat.nonEmpty += 1;
      if (parseBankDate(cell) != null) stat.dates += 1;
      else if (parseBankAmount(cell) != null) stat.numbers += 1;
    }
  }
  return stats;
}

/**
 * ヘッダー無しの CSV から列を推測する。
 * 日付の列 → 数値の列（多い順に 入金・出金・残高／金額・残高）→ 残りの文字列の列を摘要とみなす。
 */
export function detectWithoutHeader(rows: string[][]): BankColumns | null {
  const data = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (data.length === 0) return null;
  const width = Math.max(...data.map((r) => r.length));
  if (width < 2) return null;
  const stats = statsOf(data, width);

  let date = -1;
  for (let c = 0; c < width; c += 1) {
    const s = stats[c];
    if (s.nonEmpty > 0 && s.dates / s.nonEmpty >= 0.8) {
      date = c;
      break;
    }
  }
  if (date < 0) return null;

  const numeric: number[] = [];
  for (let c = 0; c < width; c += 1) {
    if (c === date) continue;
    const s = stats[c];
    if (s.nonEmpty > 0 && s.numbers / s.nonEmpty >= 0.8) numeric.push(c);
  }
  if (numeric.length === 0) return null;

  let description: number | null = null;
  for (let c = 0; c < width; c += 1) {
    if (c === date || numeric.includes(c)) continue;
    const s = stats[c];
    if (s.nonEmpty > 0) {
      description = c;
      break;
    }
  }

  const base: Omit<BankColumns, "format"> =
    numeric.length >= 3
      ? { date, description, deposit: numeric[0], withdrawal: numeric[1], amount: null, balance: numeric[numeric.length - 1], headerRow: null }
      : numeric.length === 2
        ? { date, description, deposit: null, withdrawal: null, amount: numeric[0], balance: numeric[1], headerRow: null }
        : { date, description, deposit: null, withdrawal: null, amount: numeric[0], balance: null, headerRow: null };

  return { ...base, format: formatNameOf(base, null) };
}

/** ヘッダー行を探し、無ければ中身から推測する */
export function detectColumns(rows: string[][], headerSearchLimit = 20): BankColumns | null {
  return detectFromHeader(rows, headerSearchLimit) ?? detectWithoutHeader(rows);
}

/** 判定した列から 1 行分の金額を求める（入金 ＋ / 出金 −）。読めなければ null */
export function amountOfRow(row: string[], columns: BankColumns): number | null {
  if (columns.deposit != null && columns.withdrawal != null) {
    const inAmount = parseBankAmount(row[columns.deposit]);
    const outAmount = parseBankAmount(row[columns.withdrawal]);
    if (inAmount == null && outAmount == null) return null;
    return (inAmount ?? 0) - Math.abs(outAmount ?? 0);
  }
  if (columns.amount != null) return parseBankAmount(row[columns.amount]);
  if (columns.deposit != null) {
    const v = parseBankAmount(row[columns.deposit]);
    return v == null ? null : Math.abs(v);
  }
  if (columns.withdrawal != null) {
    const v = parseBankAmount(row[columns.withdrawal]);
    return v == null ? null : -Math.abs(v);
  }
  return null;
}
