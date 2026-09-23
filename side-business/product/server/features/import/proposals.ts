/**
 * 取り込み：稼働のファイルの金額の列から分かること（純関数。DB に触らない）。
 * - 今の Excel の振込額（並行運用の比べ合わせに入れる）
 * - 控除の列から読み取った式の提案（採用すると、合意の記録が無いルールとして作る）
 * - 振込手数料の列（控除のルールにはしない。知らせるだけ）
 */
import { adjustCandidates, type AdjustCandidate } from "./adjust";
import { baseName, colLetter } from "./detect";
import { parseDeductionFormula } from "./formula-read";
import { CATEGORY_LABEL, findMoneyColumns, perDriverValues, readPayout, type DeductionCategory, type PayoutRead } from "./columns";
import { formatRate, inferDeductionRule, sameGuess, type Inference, type RuleGuess } from "./deductions";
import { readRateColumns, type RateFinding } from "./rates";
import type { WorkMapping } from "./types";

export type ExistingRule = { id: string; driverId: string | null; name: string; kind: string; rate: number | null; amount: number | null; active: boolean; agreedInWriting: boolean };

export type DeductionProposal = {
  col: number;
  header: string;
  /** 作るルールの名前（見出しから括弧書きを外したもの） */
  name: string;
  category: DeductionCategory;
  categoryLabel: string;
  /** 会社の売上として消費税がかかるものか（既定。設定の画面で直せる） */
  taxable: boolean;
  inference: Inference | null;
  /** 式が見つからなかった理由 */
  reason: string | null;
  /** 行ごとの額を人ごとに足した（縦持ちの表） */
  perRow: boolean;
  /** 同じ名前の全員向けのルール（使っているもの） */
  existing: ExistingRule | null;
  /** 登録済みのルールと同じ式 */
  sameAsExisting: boolean;
  /** その人だけのルールにできる人（合わなかった人のうち、その人だけの式で説明できる人） */
  exceptionRules: { driverId: string; name: string; guess: RuleGuess; hasOwnRule: boolean }[];
  /** Excel に残っていた数式（=E5*0.1 など）から読んだこと。used：値とも合って、その式を提案に使った */
  formula: FormulaHint | null;
};

export type FormulaHint = {
  /** 例に出す数式（いちばん多い形のうち、最初の行のもの） */
  sample: string;
  /** 掛けている列の見出し */
  refHeader: string;
  /** 数式の式（委託料 × 率 か、数量 × 単価） */
  guess: RuleGuess;
  /** その形の数式が入っていた行の数 */
  rows: number;
  used: boolean;
};

export type MoneyExtras = {
  payout: PayoutRead | null;
  fees: { col: number; header: string }[];
  proposals: DeductionProposal[];
  /** その月の調整として入れられる金額の列（燃料・高速代・立替・事故の負担・手当 など） */
  adjust: AdjustCandidate[];
  /** 単価・金額の列から読んだ、人ごとの単価 */
  rates: RateFinding[];
  /** 率の元にした委託料：ファイルの列（委託料・報酬）か、明細と同じ計算 */
  base: { from: "column" | "calc"; header: string | null };
  /** 会社の金額の端数の処理（Excel の端数と違えば知らせる） */
  rounding: string;
};

export type DriverBase = { driverId: string; subtotal: number; qty: number };

function looseKey(v: string): string {
  return v.normalize("NFKC").replace(/\s/g, "").toLowerCase();
}

/**
 * 控除の列の数式から、いちばん多い形（掛けている列と数）を読む。同じ行を掛けている数式だけを見る。
 * 数量の列を掛けていれば「数量 × 単価」、それ以外（委託料・金額の列）なら「委託料 × 率」の手がかりにする。
 * 2 行以上、かつ数式が入っていた行の半分以上が同じ形のときだけ。
 */
export function formulaHintFor(
  col: number,
  resolved: { rowNo: number }[],
  formulas: Record<string, string> | undefined,
  header: string[],
  roles: string[],
): Omit<FormulaHint, "used"> | null {
  if (!formulas) return null;
  const rowNos = [...new Set(resolved.map((r) => r.rowNo))];
  const groups = new Map<string, { guess: RuleGuess; refCol: number; sample: string; rows: number }>();
  let seen = 0;
  for (const rowNo of rowNos) {
    const text = formulas[`${colLetter(col)}${rowNo}`];
    if (!text) continue;
    seen++;
    const f = parseDeductionFormula(text);
    if (!f || f.row !== rowNo || f.col === col) continue;
    const role = roles[f.col] ?? "ignore";
    // 人ごとに案件・日付が横に並ぶ表の 1 つの列を掛けている式は、ルールで表せない
    if (role === "value") continue;
    const guess: RuleGuess = role === "qty" ? { kind: "per_unit", rate: f.factor } : { kind: "percent", rate: f.factor };
    const key = `${guess.kind}:${f.factor}:${f.col}`;
    const g = groups.get(key) ?? { guess, refCol: f.col, sample: text, rows: 0 };
    g.rows++;
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.rows - a.rows)[0];
  if (!top || top.rows < 2 || top.rows * 2 < seen) return null;
  return { sample: top.sample, refHeader: (header[top.refCol] ?? "").trim() || `${colLetter(top.refCol)}列`, guess: top.guess, rows: top.rows };
}

