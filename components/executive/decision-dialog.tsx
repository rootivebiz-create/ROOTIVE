"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteDecisionAction, saveDecisionAction, type DecisionInput } from "@/lib/actions/executive";
import { decisionSchema } from "@/lib/schemas/executive";
import type { Decision } from "@/lib/db/types";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  decision: Decision | null;
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

interface FormState {
  title: string;
  context: string;
  decision: string;
  reason: string;
  expectedEffect: string;
  amount: string;
  decidedOn: string;
  reviewOn: string;
}

/** 見直し日の既定は 90 日後（DB の decision_from_approval と同じ考え方） */
function defaultReviewOn(decidedOn: string): string {
  const [y, m, d] = decidedOn.split("-").map(Number);
  if (!y || !m || !d) return "";
  const t = new Date(Date.UTC(y, m - 1, d + 90));
  return t.toISOString().slice(0, 10);
}

function initialForm(decision: Decision | null, today: string): FormState {
  if (decision) {
    return {
      title: decision.title,
      context: decision.context,
      decision: decision.decision,
      reason: decision.reason,
      expectedEffect: decision.expected_effect,
      amount: decision.amount == null ? "" : String(decision.amount),
      decidedOn: decision.decided_on,
      reviewOn: decision.review_on ?? "",
    };
  }
  return { title: "", context: "", decision: "", reason: "", expectedEffect: "", amount: "", decidedOn: today, reviewOn: defaultReviewOn(today) };
}

export function DecisionDialog(props: DecisionDialogProps) {
  const { open, onOpenChange, decision } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{decision ? "意思決定を編集" : "意思決定を残す"}</DialogTitle>
          <DialogDescription>何を、なぜ決めたかを残します。見直し日が来たら結果を書き足して振り返ります。</DialogDescription>
        </DialogHeader>
        {open && <DecisionForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({ onOpenChange, decision, today }: DecisionDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(decision, today));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): DecisionInput => ({
    id: decision?.id ?? null,
    title: form.title,
    context: form.context,
    decision: form.decision,
    reason: form.reason,
    expected_effect: form.expectedEffect,
    amount: form.amount,
    decided_on: form.decidedOn,
    review_on: form.reviewOn,
    approval_id: decision?.approval_id ?? null,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveDecisionAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  const remove = () => {
    if (!decision) return;
    if (!window.confirm(`「${decision.title}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteDecisionAction(decision.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="decision-title">件名</Label>
        <Input
          id="decision-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="例: 軽バンを 2 台増やす"
          maxLength={200}
          disabled={pending}
          aria-invalid={!!errors.title}
        />
        <FieldError errors={errors} name="title" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="decision-context">背景・検討した選択肢</Label>
        <Textarea
          id="decision-context"
          value={form.context}
          onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))}
          rows={3}
          placeholder={"例: 案件の依頼が月 30 件増えた。\nA 案: 車を増やす / B 案: 既存のドライバーの稼働を増やす / C 案: 断る"}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">比べた選択肢もここに書いておくと、あとで振り返るときに役立ちます。</p>
        <FieldError errors={errors} name="context" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="decision-decision">決めたこと</Label>
        <Textarea
          id="decision-decision"
          value={form.decision}
          onChange={(e) => setForm((f) => ({ ...f, decision: e.target.value }))}
          rows={2}
          className="min-h-[56px]"
          placeholder="例: A 案。リースで 2 台入れる"
          disabled={pending}
        />
        <FieldError errors={errors} name="decision" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="decision-reason">そう決めた理由</Label>
        <Textarea
          id="decision-reason"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          rows={2}
          className="min-h-[56px]"
          placeholder="例: 既存のドライバーは拘束時間の上限が近く、断ると来期の取引に響くため"
          disabled={pending}
        />
        <FieldError errors={errors} name="reason" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="decision-effect">期待する効果</Label>
        <Textarea
          id="decision-effect"
          value={form.expectedEffect}
          onChange={(e) => setForm((f) => ({ ...f, expectedEffect: e.target.value }))}
          rows={2}
          className="min-h-[56px]"
          placeholder="例: 3 か月後に月の売上が 60 万円増え、営業利益率は 12% を保つ"
          disabled={pending}
        />
        <FieldError errors={errors} name="expected_effect" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="decision-amount">金額（任意・円）</Label>
          <NumberInput
            id="decision-amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="600,000"
            disabled={pending}
            aria-invalid={!!errors.amount}
          />
          <FieldError errors={errors} name="amount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="decision-decided">決めた日</Label>
          <Input
            id="decision-decided"
            type="date"
            value={form.decidedOn}
            onChange={(e) => setForm((f) => ({ ...f, decidedOn: e.target.value, reviewOn: f.reviewOn || defaultReviewOn(e.target.value) }))}
            disabled={pending}
            aria-invalid={!!errors.decided_on}
          />
          <FieldError errors={errors} name="decided_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="decision-review">見直し日（任意）</Label>
          <Input
            id="decision-review"
            type="date"
            value={form.reviewOn}
            onChange={(e) => setForm((f) => ({ ...f, reviewOn: e.target.value }))}
            disabled={pending}
            aria-invalid={!!errors.review_on}
          />
          <FieldError errors={errors} name="review_on" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">見直し日が来ると、代表の画面に「結果を書きましょう」と出ます（既定は 90 日後）。</p>

      <DialogFooter>
        {decision && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="text-destructive sm:mr-auto">
            <Trash2 /> 削除
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
