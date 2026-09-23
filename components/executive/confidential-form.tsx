"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { updateConfidentialScopeAction, type ConfidentialScopeFormInput } from "@/lib/actions/executive";
import { CONFIDENTIAL_KEYS, confidentialScopeSchema } from "@/lib/schemas/executive";
import { CONFIDENTIAL_KEY_LABELS, CONFIDENTIAL_LEVEL_LABELS, CONFIDENTIAL_LEVELS, type ConfidentialLevel, type ConfidentialScope } from "@/lib/db/types";
import { toFieldErrors, type FieldErrors } from "./field-error";

const LEVELS: ConfidentialLevel[] = CONFIDENTIAL_LEVELS;

/** それぞれの機密が何に効くか（画面の出し分けではなく、DB の RLS ごと変わる） */
const HINTS: Record<string, string> = {
  loans: "借入・返済予定・決算と税務の期限（/finance の借入・税務タブ）",
  cash: "現金残高と資金繰りの見通し（/cashflow）",
  bank_account: "ドライバーの振込先口座と全銀の振込データ（/payouts・出力）",
};

/**
 * 機密の見せ方（companies.confidential_scope）。
 * ここを変えると RLS（can_see_confidential）が変わるので、見えるだけでなく読み書きごと変わる。
 */
export function ConfidentialForm({ scope }: { scope: ConfidentialScope }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ConfidentialScope>(scope);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: ConfidentialScopeFormInput = { loans: form.loans, cash: form.cash, bank_account: form.bank_account };
    const parsed = confidentialScopeSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await updateConfidentialScopeAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          機密の見せ方
        </CardTitle>
        <CardDescription>
          借入・現金・ドライバーの振込口座を、誰まで見せるかを決めます。代表はいつでも見られます。ここを変えると画面だけでなく、データそのものが見えなくなります（RLS）。事務員に振込データを作ってもらうときは、振込口座を「事務員まで」にします（閲覧者には見えないまま）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {CONFIDENTIAL_KEYS.map((key) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`scope-${key}`}>{CONFIDENTIAL_KEY_LABELS[key] ?? key}</Label>
            <Select id={`scope-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value as ConfidentialLevel }))} disabled={pending}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {CONFIDENTIAL_LEVEL_LABELS[l]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{HINTS[key] ?? ""}</p>
            {errors[key]?.[0] && <p className="text-xs text-destructive">{errors[key][0]}</p>}
          </div>
        ))}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending}>
            <Save /> {pending ? "保存中…" : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
