"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction, withdrawApprovalAction } from "@/lib/actions/approvals";

/**
 * 決裁の詳細（/executive/approvals/[id]）の承認・却下フォーム。
 *
 * 却下は理由が必須（decideApprovalSchema が同じ決まりを持つ。ここは送る前の案内）。
 * 承認のときだけ「意思決定として残す」を選べる（as_decision）。
 */
export function ApprovalDecideForm({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [asDecision, setAsDecision] = useState(false);
  const [noteError, setNoteError] = useState(false);

  const decide = (approve: boolean) => {
    if (!approve && note.trim() === "") {
      setNoteError(true);
      toast.error("却下するときは理由を入れてください");
      return;
    }
    setNoteError(false);
    startTransition(async () => {
      const res = await decideApprovalAction({ id, approve, note, as_decision: approve && asDecision });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? (approve ? "承認しました" : "却下しました"));
      router.refresh();
    });
  };

  const withdraw = () => {
    if (!window.confirm(`「${title}」を取り下げます。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await withdrawApprovalAction({ id, note });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "申請を取り下げました");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>決裁する</CardTitle>
        <CardDescription>ひとことを添えると、申請した人にそのまま伝わります。却下するときは理由が必要です。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="decide-note">ひとこと（却下のときは必須）</Label>
          <Textarea
            id="decide-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim() !== "") setNoteError(false);
            }}
            rows={3}
            placeholder="例: 金額は妥当です。契約書の写しを保管しておいてください。"
            disabled={pending}
            aria-invalid={noteError}
          />
          {noteError && <p className="text-xs text-destructive">却下するときは理由を入れてください</p>}
        </div>

        <label className="flex items-start gap-2 rounded-lg bg-muted p-3">
          <Checkbox id="decide-as-decision" checked={asDecision} onCheckedChange={(v) => setAsDecision(v === true)} disabled={pending} className="mt-0.5" />
          <span>
            <span className="text-sm font-medium">意思決定として残す</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              承認したときだけ、意思決定ログの下書きを作ります（見直し日は 90 日後）。あとから理由と期待する効果を書き足せます。
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button className="flex-1 md:flex-none" onClick={() => decide(true)} disabled={pending}>
            <Check /> {pending ? "送信中…" : "承認する"}
          </Button>
          <Button variant="destructive" className="flex-1 md:flex-none" onClick={() => decide(false)} disabled={pending}>
            <X /> 却下する
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={withdraw} disabled={pending}>
            <Undo2 /> 取り下げる
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">取り下げは「申請そのものを無かったことにする」ときに使います（申請した人か代表だけができます）。</p>
      </CardContent>
    </Card>
  );
}
