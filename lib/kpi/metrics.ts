/**
 * 経営指標（KPI）の説明と判定（純関数）
 *
 * 数字そのものは DB ビュー `v_month_kpi` の値をそのまま使い、ここでは
 *   - その指標が何を表すかの 1 行説明
 *   - 健全／ふつう／注意／危険 の判定と「何をすればよいか」の 1 行
 *   - 前月比と達成率のバッジ色
 * だけを決める（金額の再計算・独自の丸めはしない。表示は lib/format の yen() / pct()）。
 *
 * 注意：ビューの `break_even_ratio` は「売上 ÷ 損益分岐点売上高」（100% 超が黒字）。
 * 画面では一般的な「損益分岐点比率 ＝ 損益分岐点売上高 ÷ 売上」（100% 超が赤字）で見せるため、
 * `breakEvenRatioOf()` で言い換える。
 */
import type { MonthKpi } from "@/lib/db/types";
import { pct, yen } from "@/lib/format";
import { dateToMonth } from "@/lib/month";

// ---------------------------------------------------------------------------
// 判定の色と言葉
// ---------------------------------------------------------------------------

export type KpiTone = "good" | "ok" | "warn" | "bad" | "info";

export const KPI_TONE_LABELS: Record<KpiTone, string> = {
  good: "健全",
  ok: "ふつう",
  warn: "注意",
  bad: "危険",
  info: "参考",
};

/** components/ui/badge.tsx の variant */
export type KpiBadgeVariant = "success" | "secondary" | "warning" | "destructive" | "outline";

export const KPI_TONE_BADGE: Record<KpiTone, KpiBadgeVariant> = {
  good: "success",
  ok: "secondary",
  warn: "warning",
  bad: "destructive",
  info: "outline",
};

export interface KpiJudgement {
  tone: KpiTone;
  label: string;
  /** 数字が良くないときの「何をすればよいか」（良いときは null） */
  advice: string | null;
}

function judgement(tone: KpiTone, advice: string | null = null): KpiJudgement {
  return { tone, label: KPI_TONE_LABELS[tone], advice };
}

// ---------------------------------------------------------------------------
// 判定のしきい値（画面・テストから参照する）
// ---------------------------------------------------------------------------

/** 限界利益率：20% 以上で健全、12% 未満は危険 */
export const CONTRIBUTION_RATE_GOOD = 0.2;
export const CONTRIBUTION_RATE_WARN = 0.12;
/** 損益分岐点比率：80% 未満で健全、90% 以上は注意、100% 以上は赤字 */
export const BREAK_EVEN_RATIO_GOOD = 0.8;
export const BREAK_EVEN_RATIO_OK = 0.9;
export const BREAK_EVEN_RATIO_BAD = 1;
/** 支払比率：75% 以下で健全、85% 超は危険 */
export const PAYOUT_RATE_GOOD = 0.75;
export const PAYOUT_RATE_WARN = 0.85;
/** 1 人当たり・1 日当たりの「前月より下がった」と見なす下げ幅 */
export const PER_UNIT_DROP_RATIO = 0.05;

// ---------------------------------------------------------------------------
// ビューの行 → 画面で使う数値
// ---------------------------------------------------------------------------

/** numeric は文字列で返ることがあるので数値へ（読めない値は 0） */
export function kpiNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** null のまま扱う数値（達成率など「未設定」を区別する列） */
export function kpiNullableNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface KpiValues {
  /** 稼動月 "YYYY-MM"（行が無ければ ""） */
  month: string;
  bill: number;
  profit: number;
  payout: number;
  operatingProfit: number;
  operatingMargin: number;
  expenseTotal: number;
  contribution: number;
  contributionRate: number;
  netFixedCost: number;
  breakEvenBill: number;
  /** 損益分岐点比率 ＝ 損益分岐点売上高 ÷ 売上（計算できないときは null） */
  breakEvenRatio: number | null;
  payoutRate: number;
  billPerDriver: number;
  profitPerDriver: number;
  billPerWorkDay: number;
  activeDriverCount: number;
  workDayCount: number;
  entryCount: number;
  billAchievement: number | null;
  profitAchievement: number | null;
  expenseAchievement: number | null;
  /** 稼働も経費も無い月は false */
  hasData: boolean;
}

