/**
 * 取り込み：金額の列を、その月の調整（人ごとの足し引き）として入れる（純関数。DB に触らない）。
 * 燃料・高速代・立替・事故の負担・手当など、人ごと・月ごとに額が変わり、決まった式（控除のルール）にならない列に使う。
 * どの列をどう入れるか（名前・向き・消費税・合意）は読み方（mapping.adjust）に持ち、覚えた読み方にも残す。
 */
import { CATEGORY_LABEL, findMoneyColumns, perDriverValues, type MoneyColumn } from "./columns";
import { baseName, colLetter } from "./detect";
import { ADJUST_SIGN_LABEL, type AdjustColumn, type WorkMapping } from "./types";

export type AdjustSign = AdjustColumn["sign"];

export const SIGN_LABEL = ADJUST_SIGN_LABEL;

/** 調整の名前・根拠の長さ（/work の入力と同じ） */
const LABEL_MAX = 60;
const BASIS_MAX = 200;

export type AdjustCandidate = {
  col: number;
  header: string;
  /** 列の種類（燃料・立替の精算・手当 など） */
  kindLabel: string;
  /** 今の設定（入れない列は null） */
  setting: AdjustColumn | null;
  /** 設定が無いときの下書き */
  draft: { label: string; sign: AdjustSign; taxable: boolean };
  /** 人ごとの値（Excel に書いてあるまま。縦持ちで行ごとの額なら、人ごとに足したもの） */
  entries: { driverId: string; name: string; value: number }[];
  /** ＋と−の両方がある */
  mixedSigns: boolean;
  /** 数として読めなかったセル（番地） */
  unreadable: string[];
  /** 同じ名前の控除のルール（両方あると二重に引く） */
  sameNameRule: string | null;
};

export type NewAdjustment = { driverId: string; label: string; amount: number; taxable: boolean; agreedInWriting: boolean; basis: string | null };

function looseKey(v: string): string {
  return v.normalize("NFKC").replace(/\s/g, "").toLowerCase();
}

/** 列の見出しから、調整の名前の下書き（括弧書き・「円」を外す） */
export function adjustLabel(header: string): string {
  return (baseName(header).replace(/[（(]?円[）)]?$/, "").trim() || header.trim()).slice(0, LABEL_MAX);
}

/** 列の種類ごとの既定の向きと消費税（実費の受け渡し＝立替・保険・高速代・事故の負担は対象外を既定にする） */
export function adjustDefaults(c: Pick<MoneyColumn, "kind"> & { category?: string }, values: number[]): { sign: AdjustSign; taxable: boolean } {
  const mixed = values.some((v) => v < 0) && values.some((v) => v > 0);
  const allNegative = values.length > 0 && values.every((v) => v <= 0);
  if (mixed || allNegative) return { sign: "asIs", taxable: false };
  if (c.kind === "allowance") return { sign: "plus", taxable: true };
  if (c.kind === "adjust") return { sign: "asIs", taxable: false };
  if (c.kind === "deduction") {
    if (c.category === "advance") return { sign: "plus", taxable: false };
    const taxable = c.category === "royalty" || c.category === "admin" || c.category === "lease" || c.category === "fuel";
    return { sign: "minus", taxable };
  }
  return { sign: "minus", taxable: false };
}

/** Excel の値と向きから、調整の額（円の整数。＋は支払を増やす） */
export function signedAmount(value: number, sign: AdjustSign): number {
  const v = Math.round(value);
  if (sign === "asIs") return v;
  return sign === "minus" ? -Math.abs(v) : Math.abs(v);
}

function kindLabelOf(c: MoneyColumn | null): string {
  if (!c) return "金額";
  if (c.kind === "deduction") return CATEGORY_LABEL[c.category];
  if (c.kind === "allowance") return "手当";
  if (c.kind === "adjust") return "調整";
  return "金額";
}

/**
 * 調整として入れられる金額の列（控除・手当・調整の列と、すでに調整にすると決めた列）。
 * resolved は当たった行（行番号とドライバー）。振込額・委託料・振込手数料の列は出さない
 */
export function adjustCandidates(input: {
  rows: string[][];
  mapping: WorkMapping;
  header: string[];
  resolved: { rowNo: number; driverId: string }[];
  names: Map<string, string>;
  rules: { name: string; active: boolean }[];
}): AdjustCandidate[] {
  const { rows, mapping, header, resolved, names } = input;
  const money = findMoneyColumns(header, mapping.roles);
  const settings = new Map((mapping.adjust ?? []).map((a) => [a.col, a]));
  const cols = new Set<number>([...money.filter((c) => c.kind === "deduction" || c.kind === "allowance" || c.kind === "adjust").map((c) => c.col), ...settings.keys()]);
  const out: AdjustCandidate[] = [];
  for (const col of [...cols].sort((a, b) => a - b)) {
    if ((mapping.roles[col] ?? "ignore") !== "ignore") continue;
    const c = money.find((x) => x.col === col) ?? null;
    const read = perDriverValues(rows, mapping, resolved, col);
    const entries = [...read.values.entries()]
      .filter(([, v]) => Math.round(v) !== 0)
      .map(([driverId, value]) => ({ driverId, name: names.get(driverId) ?? "", value }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const values = entries.map((e) => e.value);
    const h = (header[col] ?? "").trim() || `${colLetter(col)}列`;
    const label = adjustLabel(h);
    const rule = input.rules.find((r) => r.active && looseKey(r.name) === looseKey(settings.get(col)?.label ?? label));
    const d = adjustDefaults(c ?? { kind: "adjust" }, values);
    out.push({
      col,
      header: h,
      kindLabel: kindLabelOf(c),
      setting: settings.get(col) ?? null,
      draft: { label, sign: d.sign, taxable: d.taxable },
      entries,
      mixedSigns: values.some((v) => v < 0) && values.some((v) => v > 0),
      unreadable: read.unreadable,
      sameNameRule: rule?.name ?? null,
    });
  }
  return out;
}

/**
 * 反映のときに作る調整：読み方で「調整として入れる」にした列を、人ごとに 1 件ずつ（0 円の人は作らない）。
 * 根拠が空なら、どのファイルのどの列から入れたかを書く
 */
export function adjustmentsFromColumns(input: {
  rows: string[][];
  mapping: WorkMapping;
  header: string[];
  resolved: { rowNo: number; driverId: string }[];
  fileName: string;
}): NewAdjustment[] {
  const out: NewAdjustment[] = [];
  for (const a of input.mapping.adjust ?? []) {
    if ((input.mapping.roles[a.col] ?? "ignore") !== "ignore") continue;
    const read = perDriverValues(input.rows, input.mapping, input.resolved, a.col);
    const h = (input.header[a.col] ?? "").trim() || `${colLetter(a.col)}列`;
    const basis = (a.basis?.trim() || `取り込み：${input.fileName}の「${h}」の列`).slice(0, BASIS_MAX);
    for (const [driverId, value] of read.values) {
      const amount = signedAmount(value, a.sign);
      if (amount === 0) continue;
      out.push({ driverId, label: a.label.slice(0, LABEL_MAX), amount, taxable: a.taxable, agreedInWriting: a.agreedInWriting, basis });
    }
  }
  return out;
}
