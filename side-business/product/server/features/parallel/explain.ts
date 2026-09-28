/**
 * Excel との比べ合わせ：差の「理由の見当」（純関数。画面からも読む）。
 * 差の額が、明細のどの部品（消費税・控除・調整・源泉徴収）と同じ額か、ある行の数量・単価の違いで説明できるかを探す。
 * 当たっても「可能性」にとどめる（どちらが正しいかは、会社が取引条件と照らして決める）。
 */
import type { StatementDraft } from "~/server/calc/statement";

/** 理由を探すのに使う、明細の部品（明細の写しから作る。画面にも渡す小さな形） */
export type DiffParts = {
  subtotal: number;
  tax: number;
  taxLabel: string | null;
  deductions: { name: string; amount: number; taxable: boolean }[];
  deductionTotal: number;
  deductionTax: number;
  adjustments: { label: string; amount: number }[];
  adjustmentTotal: number;
  adjustmentTax: number;
  withholding: number;
  total: number;
  /** 端数が出うる箇所の数（明細の行・控除・消費税） */
  roundingPlaces: number;
  /** 明細の行（数量・単価の違いを探す） */
  lines: { project: string; unit: string; qty: number; rate: number }[];
  /** 委託料が 1 円変わると振込額がいくら変わるか（消費税と、率で引く控除を入れた目安） */
  multiplier: number;
};

export function partsOf(d: StatementDraft): DiffParts {
  // 率で引く控除（ロイヤリティなど）は委託料に比例するので、委託料の差がそのまま振込額に響かない
  const percent = d.deductions.filter((x) => x.how.startsWith("委託料"));
  const percentShare = percent.reduce((a, x) => a + x.amount + (x.taxable ? x.amount * TAX_RATE : 0), 0);
  const multiplier = d.subtotal > 0 ? (d.subtotal + d.tax - percentShare) / d.subtotal : 1;
  return {
    subtotal: d.subtotal,
    tax: d.tax,
    taxLabel: d.taxLabel,
    deductions: d.deductions.map((x) => ({ name: x.name, amount: x.amount, taxable: x.taxable })),
    deductionTotal: d.deductionTotal,
    deductionTax: d.deductionTax,
    adjustments: d.adjustments.map((a) => ({ label: a.label, amount: a.amount })),
    adjustmentTotal: d.adjustmentTotal,
    adjustmentTax: d.adjustmentTax,
    withholding: d.withholding?.amount ?? 0,
    total: d.total,
    roundingPlaces: Math.max(1, d.lines.length + d.deductions.length + (d.tax ? 1 : 0) + (d.deductionTax ? 1 : 0) + (d.adjustmentTax ? 1 : 0)),
    lines: d.lines.map((l) => ({ project: l.project, unit: l.unit, qty: l.qty, rate: l.rate })),
    multiplier: multiplier > 0 ? multiplier : 1,
  };
}

export type ExplainKind = "match" | "no_data" | "tax" | "deduction" | "adjustment" | "withholding" | "qty" | "price" | "rounding" | "unknown";

export type Explanation = {
  kind: ExplainKind;
  /** 短い見出し（「消費税の扱いが違う可能性」） */
  title: string;
  /** なぜそう見たか・何を確かめるとよいか */
  detail: string;
};

const TAX_RATE = 0.1;
/** 数量・単価の違いを探すときの許し幅（消費税・控除をそれぞれ丸めるので、数円ずれる） */
const QTY_TOLERANCE = 3;

function yen(n: number): string {
  return `${Math.round(n).toLocaleString("ja-JP")}円`;
}

/** 控除 1 つの消費税になりうる額（切り捨て・四捨五入・切り上げ） */
function taxCandidates(amount: number): number[] {
  const raw = amount * TAX_RATE;
  return [...new Set([Math.floor(raw + 1e-9), Math.round(raw), Math.ceil(raw - 1e-9)])];
}

/**
 * 差（しめ日ラボ − Excel）の理由の見当。いちばん当たりそうなものを先頭に、当たったものを全部返す。
 * parts が null なら、しめ日ラボにこの月の明細が無い。
 */
