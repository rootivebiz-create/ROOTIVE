"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CloudOff, Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { DailyReportRow } from "@/lib/db/types";
import { submitWithOfflineFallback } from "@/lib/offline/sync";
import { isoToJstTime, nowJstTime, todayJST } from "@/lib/daily/helpers";

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
  /** 電波が無くて端末に保存した（電波が戻ると自動で送る） */
  const [queued, setQueued] = useState(false);

  const done = !!report?.pre_at;

  const save = () => {
    if (alcohol.trim() === "") {
      toast.error("アルコール検知の数値を入力してください（検出なしは 0）。");
      return;
    }
    startTransition(async () => {
      // 電波が弱いときは端末に保存して、戻ったら自動で送る
      const out = await submitWithOfflineFallback({
        kind: "daily_report",
        payload: {
          input: {
            work_date: date,
            vehicle_id: vehicleId,
            // 送信が遅れても点呼の時刻がずれないよう、入力した瞬間の時刻を持たせる
            pre: { at: `${todayJST()}T${nowJstTime()}`, method: "app", alcohol, health_ok: healthOk, inspection_ok: inspectionOk },
          },
        },
      });
      if (out.status === "sent") {
        setQueued(false);
        toast.success("出発を記録しました");
        router.refresh();
      } else if (out.status === "queued") {
        setQueued(true);
        toast.success(out.message);
      } else {
        toast.error(out.error);
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
          {queued ? (
            <span className="flex items-center gap-1 text-warning">
              <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
              端末に保存しました（未送信）。電波が戻ると自動で送信します。
            </span>
          ) : done ? (
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
