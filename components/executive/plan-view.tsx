"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Pencil, Plus, Target, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ensurePlanYearsAction, spreadPlanYearAction } from "@/lib/actions/plans";
import type { Plan, PlanYearActual } from "@/lib/db/types";
import type { FiscalSettings } from "@/lib/fiscal";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACHIEVEMENT_TEXT, achievementTone, planRangeLabel, planYearLabel } from "./helpers";
import { PlanDialog } from "./plan-dialog";
import { PlanYearDialog } from "./plan-year-dialog";

export interface PlanViewProps {
  plans: Plan[];
  /** 選ばれている計画（?plan=） */
  selectedPlan: Plan | null;
  /** 選ばれている計画の期ごとの目標と実績（year は期の決算の年。0031） */
  years: PlanYearActual[];
  /** 今期の決算の年（日本時間の今日が入る期） */
  thisYear: number;
  /** 決算月と設立日（「第3期（2025年10月〜2026年9月）」の見出しに使う） */
  fiscal: FiscalSettings;
}

/** 配分のしかた（DB の spread_plan_year と同じ 2 つ） */
const WEIGHTS: { key: "even" | "actual"; label: string; hint: string }[] = [
  { key: "even", label: "均等（月の数で割る）", hint: "端数は決算月でまとめます。第1期のように 12 か月より短い期は、その月の数で割ります。" },
  { key: "actual", label: "前期の月の構成比", hint: "前期の同じ月の売上の形に合わせて配ります（前期の実績が無いときは均等）。" },
];