export function explainDiff(parts: DiffParts | null, diff: number): Explanation[] {
  if (diff === 0) return [{ kind: "match", title: "一致", detail: "Excel と同じ振込額です。" }];
  if (!parts) {
    return [
      {
        kind: "no_data",
        title: "しめ日ラボにこの月の明細がありません",
        detail: "この人のこの月の稼働・調整が、しめ日ラボに入っていません。取り込みで名前が当たっていないか、稼働の入れ忘れがないかを確かめてください。",
      },
    ];
  }
  const d = Math.abs(diff);
  const ours = diff > 0 ? "しめ日ラボの方が" : "Excel の方が";
  const gap = `${ours} ${yen(d)} 多くなっています。`;
  const out: Explanation[] = [];
  const push = (e: Explanation) => {
    if (!out.some((x) => x.kind === e.kind && x.title === e.title)) out.push(e);
  };

  // 1. 消費税（委託料の消費税・控除の消費税・調整の消費税・その差し引き）
  const taxLabel = parts.taxLabel ?? "消費税";
  const taxCases: { amount: number; what: string }[] = [
    { amount: parts.tax, what: `委託料の${taxLabel}（${yen(parts.tax)}）` },
    { amount: parts.deductionTax, what: `控除の消費税（${yen(parts.deductionTax)}）` },
    { amount: parts.tax - parts.deductionTax, what: `委託料の${taxLabel}から控除の消費税を引いた額（${yen(parts.tax - parts.deductionTax)}）` },
    { amount: parts.adjustmentTax, what: `調整の消費税（${yen(parts.adjustmentTax)}）` },
  ];
  for (const c of taxCases) {
    if (c.amount > 0 && c.amount === d) {
      push({
        kind: "tax",
        title: "消費税の扱いが違う可能性",
        detail: `${gap}差は${c.what}と同じ額です。Excel で消費税を足していない・二重に足している、または税込と税抜の扱いが違う可能性があります。`,
      });
      break;
    }
  }

  // 2. 控除（その控除の額・控除の消費税・税込の額・控除の全部）
  for (const x of parts.deductions) {
    const tax = x.taxable ? taxCandidates(x.amount) : [];
    const hit =
      x.amount === d
        ? `「${x.name}」の控除（${yen(x.amount)}）`
        : tax.includes(d)
          ? `「${x.name}」の控除の消費税（${yen(d)}）`
          : tax.some((t) => x.amount + t === d)
            ? `「${x.name}」の控除の税込の額（${yen(d)}）`
            : null;
    if (hit) {
      push({
        kind: "deduction",
        title: `「${x.name}」の控除`,
        detail: `${gap}差は${hit}と同じ額です。${
          diff < 0 ? `Excel で「${x.name}」を引いていない可能性があります。` : `Excel で「${x.name}」を二重に引いている、または額が違う可能性があります。`
        }取引条件に書いた引き方と比べてください。`,
      });
    }
  }
  const allDeductions = parts.deductionTotal + parts.deductionTax;
  if (parts.deductions.length > 1 && (parts.deductionTotal === d || allDeductions === d)) {
    push({
      kind: "deduction",
      title: "控除の全部",
      detail: `${gap}差は控除の合計（${yen(parts.deductionTotal === d ? parts.deductionTotal : allDeductions)}）と同じ額です。Excel と控除の引き方が違わないか確かめてください。`,
    });
  }

  // 3. 調整（1 つの調整・調整の合計）
  for (const a of parts.adjustments) {
    if (Math.abs(a.amount) === d) {
      push({
        kind: "adjustment",
        title: `「${a.label}」の調整`,
        detail: `${gap}差は「${a.label}」の調整（${yen(a.amount)}）と同じ額です。Excel にこの調整が入っているか、足し引きの向きが同じかを確かめてください。`,
      });
    }
  }
  if (parts.adjustments.length > 1 && Math.abs(parts.adjustmentTotal) === d) {
    push({ kind: "adjustment", title: "調整の全部", detail: `${gap}差は調整の合計（${yen(parts.adjustmentTotal)}）と同じ額です。Excel に調整が入っているかを確かめてください。` });
  }

  // 4. 源泉徴収
  if (parts.withholding > 0 && parts.withholding === d) {
    push({
      kind: "withholding",
      title: "源泉徴収",
      detail: `${gap}差は源泉徴収の額（${yen(parts.withholding)}）と同じです。Excel で源泉徴収を引いていない（または引き方が違う）可能性があります。`,
    });
  }

  // 5. 数量・単価（差を「委託料の差」に戻して、ある行の単価か数量で割り切れるか）
  if (d > QTY_TOLERANCE) {
    const dsub = d / parts.multiplier;
    const more = diff > 0 ? "しめ日ラボの方が" : "Excel の方が";
    const after = (sub: number) =>
      Math.abs(sub - d) > 0 && parts.multiplier !== 1 ? `（消費税・率で引く控除を入れると ${yen(d)}）` : "";
    for (const l of parts.lines) {
      if (!(l.rate * parts.multiplier > QTY_TOLERANCE * 2)) continue;
      const k = Math.round(dsub / l.rate);
      if (k >= 1 && Math.abs(k * l.rate * parts.multiplier - d) <= QTY_TOLERANCE) {
        push({
          kind: "qty",
          title: `「${l.project}」の数量`,
          detail: `${gap}${more}「${l.project}」を ${k.toLocaleString("ja-JP")}${l.unit} 多く数えている可能性があります（${k.toLocaleString("ja-JP")}${l.unit} × ${l.rate.toLocaleString("ja-JP")}円 ＝ ${yen(k * l.rate)}${after(k * l.rate)}）。取り込んだ稼働と Excel の数量を比べてください。`,
        });
      }
    }
    for (const l of parts.lines) {
      // 数量が少ない行は、どんな差でも「単価がいくら違う」と言えてしまうので見ない（1 円の違いが許し幅の 2 倍を超える行だけ）
      if (!(l.rate > 0) || l.qty * parts.multiplier <= QTY_TOLERANCE * 2) continue;
      const p = Math.round(dsub / l.qty);
      // 単価の違いは、元の単価の半分までに限る（それより大きい違いは、別の理由のことが多い）
      if (p >= 1 && p <= l.rate / 2 && Math.abs(p * l.qty * parts.multiplier - d) <= QTY_TOLERANCE) {
        push({
          kind: "price",
          title: `「${l.project}」の単価`,
          detail: `${gap}${more}「${l.project}」の単価が 1${l.unit}あたり ${yen(p)} 高い可能性があります（${l.qty.toLocaleString("ja-JP")}${l.unit} × ${yen(p)} ＝ ${yen(p * l.qty)}${after(p * l.qty)}）。ドライバーごとの単価や、単価を変えた月を確かめてください。`,
        });
      }
    }
  }

  // 6. 端数（差が、端数の出る箇所の数より小さい）
  if (d <= parts.roundingPlaces) {
    push({
      kind: "rounding",
      title: "端数の処理の違い（四捨五入・切り捨て）",
      detail: `${gap}差が ${yen(d)}と小さく、端数が出る箇所（${parts.roundingPlaces} か所）の数以内です。会社の設定の端数の処理と、Excel の ROUND・ROUNDDOWN などの使い方を比べてください。`,
    });
  }

  if (out.length === 0) {
    out.push({
      kind: "unknown",
      title: "内訳を確かめてください",
      detail: `${gap}消費税・控除・調整・源泉徴収・数量・単価のどれとも合いません。下の内訳を Excel の計算と 1 行ずつ比べてください。`,
    });
  }
  return out;
}

