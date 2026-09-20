/**
 * 朝のひとこと（純関数）— LINE と画面の両方で使う
 *
 * `calcCockpit()` / `calcRunway()` / `explainVariance()` の結果だけで組み立てる。
 * AI は使わない（`ANTHROPIC_API_KEY` が無くても数字だけで成立させる）。
 * 言い回しと組み立ては週次サマリー（`lib/weekly/`）にそろえ、折り返しも `wrapText` を使い回す。
 *
 * ■ 組み立て（上から順に、200 字の目安に収まるぶんだけ）
 *   1 行目　日付 ― 信号の一言（例「9月20日 ― おおむね順調です」）
 *   本文　　決裁待ち → 現金 → 今月の着地 → いちばん大きい予実の差 の順に短く
 *   何も言うことが無ければ「今日は特にありません。」で終える
 *
 * 基準日は必ず引数（date）で受け取る。`new Date()` / `Date.now()` には依存しない。
 */
import { formatMonthDayJa } from "@/components/cashflow/helpers";
import { pct, yen } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { wrapText } from "@/lib/weekly";
import type { CockpitResult } from "./cockpit";
import type { RunwayResult } from "./runway";
import { biggestVariance, type VarianceItem } from "./variance";

/** 文章の目安の長さ（これを超えたら次の文を足さない） */
export const BRIEF_TARGET_LENGTH = 200;
/** 文章の上限（1 行目を入れてもここは超えない） */
export const BRIEF_MAX_LENGTH = 240;

/** 何も言うことが無いときの締め */
export const BRIEF_EMPTY_TEXT = "今日は特にありません。";

/** 今月の着地見込み（`lib/calc/forecast.ts` の `forecastMonth()` の結果をそのまま渡せる形） */
export interface BriefForecast {
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 月末の売上の見込み */
  billForecast: number;
  /** 月末の営業利益の見込み */
  operatingProfitForecast: number;
  /** 営業利益の達成率（目標が未設定なら null） */
  profitTargetRate: number | null;
}

export interface ExecutiveBriefInput {
  /** 基準日 "YYYY-MM-DD" */
  date: string;
  cockpit: CockpitResult;
  /** 資金の見込み（無ければ null） */
  runway?: RunwayResult | null;
  /** 今月の着地見込み（無ければ null） */
  forecast?: BriefForecast | null;
  /** 予実の差（`explainVariance()` の結果。空配列なら触れない） */
  variance?: readonly VarianceItem[];
  /** 折り返しの幅（LINE 用。0・未指定なら折り返さない） */
  width?: number;
}

/** 文字数（コードポイント数で数える） */
function lengthOf(text: string): number {
  return [...text].length;
}

/** 決裁待ちの 1 文（無ければ null） */
function approvalSentence(c: CockpitResult): string | null {
  if (c.pendingApprovals > 0) {
    return c.overdueApprovals > 0
      ? `決裁待ちが ${c.pendingApprovals} 件、うち ${c.overdueApprovals} 件は期限切れです。`
      : `決裁待ちが ${c.pendingApprovals} 件です。`;
  }
  if (c.overdueApprovals > 0) return `期限切れの決裁が ${c.overdueApprovals} 件あります。`;
  return null;
}

/** 現金の 1 文（余裕があるときは触れない） */
function cashSentence(runway: RunwayResult | null | undefined): string | null {
  if (!runway || runway.status === "safe") return null;
  if (runway.zeroOn != null) {
    return `現金はあと ${runway.daysLeft ?? 0} 日で、${formatMonthDayJa(runway.zeroOn)}に ${yen(runway.shortfall)} 足りなくなる見込みです。`;
  }
  return `現金はあと ${runway.holdDays} 日です。`;
}

/** 今月の着地の 1 文 */
function forecastSentence(f: BriefForecast | null | undefined): string | null {
  if (!f || !f.month) return null;
  const rate = f.profitTargetRate != null ? `（目標の ${pct(f.profitTargetRate)}）` : "";
  return `${formatMonthJa(f.month)}の着地は売上 ${yen(f.billForecast)}・営業利益 ${yen(f.operatingProfitForecast)}${rate}の見込みです。`;
}

/** いちばん大きい予実の差の 1 文 */
function varianceSentence(items: readonly VarianceItem[] | undefined): string | null {
  const top = biggestVariance(items ?? []);
  if (!top) return null;
  const move = top.direction === "minus" ? "押し下げています" : "押し上げています";
  return `予実の差は${top.label}がいちばん大きく、営業利益を ${yen(Math.abs(top.amount))} ${move}。`;
}

/**
 * 200 字程度の「朝のひとこと」を組み立てる。
 * 上限（240 字）を超えそうな文は足さないので、途中で切れた文にはならない。
 */
export function executiveBrief(input: ExecutiveBriefInput): string {
  const head = `${formatMonthDayJa(input.date)} ― ${input.cockpit.headline}`;

  const sentences = [
    approvalSentence(input.cockpit),
    cashSentence(input.runway),
    forecastSentence(input.forecast),
    varianceSentence(input.variance),
  ].filter((s): s is string => s != null && s.length > 0);

  const body: string[] = [];
  let used = 0;
  for (const s of sentences) {
    const n = lengthOf(s);
    if (used > 0 && used + n > BRIEF_MAX_LENGTH) continue;
    if (used > 0 && used >= BRIEF_TARGET_LENGTH) continue;
    body.push(s);
    used += n;
  }
  if (body.length === 0) body.push(BRIEF_EMPTY_TEXT);

  const text = `${head}\n${body.join("")}`;
  const width = input.width ?? 0;
  return width > 0 ? wrapText(text, width) : text;
}