export const EMPTY_KPI_VALUES: KpiValues = {
  month: "",
  bill: 0,
  profit: 0,
  payout: 0,
  operatingProfit: 0,
  operatingMargin: 0,
  expenseTotal: 0,
  contribution: 0,
  contributionRate: 0,
  netFixedCost: 0,
  breakEvenBill: 0,
  breakEvenRatio: null,
  payoutRate: 0,
  billPerDriver: 0,
  profitPerDriver: 0,
  billPerWorkDay: 0,
  activeDriverCount: 0,
  workDayCount: 0,
  entryCount: 0,
  billAchievement: null,
  profitAchievement: null,
  expenseAchievement: null,
  hasData: false,
};

/**
 * 損益分岐点比率 ＝ 損益分岐点売上高 ÷ 売上
 * 売上が無い月・限界利益がマイナスの月は計算できない（null）
 */
export function breakEvenRatioOf(v: { bill: number; contribution: number; breakEvenBill: number }): number | null {
  if (!(v.bill > 0)) return null;
  if (!(v.contribution > 0)) return null;
  return Math.max(0, v.breakEvenBill) / v.bill;
}

/** v_month_kpi の 1 行を画面で使う数値へ（行が無ければ 0 埋め） */
export function toKpiValues(row: MonthKpi | null | undefined): KpiValues {
  if (!row) return { ...EMPTY_KPI_VALUES };
  const bill = kpiNumber(row.bill);
  const contribution = kpiNumber(row.contribution);
  const breakEvenBill = kpiNumber(row.break_even_bill);
  const entryCount = kpiNumber(row.entry_count);
  const expenseTotal = kpiNumber(row.expense_total);
  return {
    month: row.month ? dateToMonth(String(row.month)) : "",
    bill,
    profit: kpiNumber(row.profit),
    payout: kpiNumber(row.payout),
    operatingProfit: kpiNumber(row.operating_profit),
    operatingMargin: kpiNumber(row.operating_margin),
    expenseTotal,
    contribution,
    contributionRate: kpiNumber(row.contribution_rate),
    netFixedCost: kpiNumber(row.net_fixed_cost),
    breakEvenBill,
    breakEvenRatio: breakEvenRatioOf({ bill, contribution, breakEvenBill }),
    payoutRate: kpiNumber(row.payout_rate),
    billPerDriver: kpiNumber(row.bill_per_driver),
    profitPerDriver: kpiNumber(row.profit_per_driver),
    billPerWorkDay: kpiNumber(row.bill_per_work_day),
    activeDriverCount: kpiNumber(row.active_driver_count),
    workDayCount: kpiNumber(row.work_day_count),
    entryCount,
    billAchievement: kpiNullableNumber(row.bill_achievement),
    profitAchievement: kpiNullableNumber(row.profit_achievement),
    expenseAchievement: kpiNullableNumber(row.expense_achievement),
    hasData: entryCount > 0 || bill !== 0 || expenseTotal !== 0,
  };
}

// ---------------------------------------------------------------------------
// 指標ごとの判定
// ---------------------------------------------------------------------------

/** 限界利益率（売上から支払・変動費を引いて残る割合） */
export function judgeContributionRate(rate: number | null): KpiJudgement {
  if (rate == null) return judgement("info");
  if (rate >= CONTRIBUTION_RATE_GOOD) return judgement("good");
  if (rate >= CONTRIBUTION_RATE_WARN) {
    return judgement("warn", "受注単価の引き上げか、支払単価・変動費（燃料・リースなど）の見直しを検討してください。");
  }
  return judgement("bad", "売上が増えても利益が残りにくい状態です。採算の悪い案件を案件別採算で洗い出してください。");
}

/** 損益分岐点比率（損益分岐点売上高 ÷ 売上。100% を超えると赤字） */
export function judgeBreakEvenRatio(ratio: number | null): KpiJudgement {
  if (ratio == null) return judgement("info");
  if (ratio >= BREAK_EVEN_RATIO_BAD) {
    return judgement("bad", "売上が損益分岐点に届いていません（赤字）。固定費の削減か売上の上乗せが必要です。");
  }
  if (ratio >= BREAK_EVEN_RATIO_OK) {
    return judgement("warn", "余裕がわずかです。稼働が数日減ると赤字になります。固定費の見直しを検討してください。");
  }
  if (ratio >= BREAK_EVEN_RATIO_GOOD) return judgement("ok");
  return judgement("good");
}

/** 支払比率（売上に占めるドライバーへの支払・税抜） */
export function judgePayoutRate(rate: number | null): KpiJudgement {
  if (rate == null) return judgement("info");
  if (rate <= PAYOUT_RATE_GOOD) return judgement("good");
  if (rate <= PAYOUT_RATE_WARN) {
    return judgement("warn", "支払の割合が高めです。受注単価と支払単価の差をドライバー別の採算で確認してください。");
  }
  return judgement("bad", "支払が売上を圧迫しています。単価の見直しか、採算の合わない案件の入れ替えを検討してください。");
}

