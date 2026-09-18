"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Money } from "@/components/ui/money";
import { parseNumberInput } from "@/lib/calc";
import { formatDateJa } from "@/lib/month";
import { saveCashSnapshotSchema, type SaveCashSnapshotInput } from "@/lib/schemas/cash";
import { deleteCashSnapshotAction, saveCashSnapshotAction } from "@/lib/actions/cash";
import type { CashSnapshotRow } from "./helpers";

export interface SnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 既定の基準日（日本時間の今日） */
  today: string;
  /** 登録済みの残高（新しい順） */
  snapshots: CashSnapshotRow[];
}

type FieldErrors = Record<string, string[]>;

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function SnapshotDialog(props: SnapshotDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>現在の残高を登録</DialogTitle>
          <DialogDescription>資金繰りの起点になる現金残高です。通帳の残高をそのまま入力してください（マイナスも入力できます）。同じ日付の残高は上書きされます。</DialogDescription>
        </DialogHeader>
        {/* 閉じると中身がアンマウントされ、開くたびにフォームが初期化される */}
        {open && <SnapshotForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function SnapshotForm({ onOpenChange, today, snapshots }: SnapshotDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asOf, setAsOf] = useState(today);
  const [balance, setBalance] = useState("");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const balanceNum = parseNumberInput(balance);
  const existing = snapshots.find((s) => s.asOf === asOf);

  const submit = () => {
    const input: SaveCashSnapshotInput = { as_of: asOf, balance, memo };
    const parsed = saveCashSnapshotSchema.safeParse(input);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        (fe[key] ??= []).push(issue.message);
      }
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveCashSnapshotAction(input);
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

  const runDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteCashSnapshotAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cash-as-of">基準日</Label>
          <Input id="cash-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} disabled={pending} aria-invalid={!!errors.as_of} />
          <FieldError errors={errors} name="as_of" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash-balance">現金残高</Label>
          <NumberInput
            id="cash-balance"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.balance}
            className="text-lg"
          />
          <FieldError errors={errors} name="balance" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cash-memo">メモ（任意）</Label>
        <Input id="cash-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 〇〇銀行 普通預金" maxLength={100} disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      {existing && <Alert variant="warning">{formatDateJa(existing.asOf)}の残高（<Money value={existing.balance} />）は上書きされます。</Alert>}
      {balanceNum != null && balanceNum < 0 && <Alert variant="warning">残高がマイナスです。入力内容を確認してください。</Alert>}

      <div className="rounded-lg bg-muted p-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">基準日</dt>
          <dd className="text-right">{asOf ? formatDateJa(asOf) : "—"}</dd>
          <dt className="font-semibold">現金残高</dt>
          <dd className="text-right font-semibold">
            <Money value={balanceNum ?? 0} />
          </dd>
        </dl>
      </div>

      {snapshots.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">登録済みの残高</p>
          <ul className="divide-y rounded-lg border">
            {snapshots.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="num">{s.asOf}</span>
                  {s.memo && <span className="ml-2 text-muted-foreground">{s.memo}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Money value={s.balance} />
                  {deleteTarget === s.id ? (
                    <>
                      <Button variant="destructive" size="sm" onClick={() => runDelete(s.id)} disabled={pending}>
                        削除する
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={pending}>
                        やめる
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`${s.asOf}の残高を削除`} onClick={() => setDeleteTarget(s.id)} disabled={pending}>
                      <Trash2 />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
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
