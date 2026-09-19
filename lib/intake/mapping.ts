/**
 * 元請の実績ファイルの「列の対応」と「名前の対応」（純関数）。
 *
 * - guessMapping : 日本語のヘッダーから 日付・ドライバー・案件・内容・数量 の列を推測する
 * - applyMapping : ヘッダー行より下を { date, driverName, projectName, itemName, qty } に直す
 * - matchNames   : 元請の表記を自社のドライバー・案件内容（uuid）に突き合わせる
 *
 * 突き合わせは nameKey（全角／半角・空白・カナの正規化）で行い、
 * 保存済みの対応（driver_match / item_match）を最優先にする。
 */
import { parseNumberInput } from "@/lib/calc/parse";
import { itemLabelOf, nameKey, normalizeName, parseReceiptDate } from "./helpers";

// ---------------------------------------------------------------------------
// 列の対応
// ---------------------------------------------------------------------------

export const MAPPING_FIELDS = ["date", "driver", "project", "item", "qty"] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];

/** 列の対応（値は元請ファイルのヘッダー名。"" は未対応） */
export type SheetMapping = Record<MappingField, string>;

export const EMPTY_MAPPING: SheetMapping = { date: "", driver: "", project: "", item: "", qty: "" };

export const MAPPING_LABELS: Record<MappingField, string> = {
  date: "日付",
  driver: "ドライバー",
  project: "案件",
  item: "案件内容",
  qty: "数量",
};

/** 取り込みに最低限必要な列 */
export const REQUIRED_MAPPING_FIELDS: MappingField[] = ["date", "driver", "qty"];

/**
 * ヘッダー名の候補（前にあるものほど強く一致とみなす）。
 * 1 文字の語は誤爆する（「日」が「曜日」に当たる）ので入れない。
 */
export const HEADER_PATTERNS: Record<MappingField, string[]> = {
  date: ["日付", "配送日", "稼働日", "稼動日", "業務日", "作業日", "配達日", "年月日", "取扱日", "実施日", "日にち", "date"],
  driver: ["ドライバー", "配送員", "担当者", "氏名", "配達員", "乗務員", "ドライバー名", "担当", "名前", "スタッフ", "外注先", "driver", "name"],
  project: ["案件", "コース", "エリア", "ルート", "現場", "拠点", "営業所", "センター", "course", "area"],
  item: ["区分", "種別", "作業内容", "業務区分", "内容", "品目", "商品", "配送区分", "item", "type"],
  qty: ["個数", "件数", "数量", "配達数", "配達件数", "稼働数", "個口数", "個口", "台数", "数", "qty", "count"],
};

/** ヘッダー 1 つとある項目の一致度（0 は不一致） */
export function headerScore(header: string, field: MappingField): number {
  const key = nameKey(header);
  if (!key) return 0;
  let best = 0;
  HEADER_PATTERNS[field].forEach((pattern, index) => {
    const pk = nameKey(pattern);
    if (!pk) return;
    const bonus = Math.max(0, 12 - index);
    if (key === pk) best = Math.max(best, 100 + bonus);
    else if (pk.length >= 2 && (key.startsWith(pk) || key.endsWith(pk))) best = Math.max(best, 70 + bonus);
    else if (pk.length >= 2 && key.includes(pk)) best = Math.max(best, 50 + bonus);
  });
  return best;
}

/**
 * ヘッダーから列の対応を推測する。
 * 一致度の高い組み合わせから順に決め、同じ列を 2 つの項目には割り当てない。
 */
