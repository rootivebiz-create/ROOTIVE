"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reviewDecisionAction, type DecisionReviewInput } from "@/lib/actions/executive";
import { decisionReviewSchema } from "@/lib/schemas/executive";
import { DECISION_STATUS_LABELS, type Decision, type DecisionStatus } from "@/lib/db/types";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

const STATUSES: DecisionStatus[] = ["open", "reviewed", "dropped"];

/**
 * 振り返り（/executive/decisions/[id]）。
 * 結果と学びを書いて「振り返り済み」にすると、代表の画面の「見直し日が来ています」から消える。
 */
export function DecisionReviewForm({ decision, today }: { decision: Decision; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState(decision.outcome ?? "");
  const [outcomeOn, setOutcomeOn] = useState(decision.outcome_on ?? today);
  const [status, setStatus] = useState<DecisionStatus>(decision.status === "open" ? "reviewed" : decision.status);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: DecisionReviewInput = { id: decision.id, outcome, outcome_on: outcomeOn, status };
    const parsed = decisionReviewSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    if (status === "reviewed" && outcome.trim() === "") {
      setErrors({ outcome: ["結果と学びを書いてください"] });
      toast.error("結果と学びを書いてください");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await reviewDecisionAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "振り返りを保存しました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>振り返り</CardTitle>
        <CardDescription>思ったとおりになったか、ならなかったかを書きます。次に同じ判断をするときの材料になります。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="review-outcome">結果と学び</Label>
          <Textarea
            id="review-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={4}
            placeholder="例: 2 台とも 2 か月で稼働に乗り、月の売上は 55 万円増えた。営業利益率は 10.8% まで下がったので、次は固定費の増え方も一緒に見る。"
            disabled={pending}
            aria-invalid={!!errors.outcome}
          />
          <FieldError errors={errors} name="outcome" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="review-on">振り返った日</Label>
            <Input id="review-on" type="date" value={outcomeOn} onChange={(e) => setOutcomeOn(e.target.value)} disabled={pending} aria-invalid={!!errors.outcome_on} />
            <FieldError errors={errors} name="outcome_on" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-status">状態</Label>
            <Select id="review-status" value={status} onChange={(e) => setStatus(e.target.value as DecisionStatus)} disabled={pending}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DECISION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">「取りやめ」は、決めたことを実行しなかったときに選びます。</p>
            <FieldError errors={errors} name="status" />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={pending}>
            <CheckCircle2 /> {pending ? "保存中…" : "振り返りを保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
