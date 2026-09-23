/** 料金の組み立て（純関数）。金額は site.config.ts の PLANS だけを見る（画面や資料に金額を直書きしない） */
import { compactYen } from "@/lib/format";
import { PLANS, type Plan } from "@/site.config";

/** 月額のない「お試し」（無ければ null） */
export function trialPlan(plans: Plan[] = PLANS): Plan | null {
  return plans.find((p) => p.monthlyYen === 0) ?? null;
}

/** 構築して毎月使うパック（月額のあるもの） */
export function buildPlans(plans: Plan[] = PLANS): Plan[] {
  return plans.filter((p) => p.monthlyYen > 0);
}

/** 「お試し5万円・月額1.8万円から（税抜）」 */
export function priceSummary(plans: Plan[] = PLANS): string {
  const trial = trialPlan(plans);
  const packs = buildPlans(plans);
  const parts: string[] = [];
  if (trial) parts.push(`お試し${compactYen(trial.initialYen)}`);
  if (packs.length > 0) parts.push(`月額${compactYen(Math.min(...packs.map((p) => p.monthlyYen)))}から`);
  return parts.length > 0 ? `${parts.join("・")}（税抜）` : "";
}

/** 構築にかかる期間の幅（パックの weeks の数字から）。「4〜6週間」、approx なら「約4〜6週間」。読めなければ undefined */
export function buildWeeksText(approx = false, plans: Plan[] = PLANS): string | undefined {
  const weeks = buildPlans(plans)
    .map((p) => Number(/(\d+)/.exec(p.weeks)?.[1]))
    .filter((n) => Number.isFinite(n));
  if (weeks.length === 0) return undefined;
  const min = Math.min(...weeks);
  const max = Math.max(...weeks);
  return `${approx ? "約" : ""}${min === max ? min : `${min}〜${max}`}週間`;
}