/** 数式の式を短い言葉で（「F列「委託料」の 10%」） */
export function formulaText(h: Pick<FormulaHint, "refHeader" | "guess">): string {
  const g = h.guess;
  if (g.kind === "percent") return `「${h.refHeader}」× ${formatRate(g.rate)}`;
  if (g.kind === "per_unit") return `「${h.refHeader}」× ${g.rate.toLocaleString("ja-JP", { maximumFractionDigits: 4 })}円`;
  return `${Math.round(g.amount).toLocaleString("ja-JP")}円`;
}

function ruleGuessOf(r: ExistingRule): RuleGuess | null {
  if (r.kind === "percent" && r.rate !== null) return { kind: "percent", rate: r.rate };
  if (r.kind === "per_unit" && r.rate !== null) return { kind: "per_unit", rate: r.rate };
  if (r.kind === "fixed" && r.amount !== null) return { kind: "fixed", amount: r.amount };
  return null;
}

/**
 * ファイルの金額の列を読む。resolved は当たった行（行番号とドライバー）、bases は人ごとの委託料と数量（明細と同じ計算）。
 */
export function moneyExtras(input: {
  rows: string[][];
  mapping: WorkMapping;
  header: string[];
  resolved: { rowNo: number; driverId: string; projectId?: string; qty?: number }[];
  names: Map<string, string>;
  bases: DriverBase[];
  rules: ExistingRule[];
  rounding?: string;
  /** Excel に残っていた数式（番地 → 数式）。無ければ値だけで読む */
  formulas?: Record<string, string>;
  /** 案件と人ごとの単価（単価の列を読むときに比べる。無ければ単価の列は読まない） */
  projects?: { id: string; name: string; unit: string; payRate: number; billRate: number }[];
  overrides?: { driverId: string; projectId: string; payRate: number }[];
}): MoneyExtras {
  const { rows, mapping, header, resolved, names } = input;
  const cols = findMoneyColumns(header, mapping.roles);
  const payout = readPayout(rows, mapping, header, resolved, names);
  const fees = cols.filter((c) => c.kind === "fee").map((c) => ({ col: c.col, header: c.header }));

  // 率の元：ファイルに委託料の列があればそれ（Excel が計算に使った額）、無ければ明細と同じ計算の委託料
  const baseCol = cols.find((c) => c.kind === "base");
  const baseRead = baseCol ? perDriverValues(rows, mapping, resolved, baseCol.col) : null;
  const calc = new Map(input.bases.map((b) => [b.driverId, b]));
  const workers = [...new Set(resolved.map((r) => r.driverId))];
  const baseOf = (id: string) => (baseRead && baseRead.values.has(id) ? Math.abs(baseRead.values.get(id)!) : (calc.get(id)?.subtotal ?? 0));

  const adjustCols = new Set((mapping.adjust ?? []).map((a) => a.col));
  const proposals: DeductionProposal[] = [];
  for (const c of cols) {
    // 調整として入れると決めた列は、控除のルールの提案にしない（二重に引かないように）
    if (c.kind !== "deduction" || adjustCols.has(c.col)) continue;
    const read = perDriverValues(rows, mapping, resolved, c.col);
    // 稼働した人は全員を見る（額が空なら 0＝引いていない）
    const obs = workers.map((id) => ({
      driverId: id,
      name: names.get(id) ?? "",
      value: Math.abs(read.values.get(id) ?? 0),
      base: baseOf(id),
      qty: calc.get(id)?.qty ?? 0,
    }));
    const hint = formulaHintFor(c.col, resolved, input.formulas, header, mapping.roles);
    const res = inferDeductionRule(obs, hint?.guess);
    const name = (baseName(c.header).replace(/[（(]?円[）)]?$/, "").trim() || c.header).slice(0, 40);
    const existing = input.rules.find((r) => r.active && r.driverId === null && looseKey(r.name) === looseKey(name)) ?? null;
    const existingGuess = existing ? ruleGuessOf(existing) : null;
    const own = new Set(input.rules.filter((r) => r.active && r.driverId !== null && looseKey(r.name) === looseKey(name)).map((r) => r.driverId!));
    proposals.push({
      col: c.col,
      header: c.header,
      name,
      category: c.category,
      categoryLabel: CATEGORY_LABEL[c.category],
      // 立替の精算・保険・高速代・事故の負担（実費の受け渡し）は、消費税の対象外を既定にする（設定の画面で直せる）
      taxable: c.category !== "advance" && c.category !== "insurance" && c.category !== "toll" && c.category !== "accident",
      inference: res.inference,
      reason: res.reason,
      perRow: read.perRow,
      existing,
      sameAsExisting: !!(res.inference && existingGuess && sameGuess(res.inference.guess, existingGuess)),
      exceptionRules: (res.inference?.outliers ?? [])
        .filter((o): o is typeof o & { own: RuleGuess } => o.own !== null)
        .map((o) => ({ driverId: o.driverId, name: o.name, guess: o.own, hasOwnRule: own.has(o.driverId) })),
      formula: hint ? { ...hint, used: !!res.inference && sameGuess(res.inference.guess, hint.guess) } : null,
    });
  }
  const adjust = adjustCandidates({ rows, mapping, header, resolved, names, rules: input.rules });
  const withProject = resolved.filter((r): r is { rowNo: number; driverId: string; projectId: string; qty: number } => !!r.projectId && typeof r.qty === "number");
  const rates = input.projects
    ? readRateColumns({ rows, mapping, header, resolved: withProject, projects: input.projects, overrides: input.overrides ?? [], names })
    : [];
  return {
    payout,
    fees,
    proposals,
    adjust,
    rates,
    base: { from: baseRead ? "column" : "calc", header: baseCol?.header ?? null },
    rounding: input.rounding ?? "round",
  };
}
