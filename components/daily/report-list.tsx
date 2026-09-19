"use client";

import { useState } from "react";
import { CircleAlert, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Qty } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLL_CALL_METHOD_LABELS, type DailyReportRow } from "@/lib/db/types";
import { formatWorkDate, isoToJstTime, rollCallState } from "@/lib/daily/helpers";
import { qty as qtyText } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RollCallDialog, type DailyChoices } from "./roll-call-dialog";

export interface ReportListProps {
  reports: DailyReportRow[];
  /** admin＋未締め月のときだけ編集できる */
  editable: boolean;
  choices: DailyChoices;
}

/** 点呼の済み・未済のバッジ */
function RollCallBadge({ at, method, label }: { at: string | null | undefined; method: string | null | undefined; label: string }) {
  if (!at) {
    return (
      <Badge variant="destructive" className="gap-1">
        <CircleAlert className="h-3 w-3" aria-hidden />
        {label}未実施
      </Badge>
    );
  }
  return (
    <span className="whitespace-nowrap text-sm">
      <span className="num">{isoToJstTime(at)}</span>
      <span className="ml-1 text-xs text-muted-foreground">{method ? ROLL_CALL_METHOD_LABELS[method as keyof typeof ROLL_CALL_METHOD_LABELS] : ""}</span>
    </span>
  );
}

/** 日付ごとの日報一覧（PC は表、スマホはカード） */
export function ReportList({ reports, editable, choices }: ReportListProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<DailyReportRow | null>(null);

  const edit = (report: DailyReportRow | null) => {
    setTarget(report);
    setOpen(true);
  };

  return (
    <div className="space-y-3">
      {editable && (
        <Button size="sm" onClick={() => edit(null)}>
          <Plus />
          日報を追加
        </Button>
      )}

      {reports.length === 0 ? (
        <Empty title="この月の日報はまだありません" description="ドライバーが「今日の報告」を出すか、管理者が日報を追加すると表示されます。" />
      ) : (
        <>
          {/* PC：表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>ドライバー</TableHead>
                  <TableHead>車両</TableHead>
                  <TableHead>業務前点呼</TableHead>
                  <TableHead>業務後点呼</TableHead>
                  <TableHead className="text-right">走行距離</TableHead>
                  <TableHead className="text-right">稼働合計</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => {
                  const state = rollCallState(r);
                  return (
                    <TableRow key={r.id ?? `${r.work_date}-${r.driver_id}`} className={cn(state !== "done" && "bg-destructive/5")}>
                      <TableCell className="whitespace-nowrap font-medium">{formatWorkDate(r.work_date ?? "")}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.driver_name || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.vehicle_plate || "—"}</TableCell>
                      <TableCell>
                        <RollCallBadge at={r.pre_at} method={r.pre_method} label="業務前" />
                      </TableCell>
                      <TableCell>
                        <RollCallBadge at={r.post_at} method={r.post_method} label="業務後" />
                      </TableCell>
                      <TableCell className="num text-right">{r.distance_km == null ? "—" : `${qtyText(r.distance_km)} km`}</TableCell>
                      <TableCell className="text-right">
                        <Qty value={r.qty_total} />
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <Button size="sm" variant="outline" onClick={() => edit(r)}>
                            <Pencil />
                            編集
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {reports.map((r) => {
              const state = rollCallState(r);
              return (
                <li key={r.id ?? `${r.work_date}-${r.driver_id}`}>
                  <Card className={cn(state !== "done" && "border-destructive/40 bg-destructive/5")}>
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {formatWorkDate(r.work_date ?? "")} <span className="ml-1">{r.driver_name || "—"}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.vehicle_plate || "車両なし"} ／ 稼働 {qtyText(r.qty_total)}
                            {r.distance_km != null && ` ／ ${qtyText(r.distance_km)} km`}
                          </p>
                        </div>
                        {editable && (
                          <Button size="sm" variant="outline" onClick={() => edit(r)}>
                            <Pencil />
                            編集
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <RollCallBadge at={r.pre_at} method={r.pre_method} label="業務前" />
                        <RollCallBadge at={r.post_at} method={r.post_method} label="業務後" />
                      </div>
                      {r.post_incident && <p className="break-words text-xs text-destructive">事故・違反：{r.post_incident}</p>}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editable && <RollCallDialog report={target} choices={choices} open={open} onOpenChange={setOpen} />}
    </div>
  );
}
