"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DailyReportRow } from "@/lib/db/types";
import { saveDailyReportAction } from "@/lib/actions/daily";
import { isoToJstTime } from "@/lib/daily/helpers";

export interface DayEndCardProps {
  date: string;
  report: DailyReportRow | null;
  editable: boolean;
}

/** ③ 終了後（業務後点呼と走行距離） */
export function DayEndCard({ date, report, editable }: DayEndCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [alcohol, setAlcohol] = useState(report?.post_alcohol == null ? "" : String(report.post_alcohol));
  const [conditionOk, setConditionOk] = useState(report?.post_condition_ok ?? true);
  const [hasIncident, setHasIncident] = useState(!!report?.post_incident);
  const [incident, setIncident] = useState(report?.post_incident ?? "");
  const [distance, setDistance] = useState(report?.distance_km == null ? "" : String(report.distance_km));

  const done = !!report?.post_at;

  const save = () => {
    if (alcohol.trim() === "") {
      toast.error("アルコール検知の数値を入力してください（検出なしは 0）。");
      return;
    }
    if (hasIncident && incident.trim() === "") {
      toast.error("事故・違反の内容を入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await saveDailyReportAction({
        work_date: date,
        post: { at: "", method: "app", alcohol, condition_ok: conditionOk, incident: hasIncident ? incident : "" },
        work: { distance_km: distance },
      });
      if (res.ok) {
        toast.success("終了を記録しました");
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
          <Moon className="h-4 w-4" /> ③ 終了後
        </CardTitle>
        <CardDescription>
          {done ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {isoToJstTime(report?.post_at)} に記録済み
            </span>
          ) : (
            "アルコール検知・体調・事故や違反の有無・走行距離を記録します。"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="post-alcohol">アルコール検知（mg/L）</Label>
          <NumberInput
            id="post-alcohol"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
            placeholder="0.000"
            disabled={!editable || pending}
            className="text-lg"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={conditionOk} onCheckedChange={(c) => setConditionOk(c === true)} disabled={!editable || pending} />
          体調に問題なし
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={hasIncident} onCheckedChange={(c) => setHasIncident(c === true)} disabled={!editable || pending} />
          事故・違反・ヒヤリハットがあった
        </label>
        {hasIncident && (
          <div className="space-y-1.5">
            <Label htmlFor="post-incident">内容</Label>
            <Textarea
              id="post-incident"
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={!editable || pending}
              placeholder="例：駐車場で縁石に接触しました。"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="post-distance">走行距離（km）</Label>
          <NumberInput id="post-distance" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="0" disabled={!editable || pending} />
        </div>

        {editable && (
          <Button size="lg" className="w-full" onClick={save} disabled={pending} aria-busy={pending}>
            {pending ? "記録中…" : done ? "終了の記録を更新" : "終了を記録"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
