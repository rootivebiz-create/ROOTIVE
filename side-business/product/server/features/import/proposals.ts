/**
 * 取り込み：稼働のファイルの金額の列から分かること（純関数。DB に触らない）。
 * - 今の Excel の振込額（並行運用の比べ合わせに入れる）
 * - 控除の列から読み取った式の提案（採用すると、合意の記録が無いルールとして作る）
 * - 振込手数料の列（控除のルールにはしない。知らせるだけ）
 */
import { baseName } from "./detect";
import { CATEGORY_LABEL, findMoneyColumns, perDriverValues, readPayout, type DeductionCategory, type PayoutRead } from "./columns";
import { inferDeductionRule, sameGuess, type Inference, type RuleGuess } from "./deductions";
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
};

export type MoneyExtras = {
  payout: PayoutRead | null;
  fees: { col: number; header: string }[];
  proposals: DeductionProposal[];
  /** 率の元にした委託料：ファイルの列（委託料・報酬）か、明細と同じ計算 */
  base: { from: "column" | "calc"; header: string | null };
};

export type DriverBase = { driverId: string; subtotal: number; qty: number };

function looseKey(v: string): string {
  return v.normalize("NFKC").replace(/\s/g, "").toLowerCase();
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
  resolved: { rowNo: number; driverId: string }[];
  names: Map<string, string>;
  bases: DriverBase[];
  rules: ExistingRule[];
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

  const proposals: DeductionProposal[] = [];
  for (const c of cols) {
    if (c.kind !== "deduction") continue;
    const read = perDriverValues(rows, mapping, resolved, c.col);
    // 稼働した人は全員を見る（額が空なら 0＝引いていない）
    const obs = workers.map((id) => ({
      driverId: id,
      name: names.get(id) ?? "",
      value: Math.abs(read.values.get(id) ?? 0),
      base: baseOf(id),
      qty: calc.get(id)?.qty ?? 0,
    }));
    const res = inferDeductionRule(obs);
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
      // 立替の精算・保険（実費の受け渡し）は、消費税の対象外を既定にする（設定の画面で直せる）
      taxable: c.category !== "advance" && c.category !== "insurance",
      inference: res.inference,
      reason: res.reason,
      perRow: read.perRow,
      existing,
      sameAsExisting: !!(res.inference && existingGuess && sameGuess(res.inference.guess, existingGuess)),
      exceptionRules: (res.inference?.outliers ?? [])
        .filter((o): o is typeof o & { own: RuleGuess } => o.own !== null)
        .map((o) => ({ driverId: o.driverId, name: o.name, guess: o.own, hasOwnRule: own.has(o.driverId) })),
    });
  }
  return { payout, fees, proposals, base: { from: baseRead ? "column" : "calc", header: baseCol?.header ?? null } };
}
