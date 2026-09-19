"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROLL_CALL_METHOD_LABELS, type DailyReportRow, type RollCallMethod } from "@/lib/db/types";
import { deleteDailyReportAction, saveDailyReportAction } from "@/lib/actions/daily";
import { ROLL_CALL_METHODS, type DailyReportFormInput, type WorkRecordInput } from "@/lib/schemas/daily";
import { formatWorkDate, isoToJstLocal, todayJST } from "@/lib/daily/helpers";

/** 日報ダイアログの選択肢 */
export interface DailyChoices {
  drivers: { id: string; name: string }[];
  vehicles: { id: string; plate: string }[];
}

export interface RollCallDialogProps {
  /** 編集する日報（null なら新規作成） */
  report: DailyReportRow | null;
  choices: DailyChoices;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 新規作成のときの初期日付 */
  defaultDate?: string;
}

function methodValue(v: string): RollCallMethod | undefined {
  return (ROLL_CALL_METHODS as readonly string[]).includes(v) ? (v as RollCallMethod) : undefined;
}

function numText(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

/** 点呼（業務前・業務後）と業務記録の編集（admin+） */
export function RollCallDialog({ report, choices, open, onOpenChange, defaultDate }: RollCallDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [driverId, setDriverId] = useState("");
  const [workDate, setWorkDate] = useState(todayJST());
  const [vehicleId, setVehicleId] = useState("");
  // 業務前点呼
  const [preAt, setPreAt] = useState("");
  const [preMethod, setPreMethod] = useState("");
  const [preAlcohol, setPreAlcohol] = useState("");
  const [preHealth, setPreHealth] = useState(false);
  const [preInspection, setPreInspection] = useState(false);
  const [preInstruction, setPreInstruction] = useState("");
  // 業務後点呼
  const [postAt, setPostAt] = useState("");
  const [postMethod, setPostMethod] = useState("");
  const [postAlcohol, setPostAlcohol] = useState("");
  const [postCondition, setPostCondition] = useState(false);
  const [postIncident, setPostIncident] = useState("");
  // 業務記録
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [distance, setDistance] = useState("");
  const [odoStart, setOdoStart] = useState("");
  const [odoEnd, setOdoEnd] = useState("");
  const [memo, setMemo] = useState("");

  // 開くたびに元の値へ戻す
  useEffect(() => {
    if (!open) return;
    setDriverId(report?.driver_id ?? choices.drivers[0]?.id ?? "");
    setWorkDate(report?.work_date ?? defaultDate ?? todayJST());
    setVehicleId(report?.vehicle_id ?? "");
    setPreAt(isoToJstLocal(report?.pre_at));
    setPreMethod(report?.pre_method ?? "face");
    setPreAlcohol(numText(report?.pre_alcohol));
    setPreHealth(report?.pre_health_ok ?? true);
    setPreInspection(report?.pre_inspection_ok ?? true);
    setPreInstruction(report?.pre_instruction ?? "");
    setPostAt(isoToJstLocal(report?.post_at));
    setPostMethod(report?.post_method ?? "face");
    setPostAlcohol(numText(report?.post_alcohol));
    setPostCondition(report?.post_condition_ok ?? true);
    setPostIncident(report?.post_incident ?? "");
    setStartAt(isoToJstLocal(report?.start_at));
    setEndAt(isoToJstLocal(report?.end_at));
    setBreakMinutes(String(report?.break_minutes ?? 0));
    setDistance(numText(report?.distance_km));
    setOdoStart(numText(report?.odo_start));
    setOdoEnd(numText(report?.odo_end));
    setMemo(report?.memo ?? "");
  }, [open, report, choices.drivers, defaultDate]);

  const save = () => {
    if (!driverId) {
      toast.error("ドライバーを選択してください。");
      return;
    }
    const work: WorkRecordInput = {
      break_minutes: breakMinutes.trim() === "" ? 0 : breakMinutes,
      distance_km: distance,
      odo_start: odoStart,
      odo_end: odoEnd,
      memo,
    };
    if (startAt) work.start = startAt;
    if (endAt) work.end = endAt;

    const input: DailyReportFormInput = {
      work_date: workDate,
      driver_id: driverId,
      vehicle_id: vehicleId,
      work,
    };
    if (preAt) {
      input.pre = {
        at: preAt,
        method: methodValue(preMethod),
        alcohol: preAlcohol,
        health_ok: preHealth,
        inspection_ok: preInspection,
        instruction: preInstruction,
      };
    }
    if (postAt) {
      input.post = {
        at: postAt,
        method: methodValue(postMethod),
        alcohol: postAlcohol,
        condition_ok: postCondition,
        incident: postIncident,
      };
    }

    startTransition(async () => {
      const res = await saveDailyReportAction(input);
      if (res.ok) {
        toast.success(res.message ?? "記録しました");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!report?.id) return;
    startTransition(async () => {
      const res = await deleteDailyReportAction(report.id as string);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{report ? "点呼・業務記録の編集" : "日報を追加"}</DialogTitle>
          <DialogDescription>
            {report ? `${formatWorkDate(report.work_date ?? "")} ／ ${report.driver_name || "—"}` : "点呼の時刻を入れると、その点呼を実施したものとして記録します。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 対象 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rc-driver">ドライバー</Label>
              <Select id="rc-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!!report}>
                <option value="">選択してください</option>
                {choices.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-date">日付</Label>
              <Input id="rc-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} disabled={!!report} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rc-vehicle">車両</Label>
              <Select id="rc-vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">指定なし</option>
                {choices.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* 業務前点呼 */}
          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">業務前点呼</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-pre-at">時刻</Label>
                <Input id="rc-pre-at" type="datetime-local" value={preAt} onChange={(e) => setPreAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-pre-method">方法</Label>
                <Select id="rc-pre-method" value={preMethod} onChange={(e) => setPreMethod(e.target.value)}>
                  {ROLL_CALL_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {ROLL_CALL_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-pre-alcohol">アルコール検知（mg/L）</Label>
                <NumberInput id="rc-pre-alcohol" value={preAlcohol} onChange={(e) => setPreAlcohol(e.target.value)} placeholder="0.000" />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={preHealth} onCheckedChange={(c) => setPreHealth(c === true)} /> 体調 OK
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={preInspection} onCheckedChange={(c) => setPreInspection(c === true)} /> 日常点検 OK
                </label>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rc-pre-instruction">指示事項</Label>
                <Textarea id="rc-pre-instruction" value={preInstruction} onChange={(e) => setPreInstruction(e.target.value)} rows={2} maxLength={2000} />
              </div>
            </div>
          </section>

          {/* 業務後点呼 */}
          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">業務後点呼</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-post-at">時刻</Label>
                <Input id="rc-post-at" type="datetime-local" value={postAt} onChange={(e) => setPostAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-post-method">方法</Label>
                <Select id="rc-post-method" value={postMethod} onChange={(e) => setPostMethod(e.target.value)}>
                  {ROLL_CALL_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {ROLL_CALL_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-post-alcohol">アルコール検知（mg/L）</Label>
                <NumberInput id="rc-post-alcohol" value={postAlcohol} onChange={(e) => setPostAlcohol(e.target.value)} placeholder="0.000" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={postCondition} onCheckedChange={(c) => setPostCondition(c === true)} /> 体調 OK
                </label>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rc-post-incident">事故・違反の報告</Label>
                <Textarea id="rc-post-incident" value={postIncident} onChange={(e) => setPostIncident(e.target.value)} rows={2} maxLength={2000} placeholder="無ければ空欄" />
              </div>
            </div>
          </section>

          {/* 業務記録 */}
          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="text-sm font-semibold">業務記録</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-start">開始</Label>
                <Input id="rc-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-end">終了</Label>
                <Input id="rc-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-break">休憩（分）</Label>
                <NumberInput id="rc-break" decimal={false} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-distance">走行距離（km）</Label>
                <NumberInput id="rc-distance" value={distance} onChange={(e) => setDistance(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-odo-start">走行メーター（開始）</Label>
                <NumberInput id="rc-odo-start" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-odo-end">走行メーター（終了）</Label>
                <NumberInput id="rc-odo-end" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rc-memo">備考</Label>
                <Textarea id="rc-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={2000} />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          {report && (
            <Button type="button" variant="ghost" className="text-destructive sm:mr-auto" onClick={remove} disabled={pending}>
              <Trash2 />
              この日報を削除
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
