"use client";

import { useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty } from "@/components/ui/empty";
import { ExportMenu } from "@/components/ui/export-menu";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DailyLaborRow, DriverMonthLaborRow } from "@/lib/db/types";
import { formatWorkDate, isoToJstDate, isoToJstTime } from "@/lib/daily/helpers";
import { exportUrls } from "@/lib/exports/urls";
import { qty as qtyText } from "@/lib/format";
import {
  DEFAULT_LABOR_STANDARDS,
  formatMinutes,
  isAttentionDay,
  laborActionLine,
  laborAdvice,
  laborRiskLevel,
  laborTone,
  monthLaborSummary,
  summaryRiskLevel,
  type LaborTone,
} from "@/lib/labor/helpers";
import { cn } from "@/lib/utils";

/** 判定の色 → バッジの見た目 */
const TONE_BADGE: Record<LaborTone, BadgeProps["variant"]> = {
  normal: "secondary",
  warning: "warning",
  danger: "destructive",
  muted: "outline",
};

/** 行の背景（注意・危険だけ薄く色を付ける） */
const TONE_ROW: Record<LaborTone, string> = {
  normal: "",
  warning: "bg-warning/5",
  danger: "bg-destructive/5",
  muted: "",
};

/** いちばん重い判定を返す（危険 > 注意 > 通常） */
function rowTone(row: DailyLaborRow): LaborTone {
  const tones = [laborTone(row.duty_status, "duty").tone, laborTone(row.rest_status, "rest").tone, laborTone(row.break_status, "break").tone];
  if (tones.includes("danger")) return "danger";
  if (tones.includes("warning")) return "warning";
  return "normal";
}

function StatusBadge({ status, kind }: { status: string | null | undefined; kind: "duty" | "rest" | "break" }) {
  const { tone, label } = laborTone(status, kind);
  if (tone === "muted") return <span className="text-xs text-muted-foreground">{label}</span>;
  return <Badge variant={TONE_BADGE[tone]}>{label}</Badge>;
}

/** 数字を 1 つ見せる小さなカード */
function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: LaborTone }) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("num mt-1 text-base font-bold md:text-xl", tone === "warning" && "text-warning", tone === "danger" && "text-destructive")}>{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/** 開始・終了の時刻（日をまたいだ終了は「翌」を付ける） */
function timeText(iso: string | null | undefined, workDate: string | null | undefined): string {
  const t = isoToJstTime(iso);
  if (t === "") return "—";
  const d = isoToJstDate(iso);
  return workDate && d !== "" && d !== workDate ? `翌 ${t}` : t;
}

export interface LaborPanelProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 日ごとの労務（v_daily_labor） */
  days: DailyLaborRow[];
  /** ドライバー × 月の労務（v_driver_month_labor） */
  driverMonths: DriverMonthLaborRow[];
}