export function PlanView({ plans, selectedPlan, years, thisYear, fiscal }: PlanViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editingYear, setEditingYear] = useState<PlanYearActual | null>(null);
  const [spreading, setSpreading] = useState<PlanYearActual | null>(null);

  const totals = useMemo(
    () => ({
      billTarget: years.reduce((s, y) => s + Number(y.bill_target ?? 0), 0),
      billActual: years.reduce((s, y) => s + Number(y.bill_actual ?? 0), 0),
      profitTarget: years.reduce((s, y) => s + Number(y.profit_target ?? 0), 0),
      profitActual: years.reduce((s, y) => s + Number(y.profit_actual ?? 0), 0),
    }),
    [years],
  );

  /** 計画を選ぶ（?plan=）。ほかのパラメータは引き継ぐ */
  const planHref = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("plan", id);
    return `${pathname}?${sp.toString()}`;
  };

  const ensureYears = () => {
    if (!selectedPlan) return;
    startTransition(async () => {
      const res = await ensurePlanYearsAction(selectedPlan.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "計画の期を用意しました");
      router.refresh();
    });
  };

  /** 期の見出し（「第3期」と「2025年10月〜2026年9月」） */
  const yearLabel = (y: PlanYearActual) => planYearLabel(y.year ?? thisYear, fiscal);

  const achievement = (rate: number | null) => {
    const tone = achievementTone(rate);
    return <span className={cn("num", ACHIEVEMENT_TEXT[tone])}>{rate == null ? "—" : pct(rate)}</span>;
  };

  return (
    <div>
      <PageHeader
        title="中期計画"
        description="3 か年などの目標と、その期の実績（期の月の合計）を見比べます。期の目標は月へ配ると、ダッシュボードの進捗バーと財務の予算に効きます。"
        actions={
          <>
            {selectedPlan && (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditingPlan(selectedPlan)} disabled={pending}>
                  <Pencil /> 計画を編集
                </Button>
                <Button variant="outline" size="sm" onClick={ensureYears} disabled={pending}>
                  <CalendarRange /> 期を用意する
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
              <Plus /> 計画を作る
            </Button>
          </>
        }
      />

      {plans.length === 0 ? (
        <Empty title="まだ中期計画がありません" description="「計画を作る」から、期間（例: 第3期〜第5期）と、どうなっていたいかを書いてください。期ごとの行は自動で用意されます。">
          <Target className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <div className="space-y-4">
          {/* 計画の切り替え */}
          {plans.length > 1 && (
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="inline-flex gap-1 rounded-md bg-muted p-1">
                {plans.map((p) => (
                  <Link
                    key={p.id}
                    href={planHref(p.id)}
                    aria-current={selectedPlan?.id === p.id ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                      selectedPlan?.id === p.id && "bg-card text-foreground shadow",
                    )}
                  >
                    {p.name}
                    {!p.is_active && <span className="text-xs">（終了）</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {selectedPlan && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {selectedPlan.name}
                  <Badge variant={selectedPlan.is_active ? "default" : "secondary"}>{selectedPlan.is_active ? "進行中" : "終了"}</Badge>
                  <span className="num text-sm font-normal text-muted-foreground" data-testid="plan-range">
                    {planRangeLabel(selectedPlan.from_year, selectedPlan.to_year, fiscal).label}（{planRangeLabel(selectedPlan.from_year, selectedPlan.to_year, fiscal).range}）
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedPlan.vision ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selectedPlan.vision}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">どうなっていたいか（ビジョン）はまだ書かれていません。「計画を編集」から書けます。</p>
                )}
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">売上の目標（期間の合計）</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                      <Money value={totals.billTarget} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">売上の実績</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                      <Money value={totals.billActual} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">営業利益の目標</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                      <Money value={totals.profitTarget} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">営業利益の実績</dt>
                    <dd className="mt-0.5 text-base font-semibold">
                      <Money value={totals.profitActual} />
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          {years.length === 0 ? (
            <Empty title="この計画にはまだ期がありません" description="「期を用意する」を押すと、期間ぶんの期（目標を入れる行）が作られます。">
              <Button onClick={ensureYears} disabled={pending}>
                <CalendarRange /> 期を用意する
              </Button>
            </Empty>
          ) : (
            <>
              {/* スマホ：カード */}
              <ul className="space-y-2 md:hidden">
                {years.map((y) => (
                  <li key={y.id}>
                    <Card className={cn("p-3", y.year === thisYear && "ring-2 ring-ring")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-base font-semibold">{yearLabel(y).label}</span>
                          <span className="num block text-xs text-muted-foreground">{yearLabel(y).range}</span>
                        </span>
                        {y.year === thisYear && <Badge variant="outline">今期</Badge>}
                      </div>
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">売上</dt>
                          <dd className="text-right">
                            <Money value={y.bill_actual} /> <span className="text-xs text-muted-foreground">/ 目標</span> <Money value={y.bill_target} className="inline" />
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">売上の達成率</dt>
                          <dd className="text-right">{achievement(y.bill_achievement)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">営業利益</dt>
                          <dd className="text-right">
                            <Money value={y.profit_actual} /> <span className="text-xs text-muted-foreground">/ 目標</span> <Money value={y.profit_target} className="inline" />
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">利益の達成率</dt>
                          <dd className="text-right">{achievement(y.profit_achievement)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">差額（利益）</dt>
                          <dd className="text-right">
                            <Money value={y.profit_diff} />
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">ドライバー</dt>
                          <dd className="num text-right">
                            {y.driver_actual ?? 0} 名 <span className="text-xs text-muted-foreground">/ 目標 {y.driver_target ?? 0} 名</span>
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingYear(y)} disabled={pending}>
                          <Pencil /> 目標を入れる
                        </Button>
                        <Button variant="secondary" size="sm" className="flex-1" onClick={() => setSpreading(y)} disabled={pending}>
                          <Wand2 /> 月へ配る
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>

              {/* PC：表 */}
              <Card className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">期</TableHead>
                      <TableHead className="text-right">売上の目標</TableHead>
                      <TableHead className="text-right">売上の実績</TableHead>
                      <TableHead className="text-right">達成率</TableHead>
                      <TableHead className="text-right">利益の目標</TableHead>
                      <TableHead className="text-right">利益の実績</TableHead>
                      <TableHead className="text-right">達成率</TableHead>
                      <TableHead className="text-right">差額</TableHead>
                      <TableHead className="text-right">ドライバー</TableHead>
                      <TableHead className="pr-4 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {years.map((y) => (
                      <TableRow key={y.id} className={cn(y.year === thisYear && "bg-muted/60")}>
                        <TableCell className="whitespace-nowrap pl-4 font-medium">
                          {yearLabel(y).label}
                          {y.year === thisYear && <span className="ml-1 text-xs text-muted-foreground">今期</span>}
                          <span className="num block text-xs font-normal text-muted-foreground">{yearLabel(y).range}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={y.bill_target} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={y.bill_actual} />
                        </TableCell>
                        <TableCell className="text-right">{achievement(y.bill_achievement)}</TableCell>
                        <TableCell className="text-right">
                          <Money value={y.profit_target} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={y.profit_actual} />
                        </TableCell>
                        <TableCell className="text-right">{achievement(y.profit_achievement)}</TableCell>
                        <TableCell className="text-right">
                          <Money value={y.profit_diff} />
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-right">
                          {y.driver_actual ?? 0} / {y.driver_target ?? 0} 名
                        </TableCell>
                        <TableCell className="whitespace-nowrap pr-4 text-right">
                          <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditingYear(y)}>
                            目標
                          </button>
                          <button type="button" className="ml-3 text-sm text-primary underline-offset-2 hover:underline" onClick={() => setSpreading(y)}>
                            月へ配る
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              <p className="text-xs text-muted-foreground">
                実績はその期の月次の合計（v_month_pl。{fiscal.fiscalMonth}月決算で区切る）です。達成率が 100% を超えると緑、80% を切ると赤で出ます。
              </p>
            </>
          )}
        </div>
      )}

      <PlanDialog open={creating} onOpenChange={setCreating} plan={null} thisYear={thisYear} fiscal={fiscal} />
      <PlanDialog open={editingPlan != null} onOpenChange={(v) => !v && setEditingPlan(null)} plan={editingPlan} thisYear={thisYear} fiscal={fiscal} />
      <PlanYearDialog open={editingYear != null} onOpenChange={(v) => !v && setEditingYear(null)} year={editingYear} fiscal={fiscal} />
      <SpreadDialog year={spreading} fiscal={fiscal} onOpenChange={(v) => !v && setSpreading(null)} />
    </div>
  );
}

/** 期の目標をその期の月へ配る（按分そのものは DB の spread_plan_year が行う） */
function SpreadDialog({ year, fiscal, onOpenChange }: { year: PlanYearActual | null; fiscal: FiscalSettings; onOpenChange: (open: boolean) => void }) {
  const heading = year?.year != null ? planYearLabel(year.year, fiscal) : null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weight, setWeight] = useState<"even" | "actual">("even");

  const submit = () => {
    if (!year?.plan_id || year.year == null) return;
    startTransition(async () => {
      const res = await spreadPlanYearAction({ plan_id: year.plan_id as string, year: year.year as number, weight });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "期の目標を月へ配りました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={year != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading ? `${heading.label}の目標を月へ配る` : "目標を月へ配る"}</DialogTitle>
          <DialogDescription>
            期の目標を{heading ? `${heading.range}の` : ""}月次目標（month_targets）にします。手で入れてある月は書き換えません。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="spread-weight">配り方</Label>
          <Select id="spread-weight" value={weight} onChange={(e) => setWeight(e.target.value as "even" | "actual")} disabled={pending}>
            {WEIGHTS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{WEIGHTS.find((w) => w.key === weight)?.hint}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <Wand2 /> {pending ? "配っています…" : "月へ配る"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