/** 営業利益率（会社利益 − 経費 ÷ 売上） */
export function judgeOperatingMargin(rate: number | null): KpiJudgement {
  if (rate == null) return judgement("info");
  if (rate < 0) return judgement("bad", "営業赤字です。経費の内訳と単価をあわせて見直してください。");
  if (rate < 0.05) return judgement("warn", "利益がほとんど残っていません。固定費の削減か単価の引き上げを検討してください。");
  if (rate < 0.1) return judgement("ok");
  return judgement("good");
}

/**
 * 達成率のバッジ色
 * upIsGood=true（売上・利益）：100% 以上は健全、90% 以上は注意、それ未満は危険
 * upIsGood=false（経費）：100% 以下は健全、110% 以下は注意、超過は危険
 */
export function achievementTone(rate: number | null, upIsGood: boolean): KpiTone {
  if (rate == null) return "info";
  if (upIsGood) {
    if (rate >= 1) return "good";
    if (rate >= 0.9) return "warn";
    return "bad";
  }
  if (rate <= 1) return "good";
  if (rate <= 1.1) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------
// 前月比
// ---------------------------------------------------------------------------

export type KpiValueKind = "money" | "rate";

export interface KpiChange {
  /** 金額は "+¥12,345"、率は "+1.2pt" */
  text: string;
  /** 増減率（金額のみ。前月が 0 なら null） */
  ratio: number | null;
  direction: -1 | 0 | 1;
  /** 増加が良い変化か（null＝中立） */
  upIsGood: boolean | null;
  /** 色（good＝良い方向・bad＝悪い方向・info＝中立） */
  tone: KpiTone;
}

/** 前月比（前月のデータが無ければ null） */
export function kpiChange(kind: KpiValueKind, value: number | null, prev: number | null, upIsGood: boolean | null = null): KpiChange | null {
  if (value == null || prev == null) return null;
  const diff = value - prev;
  const direction: -1 | 0 | 1 = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  const text =
    kind === "rate"
      ? `${diff >= 0 ? "+" : "-"}${Math.abs(diff * 100).toFixed(1)}pt`
      : diff >= 0
        ? `+${yen(diff)}`
        : yen(diff);
  const ratio = kind === "money" && prev !== 0 ? diff / prev : null;
  const tone: KpiTone = direction === 0 || upIsGood == null ? "info" : (direction === 1) === upIsGood ? "good" : "bad";
  return { text, ratio, direction, upIsGood, tone };
}

/** 前月より目立って下がったか（1 人当たり・1 日当たりの指標に使う） */
export function droppedFromPrev(value: number, prev: number | null, threshold = PER_UNIT_DROP_RATIO): boolean {
  if (prev == null || prev <= 0) return false;
  return (prev - value) / prev > threshold;
}

// ---------------------------------------------------------------------------
// ダッシュボードの「経営の健康診断」
// ---------------------------------------------------------------------------

export const KPI_KEYS = [
  "contribution_rate",
  "break_even_bill",
  "break_even_ratio",
  "payout_rate",
  "bill_per_driver",
  "profit_per_driver",
  "bill_per_work_day",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPI_LABELS: Record<KpiKey, string> = {
  contribution_rate: "限界利益率",
  break_even_bill: "損益分岐点売上高",
  break_even_ratio: "損益分岐点比率",
  payout_rate: "支払比率",
  bill_per_driver: "ドライバー 1 人当たり売上",
  profit_per_driver: "ドライバー 1 人当たり利益",
  bill_per_work_day: "稼働 1 日当たり売上",
};

/** 指標の 1 行説明（専門用語を使わない言い方） */
export const KPI_DESCRIPTIONS: Record<KpiKey, string> = {
  contribution_rate: "売上のうち、支払と変動費を引いて手元に残る割合です。",
  break_even_bill: "赤字にならないために最低限必要な売上です（固定費 ÷ 限界利益率）。",
  break_even_ratio: "損益分岐点売上高が実際の売上の何 % にあたるかです。100% を超えると赤字です。",
  payout_rate: "売上のうち、ドライバーへの支払（税抜）が占める割合です。",
  bill_per_driver: "稼働したドライバー 1 人あたりの売上です。",
  profit_per_driver: "稼働したドライバー 1 人あたりの会社利益です。",
  bill_per_work_day: "日別の稼働報告 1 日あたりの売上です。",
};

export interface KpiMetric {
  key: KpiKey;
  label: string;
  /** 表示用の文字列（yen() / pct()） */
  text: string;
  /** 数値（計算できないときは null） */
  value: number | null;
  kind: KpiValueKind;
  description: string;
  tone: KpiTone;
  toneLabel: string;
  badge: KpiBadgeVariant;
  /** 数字が良くないときの「何をすればよいか」 */
  advice: string | null;
  change: KpiChange | null;
  /** 補足（母数など） */
  note: string | null;
}

function metric(input: Omit<KpiMetric, "toneLabel" | "badge">): KpiMetric {
  return { ...input, toneLabel: KPI_TONE_LABELS[input.tone], badge: KPI_TONE_BADGE[input.tone] };
}

/** 数字が無い月の見た目（"—"） */
const DASH = "—";

/**
 * ダッシュボードの「経営の健康診断」に並べる指標。
 * prev（前月）が無ければ前月比は付かない。
 */
export function buildKpiMetrics(current: KpiValues, prev: KpiValues | null): KpiMetric[] {
  const hasBill = current.bill > 0;
  const contributionJudge = hasBill ? judgeContributionRate(current.contributionRate) : judgement("info");
  const breakEvenJudge = judgeBreakEvenRatio(current.breakEvenRatio);
  const payoutJudge = hasBill ? judgePayoutRate(current.payoutRate) : judgement("info");

  // 損益分岐点売上高に届いていないときの「あと何円」
  const shortfall = current.breakEvenBill - current.bill;
  const breakEvenAdvice =
    current.breakEvenRatio == null
      ? current.bill > 0 && current.contribution <= 0
        ? "限界利益がマイナスのため損益分岐点を計算できません。単価と変動費を先に見直してください。"
        : null
      : shortfall > 0
        ? `あと ${yen(shortfall)} の売上で黒字になります。${breakEvenJudge.advice ?? ""}`.trim()
        : breakEvenJudge.advice;

  const perDriverBillDropped = droppedFromPrev(current.billPerDriver, prev?.billPerDriver ?? null);
  const perDriverProfitDropped = droppedFromPrev(current.profitPerDriver, prev?.profitPerDriver ?? null);
  const perDayDropped = droppedFromPrev(current.billPerWorkDay, prev?.billPerWorkDay ?? null);

  return [
    metric({
      key: "contribution_rate",
      label: KPI_LABELS.contribution_rate,
      text: hasBill ? pct(current.contributionRate) : DASH,
      value: hasBill ? current.contributionRate : null,
      kind: "rate",
      description: KPI_DESCRIPTIONS.contribution_rate,
      tone: contributionJudge.tone,
      advice: contributionJudge.advice,
      change: kpiChange("rate", hasBill ? current.contributionRate : null, prev?.contributionRate ?? null, true),
      note: `限界利益 ${yen(current.contribution)}`,
    }),
    metric({
      key: "break_even_bill",
      label: KPI_LABELS.break_even_bill,
      text: current.breakEvenRatio == null ? DASH : yen(current.breakEvenBill),
      value: current.breakEvenRatio == null ? null : current.breakEvenBill,
      kind: "money",
      description: KPI_DESCRIPTIONS.break_even_bill,
      tone: "info",
      advice: null,
      change: kpiChange("money", current.breakEvenBill, prev?.breakEvenBill ?? null, false),
      note: `固定費（管理費・調整を除く）${yen(current.netFixedCost)}`,
    }),
    metric({
      key: "break_even_ratio",
      label: KPI_LABELS.break_even_ratio,
      text: current.breakEvenRatio == null ? DASH : pct(current.breakEvenRatio),
      value: current.breakEvenRatio,
      kind: "rate",
      description: KPI_DESCRIPTIONS.break_even_ratio,
      tone: breakEvenJudge.tone,
      advice: breakEvenAdvice,
      change: kpiChange("rate", current.breakEvenRatio, prev?.breakEvenRatio ?? null, false),
      note: shortfall > 0 ? `損益分岐点まであと ${yen(shortfall)}` : current.breakEvenRatio == null ? null : `余裕 ${yen(-shortfall)}`,
    }),
    metric({
      key: "payout_rate",
      label: KPI_LABELS.payout_rate,
      text: hasBill ? pct(current.payoutRate) : DASH,
      value: hasBill ? current.payoutRate : null,
      kind: "rate",
      description: KPI_DESCRIPTIONS.payout_rate,
      tone: payoutJudge.tone,
      advice: payoutJudge.advice,
      change: kpiChange("rate", hasBill ? current.payoutRate : null, prev?.payoutRate ?? null, false),
      note: `支払（税抜）${yen(current.payout)}`,
    }),
    metric({
      key: "bill_per_driver",
      label: KPI_LABELS.bill_per_driver,
      text: current.activeDriverCount > 0 ? yen(current.billPerDriver) : DASH,
      value: current.activeDriverCount > 0 ? current.billPerDriver : null,
      kind: "money",
      description: KPI_DESCRIPTIONS.bill_per_driver,
      tone: perDriverBillDropped ? "warn" : "info",
      advice: perDriverBillDropped ? "前月より下がっています。稼働日数が減っていないか、稼働入力に漏れが無いか確認してください。" : null,
      change: kpiChange("money", current.activeDriverCount > 0 ? current.billPerDriver : null, prev?.billPerDriver ?? null, true),
      note: `稼働ドライバー ${current.activeDriverCount} 名`,
    }),
    metric({
      key: "profit_per_driver",
      label: KPI_LABELS.profit_per_driver,
      text: current.activeDriverCount > 0 ? yen(current.profitPerDriver) : DASH,
      value: current.activeDriverCount > 0 ? current.profitPerDriver : null,
      kind: "money",
      description: KPI_DESCRIPTIONS.profit_per_driver,
      tone: perDriverProfitDropped ? "warn" : "info",
      advice: perDriverProfitDropped ? "前月より下がっています。ドライバー別の採算で単価差額の小さい人を確認してください。" : null,
      change: kpiChange("money", current.activeDriverCount > 0 ? current.profitPerDriver : null, prev?.profitPerDriver ?? null, true),
      note: `会社利益 ${yen(current.profit)}`,
    }),
    metric({
      key: "bill_per_work_day",
      label: KPI_LABELS.bill_per_work_day,
      text: current.workDayCount > 0 ? yen(current.billPerWorkDay) : DASH,
      value: current.workDayCount > 0 ? current.billPerWorkDay : null,
      kind: "money",
      description: KPI_DESCRIPTIONS.bill_per_work_day,
      tone: perDayDropped ? "warn" : "info",
      advice: perDayDropped
        ? "前月より下がっています。単価の低い案件が増えていないか案件別採算で確認してください。"
        : current.workDayCount === 0
          ? "日別の稼働報告が無いため計算できません。「今日の報告」から稼働を登録すると出ます。"
          : null,
      change: kpiChange("money", current.workDayCount > 0 ? current.billPerWorkDay : null, prev?.billPerWorkDay ?? null, true),
      note: `稼働日 ${current.workDayCount} 日`,
    }),
  ];
}

export interface KpiHeadline {
  tone: KpiTone;
  /** 1 行のまとめ */
  text: string;
}

/** 「経営の健康診断」の見出し（いちばん伝えたい 1 行） */
export function kpiHeadline(v: KpiValues): KpiHeadline {
  if (!v.hasData) return { tone: "info", text: "この月のデータがまだありません。稼働と経費を登録すると診断できます。" };
  if (v.bill <= 0) return { tone: "info", text: "売上が登録されていないため診断できません。" };
  if (v.operatingProfit < 0) {
    return { tone: "bad", text: `営業赤字です（${yen(v.operatingProfit)}）。損益分岐点売上高 ${yen(v.breakEvenBill)} に届いていません。` };
  }
  const ratio = v.breakEvenRatio;
  if (ratio != null && ratio >= BREAK_EVEN_RATIO_OK) {
    return { tone: "warn", text: `黒字ですが余裕はわずかです（損益分岐点比率 ${pct(ratio)}）。固定費と単価を見直しましょう。` };
  }
  if (ratio != null && ratio < BREAK_EVEN_RATIO_GOOD) {
    return { tone: "good", text: `黒字で余裕があります（損益分岐点比率 ${pct(ratio)}／営業利益 ${yen(v.operatingProfit)}）。` };
  }
  return { tone: "ok", text: `黒字です（営業利益 ${yen(v.operatingProfit)}）。損益分岐点比率は ${ratio == null ? DASH : pct(ratio)} です。` };
}

/** 注意・危険の指標だけを取り出す（上に出す用） */
export function kpiAlerts(metrics: KpiMetric[]): KpiMetric[] {
  return metrics.filter((m) => (m.tone === "warn" || m.tone === "bad") && m.advice != null);
}