export function guessMapping(headers: string[]): SheetMapping {
  const candidates: { field: MappingField; header: string; index: number; score: number }[] = [];
  headers.forEach((header, index) => {
    const name = normalizeName(header);
    if (!name) return;
    for (const field of MAPPING_FIELDS) {
      const score = headerScore(name, field);
      if (score > 0) candidates.push({ field, header: name, index, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);

  const mapping: SheetMapping = { ...EMPTY_MAPPING };
  const usedFields = new Set<MappingField>();
  const usedIndexes = new Set<number>();
  for (const c of candidates) {
    if (usedFields.has(c.field) || usedIndexes.has(c.index)) continue;
    mapping[c.field] = c.header;
    usedFields.add(c.field);
    usedIndexes.add(c.index);
  }
  return mapping;
}

/** 対応が付いていない必須の列（画面の案内に使う） */
export function missingMappingFields(mapping: SheetMapping): MappingField[] {
  return REQUIRED_MAPPING_FIELDS.filter((f) => !mapping[f]);
}

/** 未知の値も SheetMapping の形へ（DB の jsonb から読むときに使う） */
export function normalizeMapping(value: unknown): SheetMapping {
  const mapping: SheetMapping = { ...EMPTY_MAPPING };
  if (!value || typeof value !== "object" || Array.isArray(value)) return mapping;
  const o = value as Record<string, unknown>;
  for (const field of MAPPING_FIELDS) {
    const v = o[field];
    if (typeof v === "string") mapping[field] = normalizeName(v).slice(0, 100);
  }
  return mapping;
}

/** 元請の表記 → uuid の対応表（jsonb から読むときに使う） */
export function normalizeMatchMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeName(k);
    if (key && typeof v === "string" && v) out[key] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 行の取り出し
// ---------------------------------------------------------------------------

/** マッピングを当てはめた 1 行 */
export interface ParsedRow {
  /** ファイル内の行番号（1 始まり。画面の案内に使う） */
  line: number;
  /** 稼働日 "YYYY-MM-DD"（読めなければ ""） */
  date: string;
  driverName: string;
  projectName: string;
  itemName: string;
  /** 数量（読めなければ 0） */
  qty: number;
}

function cellAt(cells: string[], index: number): string {
  return index < 0 ? "" : normalizeName(cells[index] ?? "");
}

/** ヘッダー名から列番号を引く（正規化して比較。無ければ -1） */
export function columnIndex(headers: string[], name: string): number {
  const key = nameKey(name);
  if (!key) return -1;
  const exact = headers.findIndex((h) => nameKey(h) === key);
  if (exact >= 0) return exact;
  return headers.findIndex((h) => {
    const hk = nameKey(h);
    return hk.length >= 2 && (hk.includes(key) || key.includes(hk));
  });
}

/**
 * ヘッダー行より下の行にマッピングを当てはめる。
 * 日付は "YYYY-MM-DD" へ、数量は数値へ直す（読めない行も date="" / qty=0 のまま返し、画面で赤く出す）。
 * baseMonth（"YYYY-MM"）を渡すと "9/18" のような年の無い日付も解釈できる。
 */
export function applyMapping(rows: string[][], mapping: SheetMapping, headerRow: number, baseMonth?: string): ParsedRow[] {
  const headers = (rows[headerRow] ?? []).map((h) => normalizeName(h));
  const idx = {
    date: columnIndex(headers, mapping.date),
    driver: columnIndex(headers, mapping.driver),
    project: columnIndex(headers, mapping.project),
    item: columnIndex(headers, mapping.item),
    qty: columnIndex(headers, mapping.qty),
  };

  const out: ParsedRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const cells = rows[i] ?? [];
    if (cells.every((c) => (c ?? "").trim() === "")) continue;
    const date = parseReceiptDate(cellAt(cells, idx.date), baseMonth) ?? "";
    const driverName = cellAt(cells, idx.driver);
    const projectName = cellAt(cells, idx.project);
    const itemName = cellAt(cells, idx.item);
    const qtyRaw = cellAt(cells, idx.qty);
    const qty = parseNumberInput(qtyRaw) ?? 0;
    // 合計行（ドライバー名も日付も無い）は飛ばす
    if (date === "" && driverName === "" && qty === 0) continue;
    out.push({ line: i + 1, date, driverName, projectName, itemName, qty: Math.round(qty * 100) / 100 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 名前の突き合わせ
// ---------------------------------------------------------------------------

/** 突き合わせ先のドライバー */
export interface DriverChoice {
  id: string;
  name: string;
  is_active?: boolean;
}

/** 突き合わせ先の案件内容 */
export interface ItemChoice {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  is_active?: boolean;
}

/** 突き合わせた 1 行 */
export interface MatchedRow extends ParsedRow {
  /** 自社のドライバー（"" は未対応） */
  driverId: string;
  /** 自社の案件内容（"" は未対応） */
  itemId: string;
  /** 元請の表記（案件 / 内容）。対応を覚えるときのキー */
  itemLabel: string;
  /** 取り込める行か */
  ok: boolean;
  /** 取り込めない理由（日本語。ok のときは ""） */
  error: string;
}

export interface MatchResult {
  /** すべての行（プレビュー表に出す） */
  rows: MatchedRow[];
  /** 取り込める行だけ */
  matched: MatchedRow[];
  /** 対応が付かなかった名前（重複なし・出てきた順） */
  unmatched: { drivers: string[]; items: string[] };
}

/** 候補が 1 件に絞れれば返す。複数なら有効なものが 1 件のときだけ返す */
function pickOne<T extends { is_active?: boolean }>(list: T[]): T | null {
  if (list.length === 1) return list[0];
  if (list.length === 0) return null;
  const active = list.filter((x) => x.is_active !== false);
  return active.length === 1 ? active[0] : null;
}

/** 対応表（元請の表記 → uuid）をキーで引けるようにする */
function keyedMap(map: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(map ?? {})) {
    const key = nameKey(k);
    if (key && v) out.set(key, v);
  }
  return out;
}

/**
 * 元請の表記を自社のドライバー・案件内容に突き合わせる。
 * 1. 保存済みの対応（driver_match / item_match）
 * 2. 名前の正規化キーが一致（同名が複数あるときは有効なものが 1 件のときだけ）
 * 対応が付かない名前は unmatched に入れ、画面でその場で選んでもらう。
 */
export function matchNames(
  parsed: ParsedRow[],
  drivers: DriverChoice[],
  items: ItemChoice[],
  driverMatch: Record<string, string> = {},
  itemMatch: Record<string, string> = {},
): MatchResult {
  const savedDrivers = keyedMap(driverMatch);
  const savedItems = keyedMap(itemMatch);
  const driverIds = new Set(drivers.map((d) => d.id));
  const itemIds = new Set(items.map((i) => i.id));

  const unmatchedDrivers: string[] = [];
  const unmatchedItems: string[] = [];
  const seenDriver = new Set<string>();
  const seenItem = new Set<string>();

  const resolveDriver = (name: string): string => {
    const key = nameKey(name);
    if (!key) return "";
    const saved = savedDrivers.get(key);
    if (saved && driverIds.has(saved)) return saved;
    const hit = pickOne(drivers.filter((d) => nameKey(d.name) === key));
    return hit ? hit.id : "";
  };

  const resolveItem = (projectName: string, itemName: string): string => {
    const label = itemLabelOf(projectName, itemName);
    const labelKey = nameKey(label);
    const itemKey = nameKey(itemName);
    const projectKey = nameKey(projectName);

    for (const key of [labelKey, itemKey]) {
      if (!key) continue;
      const saved = savedItems.get(key);
      if (saved && itemIds.has(saved)) return saved;
    }

    const inProject = projectKey ? items.filter((i) => nameKey(i.project_name) === projectKey) : [];
    if (itemKey) {
      const hit = pickOne(inProject.filter((i) => nameKey(i.name) === itemKey)) ?? pickOne(items.filter((i) => nameKey(i.name) === itemKey));
      if (hit) return hit.id;
    } else if (inProject.length > 0) {
      // 内容の列が無いファイルは、その案件の内容が 1 つだけなら決められる
      const hit = pickOne(inProject);
      if (hit) return hit.id;
    }
    return "";
  };

  const rows: MatchedRow[] = parsed.map((row) => {
    const driverId = resolveDriver(row.driverName);
    const itemId = resolveItem(row.projectName, row.itemName);
    const itemLabel = itemLabelOf(row.projectName, row.itemName);

    if (row.driverName && !driverId && !seenDriver.has(nameKey(row.driverName))) {
      seenDriver.add(nameKey(row.driverName));
      unmatchedDrivers.push(row.driverName);
    }
    if (itemLabel && !itemId && !seenItem.has(nameKey(itemLabel))) {
      seenItem.add(nameKey(itemLabel));
      unmatchedItems.push(itemLabel);
    }

    const problems: string[] = [];
    if (!row.date) problems.push("日付を読み取れません");
    if (!row.driverName) problems.push("ドライバー名が空です");
    else if (!driverId) problems.push("ドライバーの対応が付いていません");
    if (!itemLabel) problems.push("案件内容が空です");
    else if (!itemId) problems.push("案件内容の対応が付いていません");
    if (!(row.qty > 0)) problems.push("数量が 0 です");

    return { ...row, driverId, itemId, itemLabel, ok: problems.length === 0, error: problems.join("・") };
  });

  return { rows, matched: rows.filter((r) => r.ok), unmatched: { drivers: unmatchedDrivers, items: unmatchedItems } };
}

/**
 * 選択中の稼動月（"YYYY-MM"）以外の行を取り込めない扱いにする。
 * 元請のファイルに前月・翌月の行が混ざっていても、別の月（締め済みかもしれない）へ書き込まないため。
 */
export function restrictToMonth(rows: MatchedRow[], month: string): MatchedRow[] {
  return rows.map((row) => {
    if (!row.date || row.date.slice(0, 7) === month) return row;
    const reason = `${month} 以外の日付です`;
    return { ...row, ok: false, error: row.error ? `${row.error}・${reason}` : reason };
  });
}

/** 取り込んだ行から「覚えるべき対応」を作る（元請の表記 → uuid） */
export function learnedMatches(rows: MatchedRow[]): { drivers: Record<string, string>; items: Record<string, string> } {
  const drivers: Record<string, string> = {};
  const items: Record<string, string> = {};
  for (const row of rows) {
    if (row.driverName && row.driverId) drivers[row.driverName] = row.driverId;
    if (row.itemLabel && row.itemId) items[row.itemLabel] = row.itemId;
  }
  return { drivers, items };
}

/** 行に含まれる稼動月（"YYYY-MM"。重複なし・昇順） */
export function monthsOf(rows: { date: string }[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.date) set.add(r.date.slice(0, 7));
  return [...set].sort();
}