export type ParallelSummary = {
  /** Excel の額を入れた人 */
  compared: number;
  matched: number;
  different: number;
  /** 差があって、理由のメモがまだ無い人 */
  unexplained: number;
  /** 差の合計（しめ日ラボ − Excel）と、その内訳 */
  diffTotal: number;
  /** しめ日ラボの方が多い人の差の合計 */
  oursHigher: number;
  /** Excel の方が多い人の差の合計（正の数） */
  excelHigher: number;
  /** 比べた人が全員「一致」か「理由のメモあり」 */
  allExplained: boolean;
  sentence: string;
};

/** 「8人中 6人が一致」（Excel の額を入れた人だけ数える） */
export function parallelSummary(rows: { excelTotal: number | null; diff: number | null; note?: string | null }[]): ParallelSummary {
  const compared = rows.filter((r) => r.excelTotal !== null && r.diff !== null);
  const matched = compared.filter((r) => r.diff === 0).length;
  const diffs = compared.filter((r) => r.diff !== 0);
  const unexplained = diffs.filter((r) => !r.note?.trim()).length;
  const oursHigher = diffs.filter((r) => r.diff! > 0).reduce((a, r) => a + r.diff!, 0);
  const excelHigher = diffs.filter((r) => r.diff! < 0).reduce((a, r) => a - r.diff!, 0);
  return {
    compared: compared.length,
    matched,
    different: diffs.length,
    unexplained,
    diffTotal: oursHigher - excelHigher,
    oursHigher,
    excelHigher,
    allExplained: compared.length > 0 && unexplained === 0,
    sentence: compared.length === 0 ? "まだ比べていません" : `${compared.length}人中 ${matched}人が一致`,
  };
}
