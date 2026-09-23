"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLaborSettingsAction } from "@/lib/actions/company";
import { parseNumberInput } from "@/lib/calc/parse";
import { formatMinutes, hoursToMinutes } from "@/lib/labor/helpers";
import { DEFAULT_LABOR_SETTINGS_FORM, type LaborSettingsFormInput } from "@/lib/schemas/company";

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 入力された時間を「＝ 780 分」の形で見せる（数値にならないときは何も出さない） */
function MinutesHint({ hours }: { hours: string }) {
  const min = hoursToMinutes(parseNumberInput(hours));
  if (min == null) return null;
  return (
    <p className="text-xs text-muted-foreground">
      ＝ <span className="num">{min}</span> 分（{formatMinutes(min)}）
    </p>
  );
}

interface HoursFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
  disabled: boolean;
  unit?: string;
  showMinutes?: boolean;
}

function HoursField({ id, label, hint, value, onChange, errors, disabled, unit = "時間", showMinutes = true }: HoursFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <NumberInput id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="max-w-28" inputMode="decimal" />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      {showMinutes && <MinutesHint hours={value} />}
      <p className="text-xs text-muted-foreground">{hint}</p>
      <FieldError messages={errors} />
    </div>
  );
}

export interface LaborStandardsCardProps {
  initial: LaborSettingsFormInput;
  /** 編集できる（owner / admin） */
  editable: boolean;
}

/** 労務の基準（設定 → 安全管理）。時間で入力して分で保存する */
export function LaborStandardsCard({ initial, editable }: LaborStandardsCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [f, setF] = useState<LaborSettingsFormInput>(initial);
  const set = (patch: Partial<LaborSettingsFormInput>) => setF((prev) => ({ ...prev, ...patch }));
  const disabled = pending || !editable;

  const submit = () =>
    startTransition(async () => {
      const res = await updateLaborSettingsAction(f);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!editable) return;
        submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>労務の基準</CardTitle>
          <CardDescription>
            日報の開始・終了の時刻から、拘束時間・休息期間・連続勤務を見るときの目安です。変えると日報・点呼の「労務」の判定だけが変わり、日報そのものや金額は変わりません。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <HoursField
              id="labor-duty-limit"
              label="1 日の拘束時間の目安"
              hint="これを超えた日は「長い」として注意の色を付けます（既定 13 時間）。"
              value={f.labor_duty_limit_hours}
              onChange={(v) => set({ labor_duty_limit_hours: v })}
              errors={errors.labor_duty_limit_hours}
              disabled={disabled}
            />
            <HoursField
              id="labor-duty-max"
              label="1 日の拘束時間の上限"
              hint="これを超えた日は「かなり長い」として危険の色を付けます（既定 15 時間）。"
              value={f.labor_duty_max_hours}
              onChange={(v) => set({ labor_duty_max_hours: v })}
              errors={errors.labor_duty_max_hours}
              disabled={disabled}
            />
            <HoursField
              id="labor-rest-target"
              label="休息期間の目安"
              hint="前の日の終了から次の開始までがこれを下回ると「やや短い」になります（既定 11 時間）。"
              value={f.labor_rest_target_hours}
              onChange={(v) => set({ labor_rest_target_hours: v })}
              errors={errors.labor_rest_target_hours}
              disabled={disabled}
            />
            <HoursField
              id="labor-rest-min"
              label="休息期間の下限"
              hint="これを下回ると「不足」として危険の色を付けます（既定 9 時間）。"
              value={f.labor_rest_min_hours}
              onChange={(v) => set({ labor_rest_min_hours: v })}
              errors={errors.labor_rest_min_hours}
              disabled={disabled}
            />
            <HoursField
              id="labor-month-duty"
              label="1 か月の拘束時間"
              hint="その月の拘束の合計がこれを超えたドライバーを危険として出します（既定 284 時間）。"
              value={f.labor_month_duty_hours}
              onChange={(v) => set({ labor_month_duty_hours: v })}
              errors={errors.labor_month_duty_hours}
              disabled={disabled}
            />
            <HoursField
              id="labor-max-consecutive"
              label="連続勤務の日数"
              hint="休みなく続けてよい日数の上限です（既定 13 日）。"
              value={f.labor_max_consecutive_days}
              onChange={(v) => set({ labor_max_consecutive_days: v })}
              errors={errors.labor_max_consecutive_days}
              disabled={disabled}
              unit="日"
              showMinutes={false}
            />
          </div>

          {editable && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setF(DEFAULT_LABOR_SETTINGS_FORM)} disabled={pending}>
                <RotateCcw />
                既定に戻す
              </Button>
              <Button aria-label="労務の基準を保存" type="submit" disabled={pending} aria-busy={pending}>
                <Save />
                {pending ? "保存中…" : "保存"}
              </Button>
            </div>
          )}

          {!editable && <p className="text-xs text-muted-foreground">基準を変えられるのはオーナーだけです。</p>}

          <p className="text-xs text-muted-foreground">
            改善基準告示は一般貨物自動車運送事業の運転者が対象です。軽貨物の業務委託には直接は適用されませんが、事故を防ぐ目安として使っています。
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