/** 労務（/daily?tab=labor）：拘束時間・実働・休息期間・連続勤務の見える化 */
export function LaborPanel({ month, days, driverMonths }: LaborPanelProps) {
  const [driverId, setDriverId] = useState<string>("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const summary = useMemo(() => monthLaborSummary(driverMonths), [driverMonths]);
  const risk = useMemo(() => summaryRiskLevel(summary), [summary]);
  const maxConsecutive = driverMonths[0]?.labor_max_consecutive_days ?? DEFAULT_LABOR_STANDARDS.labor_max_consecutive_days;

  /** ドライバー名（v_daily_labor には名前が無いので月次の行から引く） */
  const driverName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of driverMonths) if (r.driver_id) map.set(r.driver_id, r.driver_name ?? "");
    return map;
  }, [driverMonths]);

  const filtered = useMemo(
    () =>
      days.filter((d) => {
        if (driverId !== "" && d.driver_id !== driverId) return false;
        if (onlyAttention && !isAttentionDay(d, maxConsecutive)) return false;
        return true;
      }),
    [days, driverId, onlyAttention, maxConsecutive],
  );

  const showDriver = (id: string | null | undefined) => {
    setDriverId(id ?? "");
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (days.length === 0) {
    return (
      <div className="space-y-3">
        <Empty
          title="開始・終了の時刻が入っている日報がありません。"
          description="「今日の報告」で出発時刻と終了時刻を入れると、拘束時間が自動で出ます。"
        />
        <LaborNote />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 月のまとめ */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="対象日数" value={`${summary.measuredDays} 日`} sub={`日報 ${summary.reportDays} 件`} />
        <StatCard label="拘束の合計" value={formatMinutes(summary.dutyMinutesTotal)} sub={`実働 ${formatMinutes(summary.workMinutesTotal)}`} />
        <StatCard label="拘束の平均" value={formatMinutes(summary.dutyMinutesAvg)} sub={`最長 ${formatMinutes(summary.dutyMinutesMax)}`} />
        <StatCard
          label="長い拘束の日数"
          value={`${summary.overDutyDays} 日`}
          sub={summary.severeDutyDays > 0 ? `うち上限超 ${summary.severeDutyDays} 日` : undefined}
          tone={summary.severeDutyDays > 0 ? "danger" : summary.overDutyDays > 0 ? "warning" : "normal"}
        />
        <StatCard
          label="休息不足の日数"
          value={`${summary.shortRestDays} 日`}
          sub={summary.severeRestDays > 0 ? `うち下限割れ ${summary.severeRestDays} 日` : undefined}
          tone={summary.severeRestDays > 0 ? "danger" : summary.shortRestDays > 0 ? "warning" : "normal"}
        />
        <StatCard
          label="連続勤務の最大"
          value={`${summary.maxConsecutiveDays} 日`}
          sub={`上限 ${maxConsecutive} 日`}
          tone={summary.consecutiveOverDrivers > 0 ? "danger" : "normal"}
        />
      </div>

      {/* 危険・注意のときだけ、何をすればよいかを 1 行で */}
      {risk.level !== "good" && (
        <Alert variant={risk.level === "danger" ? "destructive" : "warning"}>
          <p className="font-medium">
            <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />
            {risk.label}：{risk.summary}
          </p>
          <p className="mt-1 text-sm">{laborActionLine(risk)}</p>
        </Alert>
      )}

      {/* ドライバー別 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">ドライバー別</h2>
          <ExportMenu
            label="労務"
            items={[
              { label: "日別 CSV", href: exportUrls.laborCsv(month, "day") },
              { label: "日別 Excel", href: exportUrls.laborXlsx(month, "day") },
              { label: "月別 CSV", href: exportUrls.laborCsv(month, "month") },
              { label: "月別 Excel", href: exportUrls.laborXlsx(month, "month") },
            ]}
          />
        </div>

        {/* PC：表 */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ドライバー</TableHead>
                <TableHead className="text-right">稼働日数</TableHead>
                <TableHead className="text-right">拘束の合計</TableHead>
                <TableHead className="text-right">平均</TableHead>
                <TableHead className="text-right">最大</TableHead>
                <TableHead className="text-right">長い拘束</TableHead>
                <TableHead className="text-right">休息不足</TableHead>
                <TableHead className="text-right">連続勤務</TableHead>
                <TableHead>判定</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {driverMonths.map((r) => {
                const dr = laborRiskLevel(r);
                const over = Number(r.over_duty_days ?? 0) + Number(r.severe_duty_days ?? 0);
                const short = Number(r.short_rest_days ?? 0) + Number(r.severe_rest_days ?? 0);
                return (
                  <TableRow
                    key={r.driver_id ?? r.driver_name ?? ""}
                    className={cn("cursor-pointer", dr.level === "danger" && "bg-destructive/5", dr.level === "caution" && "bg-warning/5")}
                    onClick={() => showDriver(r.driver_id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${r.driver_name || "—"} の日ごとの明細を見る`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        showDriver(r.driver_id);
                      }
                    }}
                  >
                    <TableCell className="whitespace-nowrap font-medium">{r.driver_name || "—"}</TableCell>
                    <TableCell className="num text-right">{r.measured_days ?? 0}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">{formatMinutes(r.duty_minutes_total)}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">{formatMinutes(r.duty_minutes_avg)}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">{formatMinutes(r.duty_minutes_max)}</TableCell>
                    <TableCell className={cn("num text-right", over > 0 && "text-warning")}>{over} 日</TableCell>
                    <TableCell className={cn("num text-right", short > 0 && "text-warning")}>{short} 日</TableCell>
                    <TableCell className={cn("num text-right", r.consecutive_over && "text-destructive")}>{r.max_consecutive_days ?? 0} 日</TableCell>
                    <TableCell>
                      <Badge variant={dr.level === "danger" ? "destructive" : dr.level === "caution" ? "warning" : "secondary"}>{dr.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* スマホ：カード */}
        <ul className="space-y-2 md:hidden">
          {driverMonths.map((r) => {
            const dr = laborRiskLevel(r);
            const over = Number(r.over_duty_days ?? 0) + Number(r.severe_duty_days ?? 0);
            const short = Number(r.short_rest_days ?? 0) + Number(r.severe_rest_days ?? 0);
            return (
              <li key={r.driver_id ?? r.driver_name ?? ""}>
                <button type="button" className="w-full text-left" onClick={() => showDriver(r.driver_id)}>
                  <Card className={cn(dr.level === "danger" && "border-destructive/40", dr.level === "caution" && "border-warning/40")}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{r.driver_name || "—"}</p>
                        <Badge variant={dr.level === "danger" ? "destructive" : dr.level === "caution" ? "warning" : "secondary"}>{dr.label}</Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">稼働日数</dt>
                          <dd className="num">{r.measured_days ?? 0} 日</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">連続勤務</dt>
                          <dd className={cn("num", r.consecutive_over && "text-destructive")}>{r.max_consecutive_days ?? 0} 日</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">拘束の合計</dt>
                          <dd className="num">{formatMinutes(r.duty_minutes_total)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">平均</dt>
                          <dd className="num">{formatMinutes(r.duty_minutes_avg)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">長い拘束</dt>
                          <dd className={cn("num", over > 0 && "text-warning")}>{over} 日</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">休息不足</dt>
                          <dd className={cn("num", short > 0 && "text-warning")}>{short} 日</dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 日ごとの明細 */}
      <section ref={detailRef} className="space-y-2 scroll-mt-4">
        <h2 className="text-base font-semibold">日ごとの明細</h2>

        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-2">
          <div className="space-y-1">
            <Label htmlFor="labor-driver">ドライバー</Label>
            <Select id="labor-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-44">
              <option value="">すべて</option>
              {driverMonths.map((r) => (
                <option key={r.driver_id ?? ""} value={r.driver_id ?? ""}>
                  {r.driver_name || "—"}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex h-11 items-center gap-2 text-sm md:h-10">
            <Checkbox checked={onlyAttention} onCheckedChange={(v) => setOnlyAttention(v === true)} aria-label="注意が必要な日だけ表示する" />
            注意が必要な日だけ
          </label>
          <p className="ml-auto text-xs text-muted-foreground">
            <span className="num">{filtered.length}</span> 件
          </p>
        </div>

        {filtered.length === 0 ? (
          <Empty title="条件に合う日がありません" description="ドライバーの絞り込みや「注意が必要な日だけ」を外してみてください。" />
        ) : (
          <>
            {/* PC：表 */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日付</TableHead>
                    <TableHead>ドライバー</TableHead>
                    <TableHead className="text-right">開始</TableHead>
                    <TableHead className="text-right">終了</TableHead>
                    <TableHead className="text-right">拘束</TableHead>
                    <TableHead className="text-right">休憩</TableHead>
                    <TableHead className="text-right">実働</TableHead>
                    <TableHead className="text-right">休息</TableHead>
                    <TableHead className="text-right">連続</TableHead>
                    <TableHead>判定</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => {
                    const tone = rowTone(d);
                    const advice = laborAdvice(d, maxConsecutive);
                    return (
                      <TableRow key={d.id ?? `${d.work_date}-${d.driver_id}`} className={TONE_ROW[tone]}>
                        <TableCell className="whitespace-nowrap">{formatWorkDate(d.work_date ?? "")}</TableCell>
                        <TableCell className="whitespace-nowrap">{(d.driver_id ? driverName.get(d.driver_id) : "") || "—"}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{timeText(d.start_at, d.work_date)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{timeText(d.end_at, d.work_date)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{formatMinutes(d.duty_minutes)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{formatMinutes(d.break_minutes)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{formatMinutes(d.work_minutes)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{formatMinutes(d.rest_minutes)}</TableCell>
                        <TableCell className="num text-right">{d.consecutive_days ?? 0}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge status={d.duty_status} kind="duty" />
                            <StatusBadge status={d.rest_status} kind="rest" />
                            <StatusBadge status={d.break_status} kind="break" />
                          </div>
                          {advice !== "" && <p className="mt-1 max-w-80 break-words text-xs text-muted-foreground">{advice}</p>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* スマホ：カード */}
            <ul className="space-y-2 md:hidden">
              {filtered.map((d) => {
                const tone = rowTone(d);
                const advice = laborAdvice(d, maxConsecutive);
                return (
                  <li key={d.id ?? `${d.work_date}-${d.driver_id}`}>
                    <Card className={cn(tone === "danger" && "border-destructive/40", tone === "warning" && "border-warning/40")}>
                      <CardContent className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">
                            {formatWorkDate(d.work_date ?? "")}
                            <span className="ml-1">{(d.driver_id ? driverName.get(d.driver_id) : "") || "—"}</span>
                          </p>
                          <p className="num shrink-0 text-right text-sm">
                            {timeText(d.start_at, d.work_date)} 〜 {timeText(d.end_at, d.work_date)}
                          </p>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">拘束</dt>
                            <dd className="num">{formatMinutes(d.duty_minutes)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">休憩</dt>
                            <dd className="num">{formatMinutes(d.break_minutes)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">実働</dt>
                            <dd className="num">{formatMinutes(d.work_minutes)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">休息</dt>
                            <dd className="num">{formatMinutes(d.rest_minutes)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">連続勤務</dt>
                            <dd className="num">{d.consecutive_days ?? 0} 日目</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">走行</dt>
                            <dd className="num">{qtyText(d.distance_km)} km</dd>
                          </div>
                        </dl>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={d.duty_status} kind="duty" />
                          <StatusBadge status={d.rest_status} kind="rest" />
                          <StatusBadge status={d.break_status} kind="break" />
                        </div>
                        {advice !== "" && <p className="break-words text-xs text-muted-foreground">{advice}</p>}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <LaborNote />
    </div>
  );
}

/** 画面のいちばん下の注記 */
function LaborNote() {
  return (
    <p className="text-xs text-muted-foreground">
      改善基準告示は一般貨物自動車運送事業の運転者が対象です。軽貨物の業務委託には直接は適用されませんが、事故を防ぐ目安として使っています。基準は 設定 → 安全管理 で変えられます。
    </p>
  );
}
