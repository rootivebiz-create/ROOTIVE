/**
 * 代表ホームの信号（純関数）
 *
 * `v_executive_summary`（決裁・意思決定・保険・役員・重大なお知らせ）と
 * `v_month_pl`（今月の営業利益と目標）と `calcRunway()` の結果を 1 つの信号にまとめる。
 *
 * ■ 判定の順番と境界（上から順に見て、当てはまったいちばん重いものを採る）
 *   bad（すぐ手を打つ）… 次のどれか 1 つでも当てはまるとき
 *     - 現金が danger（30 日未満、または期間内に残高がマイナスの見込み）
 *     - 未対応の重大なお知らせが 1 件以上
 *     - 期限切れの決裁が 1 件以上
 *     - 稼働のある月で営業利益がマイナス
 *   warn（気にかける）… bad が無く、次のどれか 1 つでも当てはまるとき
 *     - 現金が watch（30〜89 日）
 *     - 決裁待ちが 1 件以上
 *     - 営業利益が目標の 80% 未満（営業利益の目標があるときだけ）
 *     - 見直し日の来た意思決定・満了が近い保険・任期が近い役員が 1 件以上
 *   good … どれにも当てはまらないとき
 *
 * 文章は日本語のみ。金額は `yen()`、率は `pct()`（小数 1 桁 %）で書く。
 * 基準日を持たない（日数の判定は `calcRunway()` が済ませている）ので `new Date()` は使わない。
 */
import { yen, pct } from "@/lib/format";
import type { ExecutiveSummary, MonthPl } from "@/lib/db/types";
import type { RunwayResult, RunwayStatus } from "./runway";

export type CockpitSignal = "good" | "warn" | "bad";

export const COCKPIT_SIGNAL_LABELS: Record<CockpitSignal, string> = {
  good: "順調",
  warn: "注意",
  bad: "要対応",
};

/** 理由は多くても 4 つまで */
export const MAX_COCKPIT_REASONS = 4;

/** 営業利益がこの達成率を下回ると warn */
export const COCKPIT_PROFIT_WARN_RATE = 0.8;

export interface CockpitInput {
  /** `v_executive_summary` の 1 行（無ければ null） */
  summary: ExecutiveSummary | null;
  /** 今月の `v_month_pl` の 1 行（無ければ null） */
  pl: MonthPl | null;
  /** 資金の見込み（無ければ null） */
  runway: RunwayResult | null;
}

export interface CockpitResult {
  signal: CockpitSignal;
  /** 一言（例「おおむね順調です」「決裁と資金繰りを見てください」） */
  headline: string;
  /** 日本語の短い文（多くても 4 つ） */
  reasons: string[];
  /** 判定に使った数字（画面のバッジで使う） */
  pendingApprovals: number;
  overdueApprovals: number;
  highAlerts: number;
  /** 見直し日の来た意思決定 ＋ 満了が近い保険 ＋ 任期が近い役員 */
  companyTasks: number;
  runwayStatus: RunwayStatus | null;
  /** 現金がもつ日数（資金の見込みが無ければ null） */
  holdDays: number | null;
  operatingProfit: number;
  profitTarget: number;
  /** 営業利益の達成率（目標が 0・未設定なら null） */
  profitAchievement: number | null;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 理由と見出しの並び順（代表が見る順。決裁 → 資金繰り → お知らせ → 利益 → 会社の手続き） */
type CockpitArea = "approval" | "cash" | "alert" | "profit" | "company";

const AREA_LABELS: Record<CockpitArea, string> = {
  approval: "決裁",
  cash: "資金繰り",
  alert: "お知らせ",
  profit: "利益",
  company: "会社の手続き",
};

const AREA_ORDER: CockpitArea[] = ["approval", "cash", "alert", "profit", "company"];

/** 会社の状態を 1 つの信号にまとめる */
export function calcCockpit(input: CockpitInput): CockpitResult {
  const s = input.summary;
  const pl = input.pl;
  const runway = input.runway;

  const pendingApprovals = num(s?.pending_approvals);
  const overdueApprovals = num(s?.overdue_approvals);
  const highAlerts = num(s?.high_alerts);
  const companyTasks = num(s?.due_reviews) + num(s?.expiring_insurance) + num(s?.expiring_officers);

  const operatingProfit = num(pl?.operating_profit);
  const profitTarget = num(pl?.profit_target);
  const entryCount = num(pl?.entry_count);
  const profitAchievement = profitTarget > 0 ? operatingProfit / profitTarget : null;
  const hasEntries = entryCount > 0;

  const runwayStatus = runway ? runway.status : null;

  // --- 信号 -----------------------------------------------------------------
  const bad =
    runwayStatus === "danger" || highAlerts > 0 || overdueApprovals > 0 || (hasEntries && operatingProfit < 0);
  const warn =
    runwayStatus === "watch" ||
    pendingApprovals > 0 ||
    (profitAchievement != null && profitAchievement < COCKPIT_PROFIT_WARN_RATE) ||
    companyTasks > 0;
  const signal: CockpitSignal = bad ? "bad" : warn ? "warn" : "good";

  // --- 理由（AREA_ORDER の順に、当てはまったものだけ） -----------------------
  const found = new Map<CockpitArea, string>();

  if (pendingApprovals > 0) {
    found.set(
      "approval",
      overdueApprovals > 0
        ? `決裁待ちが ${pendingApprovals} 件、うち ${overdueApprovals} 件は期限切れです。`
        : `決裁待ちが ${pendingApprovals} 件です。`,
    );
  } else if (overdueApprovals > 0) {
    found.set("approval", `期限切れの決裁が ${overdueApprovals} 件あります。`);
  }

  if (runway && runwayStatus !== "safe") {
    if (runway.zeroOn != null) {
      found.set("cash", `現金があと ${runway.daysLeft ?? 0} 日です（不足 ${yen(runway.shortfall)}）。`);
    } else if (runwayStatus === "danger") {
      found.set("cash", `資金の見込みが ${runway.holdDays} 日先までしかありません。`);
    } else {
      found.set("cash", `現金があと ${runway.holdDays} 日です。`);
    }
  }

  if (highAlerts > 0) {
    found.set("alert", `未対応の重大なお知らせが ${highAlerts} 件あります。`);
  }

  if (hasEntries && operatingProfit < 0) {
    found.set("profit", `今月の営業利益が ${yen(operatingProfit)} です。`);
  } else if (profitAchievement != null && profitAchievement < COCKPIT_PROFIT_WARN_RATE) {
    found.set("profit", `営業利益が目標の ${pct(profitAchievement)} です。`);
  }

  if (companyTasks > 0) {
    found.set("company", `期限の近い会社の手続きが ${companyTasks} 件あります。`);
  }

  const areas = AREA_ORDER.filter((a) => found.has(a));
  const reasons = areas.slice(0, MAX_COCKPIT_REASONS).map((a) => found.get(a) as string);

  return {
    signal,
    headline: cockpitHeadline(signal, areas),
    reasons,
    pendingApprovals,
    overdueApprovals,
    highAlerts,
    companyTasks,
    runwayStatus,
    holdDays: runway ? runway.holdDays : null,
    operatingProfit,
    profitTarget,
    profitAchievement,
  };
}

/** 一言。見るべきところを多くても 2 つまで並べる */
function cockpitHeadline(signal: CockpitSignal, areas: readonly CockpitArea[]): string {
  if (signal === "good" || areas.length === 0) {
    return signal === "good" ? "おおむね順調です" : "数字を見てください";
  }
  const names = areas.slice(0, 2).map((a) => AREA_LABELS[a]);
  return `${names.join("と")}を見てください`;
}
