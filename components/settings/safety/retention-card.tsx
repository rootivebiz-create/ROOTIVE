"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateRetentionSettingsAction } from "@/lib/actions/company";
import { DEFAULT_RETENTION_SETTINGS_FORM, type RetentionSettingsFormInput } from "@/lib/schemas/company";

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

interface NumFieldProps {
  id: keyof RetentionSettingsFormInput;
  label: string;
  hint: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
  disabled: boolean;
}

function NumField({ id, label, hint, unit, value, onChange, errors, disabled }: NumFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`retention-${id}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <NumberInput
          id={`retention-${id}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          decimal={false}
          className="max-w-24"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <FieldError messages={errors} />
    </div>
  );
}

export interface RetentionCardProps {
  initial: RetentionSettingsFormInput;
  /** 変えられるのはオーナーだけ（会社設定なので DB の RLS も owner を求める） */
  editable: boolean;
}

/** 法定帳票の保存期間と診断の間隔（0024） */
export function RetentionCard({ initial, editable }: RetentionCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<RetentionSettingsFormInput>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const set = (patch: Partial<RetentionSettingsFormInput>) => setForm((f) => ({ ...f, ...patch }));
  const disabled = !editable || pending;

  const save = () => {
    startTransition(async () => {
      const res = await updateRetentionSettingsAction(form);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>法定帳票の保存期間</CardTitle>
        <CardDescription>
          法令対応の画面（記録をいつまで持つか・監査で足りないものの判定）に使います。既定は法令の目安です。
          期間を過ぎた記録をアプリが消すことはありません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField
            id="retention_daily_years"
            label="運転日報・点呼記録"
            hint="記録の日から"
            unit="年"
            value={form.retention_daily_years}
            onChange={(v) => set({ retention_daily_years: v })}
            errors={errors.retention_daily_years}
            disabled={disabled}
          />
          <NumField
            id="retention_instruction_years"
            label="指導・監督の記録"
            hint="実施の日から"
            unit="年"
            value={form.retention_instruction_years}
            onChange={(v) => set({ retention_instruction_years: v })}
            errors={errors.retention_instruction_years}
            disabled={disabled}
          />
          <NumField
            id="retention_incident_years"
            label="事故・違反の記録"
            hint="発生の日から"
            unit="年"
            value={form.retention_incident_years}
            onChange={(v) => set({ retention_incident_years: v })}
            errors={errors.retention_incident_years}
            disabled={disabled}
          />
          <NumField
            id="retention_roster_years"
            label="運転者台帳"
            hint="退職・契約終了の日から"
            unit="年"
            value={form.retention_roster_years}
            onChange={(v) => set({ retention_roster_years: v })}
            errors={errors.retention_roster_years}
            disabled={disabled}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <NumField
            id="aptitude_age_from"
            label="適齢診断の対象年齢"
            hint="この年齢以上が対象"
            unit="歳から"
            value={form.aptitude_age_from}
            onChange={(v) => set({ aptitude_age_from: v })}
            errors={errors.aptitude_age_from}
            disabled={disabled}
          />
          <NumField
            id="aptitude_age_years"
            label="適齢診断の間隔"
            hint="この年数を過ぎると不足に出る"
            unit="年ごと"
            value={form.aptitude_age_years}
            onChange={(v) => set({ aptitude_age_years: v })}
            errors={errors.aptitude_age_years}
            disabled={disabled}
          />
          <NumField
            id="health_check_months"
            label="健康診断の間隔"
            hint="この期間を過ぎると不足に出る"
            unit="か月ごと"
            value={form.health_check_months}
            onChange={(v) => set({ health_check_months: v })}
            errors={errors.health_check_months}
            disabled={disabled}
          />
        </div>

        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={pending} aria-label="保存期間を保存">
              <Save /> {pending ? "保存中…" : "保存"}
            </Button>
            <Button variant="outline" onClick={() => setForm(DEFAULT_RETENTION_SETTINGS_FORM)} disabled={pending}>
              <RotateCcw /> 既定に戻す
            </Button>
          </div>
        )}
        {!editable && <p className="text-xs text-muted-foreground">保存期間を変えられるのはオーナーだけです。</p>}
      </CardContent>
    </Card>
  );
}
