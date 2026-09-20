import { requirePageRole } from "@/lib/auth/session";
import { loadPlanYearActuals, loadPlans } from "@/lib/executive/queries";
import { todayJST, yearOfDate } from "@/lib/finance/date";
import { uuidSchema } from "@/lib/schemas/common";
import { PlanView } from "@/components/executive/plan-view";

export const metadata = { title: "中期計画" };

/** URL の ?plan= を UUID として読む（不正なら null） */
function planIdFromParam(param: string | string[] | undefined): string | null {
  const v = Array.isArray(param) ? param[0] : param;
  const parsed = uuidSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/**
 * 中期計画と予実（/executive/plan）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。計画の切り替えは ?plan=<uuid>（既定は進行中の計画のうち新しいもの）。
 * 年ごとの実績は DB のビュー v_plan_year_actual（v_month_pl の暦年合計）をそのまま出す。
 */
export default async function ExecutivePlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, company } = await requirePageRole(["owner"]);

  const plans = await loadPlans(supabase, company.id);
  const requestedId = planIdFromParam(sp.plan);
  const selectedPlan = plans.find((p) => p.id === requestedId) ?? plans.find((p) => p.is_active) ?? plans[0] ?? null;
  const years = selectedPlan ? await loadPlanYearActuals(supabase, company.id, selectedPlan.id) : [];

  return <PlanView plans={plans} selectedPlan={selectedPlan} years={years} thisYear={yearOfDate(todayJST())} />;
}
