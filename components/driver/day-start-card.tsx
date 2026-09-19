"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { DailyReportRow } from "@/lib/db/types";
import { saveDailyReportAction } from "@/lib/actions/daily";
import { isoToJstTime } from "@/lib/daily/helpers";

export interface DayStartCardProps {
  /** 対象日 "YYYY-MM-DD" */
  date: string;
  /** その日の日報（まだ無ければ null） */
  report: DailyReportRow | null;
  vehicles: { id: string; plate: string }[];
  /** 締め済み・古い日付では記録できない */
  editable: boolean;
}

/** ① 出発前（業務前点呼） */
export function DayStartCard({ date, report, vehicles, editable }: DayStartCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [alcohol, setAlcohol] = useState(report?.pre_alcohol == null ? "" : String(report.pre_alcohol));
  const [healthOk, setHealthOk] = useState(report?.pre_health_ok ?? true);
  const [inspectionOk, setInspectionOk] = useState(report?.pre_inspection_ok ?? true);
  const [vehicleId, setVehicleId] = useState(report?.vehicle_id ?? vehicles[0]?.id ?? "");

  const done = !!report?.pre_at;

  const save = () => {
    if (alcohol.trim() === "") {
      toast.error("アルコール検知の数値を入力してください（検出なしは 0）。");
      return;
    }
    startTransition(async () => {
      const res = await saveDailyReportAction({
        work_date: date,
        vehicle_id: vehicleId,
        pre: { at: "", method: "app", alcohol, health_ok: healthOk, inspection_ok: inspectionOk },
      });
      if (res.ok) {
        toast.success("出発を記録しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sunrise className="h-4 w-4" /> ① 出発前
        </CardTitle>
        <CardDescription>
          {done ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {isoToJstTime(report?.pre_at)} に記録済み
            </span>
          ) : (
            "アルコール検知の数値と体調・日常点検を記録します。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pre-alcohol">アルコール検知（mg/L）</Label>
          <NumberInput
            id="pre-alcohol"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
            placeholder="0.000"
            disabled={!editable || pending}
            className="text-lg"
          />
          <p className="text-xs text-muted-foreground">検出されなければ 0 を入力してください。</p>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={healthOk} onCheckedChange={(c) => setHealthOk(c === true)} disabled={!editable || pending} />
            体調に問題なし
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={inspectionOk} onCheckedChange={(c) => setInspectionOk(c === true)} disabled={!editable || pending} />
            日常点検 済み
          </label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pre-vehicle">車両</Label>
          <Select id="pre-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!editable || pending}>
            <option value="">指定なし</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </Select>
        </div>

        {editable && (
          <Button size="lg" className="w-full" onClick={save} disabled={pending} aria-busy={pending}>
            {pending ? "記録中…" : done ? "出発の記録を更新" : "出発を記録"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
