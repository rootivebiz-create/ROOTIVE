/**
 * 控除のルールのひな形と、入力の確かめ（純関数。画面からも読む）。
 * ここは「今の取引条件に書いてある控除」を写すところで、新しく控除を決める場所ではない。
 * 消費税がかかるかの初期値は、よくある扱いを置いているだけ。会社ごとに顧問の税理士さんと確かめて直す。
 */
import { parseAmount } from "@/lib/payroll/money";

export type RuleKind = "percent" | "fixed" | "per_unit";

export type RuleTemplate = {
  id: string;
  name: string;
  kind: RuleKind;
  /** 入れ方の例（率は %、定額は円） */
  example: string;
  taxable: boolean;
  onlyWhenWorked: boolean;
  hint: string;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  { id: "royalty", name: "ロイヤリティ", kind: "percent", example: "10", taxable: true, onlyWhenWorked: true, hint: "委託料（税抜）に率を掛けて引きます" },
  { id: "admin", name: "管理費", kind: "fixed", example: "15000", taxable: true, onlyWhenWorked: true, hint: "稼働があった月に、毎月同じ額を引きます" },
  { id: "system", name: "システム利用料", kind: "fixed", example: "3000", taxable: true, onlyWhenWorked: true, hint: "端末・アプリなどの利用料" },
  { id: "lease", name: "車両リース", kind: "fixed", example: "32000", taxable: true, onlyWhenWorked: false, hint: "稼働が無い月も引く設定にしています（取引条件どおりか確かめてください）" },
  { id: "insurance", name: "保険料", kind: "fixed", example: "8000", taxable: false, onlyWhenWorked: false, hint: "保険料の立替の精算など" },
  { id: "per_unit", name: "1個あたりの手数料", kind: "per_unit", example: "5", taxable: true, onlyWhenWorked: true, hint: "数量（個・件など）に単価を掛けて引きます" },
];

export const KIND_LABEL: Record<RuleKind, string> = { percent: "委託料 × 率", fixed: "毎月の定額", per_unit: "数量 × 単価" };
export const KIND_UNIT: Record<RuleKind, string> = { percent: "%", fixed: "円", per_unit: "円／数量" };

/** 画面から来た 1 つぶん（文字のまま） */
export type RuleInput = {
  name: string;
  kind: string;
  value: string;
  taxable: boolean;
  onlyWhenWorked: boolean;
  agreedInWriting: boolean;
  agreedOn: string;
  basis: string;
};

export type RuleDraft = {
  name: string;
  kind: RuleKind;
  /** 率（0.1 = 10%）か、1 数量あたりの単価 */
  rate: number | null;
  /** 毎月の定額（円） */
  amount: number | null;
  taxable: boolean;
  onlyWhenWorked: boolean;
  agreedInWriting: boolean;
  agreedOn: string | null;
  basis: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** 1 つを確かめる。errors が空なら draft を使える */
export function checkRule(input: RuleInput): { draft: RuleDraft | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name) errors.push("控除の名前を入れてください");
  else if (name.length > 40) errors.push("控除の名前は 40 文字までにしてください");
  const kind = input.kind as RuleKind;
  if (!["percent", "fixed", "per_unit"].includes(kind)) errors.push("引き方を選んでください");
  const n = parseAmount(input.value.normalize("NFKC").replace(/%$/, ""));
  let rate: number | null = null;
  let amount: number | null = null;
  if (n === null || n <= 0) {
    errors.push(`「${name || "控除"}」の${kind === "percent" ? "率" : "金額"}を 0 より大きい数で入れてください`);
  } else if (kind === "percent") {
    if (n > 100) errors.push("率は 100% までにしてください");
    else if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) errors.push("率は小数 2 桁まで（例：10.25%）にしてください");
    else rate = Math.round(n * 100) / 10000;
  } else if (kind === "fixed") {
    if (!Number.isInteger(n)) errors.push("定額は 1 円単位で入れてください");
    else if (n > 10_000_000) errors.push("金額が大きすぎます。桁を確かめてください");
    else amount = n;
  } else if (kind === "per_unit") {
    if (n > 1_000_000) errors.push("単価が大きすぎます。桁を確かめてください");
    else if (Math.abs(n * 1e4 - Math.round(n * 1e4)) > 1e-6) errors.push("単価の小数は 4 桁までにしてください");
    else rate = n;
  }
  const agreedOn = input.agreedOn.trim();
  if (agreedOn && !isRealDate(agreedOn)) errors.push("合意した日の形が正しくありません（例：2026-04-01）");
  const basis = input.basis.normalize("NFKC").trim();
  if (basis.length > 200) errors.push("根拠は 200 文字までにしてください");

  if (!input.agreedInWriting) {
    warnings.push(
      `「${name || "この控除"}」は「取引条件に書いて合意している」に印がありません。取引条件に書いていない控除は、フリーランス法 第5条（報酬の減額の禁止）にあたるおそれがあり、見張り番が毎月お知らせします。取引条件に書いてあるかの確認をおすすめします。`,
    );
  } else if (!agreedOn) {
    warnings.push(`「${name}」の合意した日を入れると、見張り番が「支払の対象の期間が始まる前に合意していたか」を確かめられます。`);
  }
  if (errors.length) return { draft: null, errors, warnings };
  return {
    draft: {
      name,
      kind,
      rate,
      amount,
      taxable: input.taxable,
      onlyWhenWorked: input.onlyWhenWorked,
      agreedInWriting: input.agreedInWriting,
      agreedOn: agreedOn || null,
      basis: basis || null,
    },
    errors,
    warnings,
  };
}

/** 画面に出す「10%」「15,000円」「5円／数量」 */
export function ruleValueText(d: Pick<RuleDraft, "kind" | "rate" | "amount">): string {
  if (d.kind === "percent") return `${Math.round((d.rate ?? 0) * 10000) / 100}%`;
  if (d.kind === "fixed") return `${(d.amount ?? 0).toLocaleString("ja-JP")}円`;
  return `${(d.rate ?? 0).toLocaleString("ja-JP")}円／数量`;
}
