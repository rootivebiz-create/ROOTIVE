"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteNoticeAction, saveNoticeAction } from "@/lib/actions/notices";
import { noticeInputSchema, type NoticeFormInput } from "@/lib/schemas/notices";
import type { NoticeClientOption, NoticeEditValues } from "@/lib/notices/view";

export interface NoticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規登録 */
  notice: NoticeEditValues | null;
  clients: NoticeClientOption[];
  /** 新規のときの初期の稼動月 "YYYY-MM" */
  month: string;
  /** 削除したあとの移動先（詳細画面から消したとき） */
  redirectAfterDelete?: string;
}

type FieldErrors = Record<string, string[]>;

interface FormState {
  clientId: string;
  month: string;
  noticeNo: string;
  receivedOn: string;
  totalAmount: string;
  taxAmount: string;
  memo: string;
}

function initialForm(notice: NoticeEditValues | null, month: string): FormState {
  if (notice) {
    return {
      clientId: notice.clientId,
      month: notice.month,
      noticeNo: notice.noticeNo,
      receivedOn: notice.receivedOn,
      totalAmount: String(notice.totalAmount ?? 0),
      taxAmount: String(notice.taxAmount ?? 0),
      memo: notice.memo,
    };
  }
  return { clientId: "", month, noticeNo: "", receivedOn: "", totalAmount: "", taxAmount: "", memo: "" };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

/** 支払通知書の登録・編集（admin+ のときだけ開く） */
export function NoticeDialog(props: NoticeDialogProps) {
  const { open, onOpenChange, notice } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice ? "支払通知書を編集" : "支払通知を登録"}</DialogTitle>
          <DialogDescription>
            元請から届いた支払明細書の表紙の内容を控えます。金額は税抜で入力し、消費税は別に入れてください。明細は登録したあとに CSV か貼り付けで取り込みます。
          </DialogDescription>
        </DialogHeader>
        {open && <NoticeForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function NoticeForm({ onOpenChange, notice, clients, month, redirectAfterDelete }: NoticeDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(notice, month));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): NoticeFormInput => ({
    id: notice?.id ?? null,
    client_id: form.clientId,
    month: form.month,
    notice_no: form.noticeNo,
    received_on: form.receivedOn,
    total_amount: form.totalAmount === "" ? "0" : form.totalAmount,
    tax_amount: form.taxAmount === "" ? "0" : form.taxAmount,
    memo: form.memo,
  });

  const save = () => {
    const input = buildInput();
    const parsed = noticeInputSchema.safeParse(input);
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
      const res = await saveNoticeAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      onOpenChange(false);
      if (!notice) router.push(`/invoices/notices/${res.data.id}?m=${encodeURIComponent(form.month)}`);
      else router.refresh();
    });
  };

  const remove = () => {
    if (!notice) return;
    if (!window.confirm("この支払通知書を削除します。取り込んだ明細も一緒に消えます。よろしいですか？")) return;
    startTransition(async () => {
      const res = await deleteNoticeAction(notice.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      onOpenChange(false);
      if (redirectAfterDelete) router.push(redirectAfterDelete);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="notice-client">取引先</Label>
          <Select id="notice-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} disabled={pending}>
            <option value="">指定しない（すべての案件と比べる）</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isActive ? "" : "（停止中）"}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="client_id" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notice-month">稼動月</Label>
          <Input id="notice-month" type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))} disabled={pending} aria-invalid={!!errors.month} />
          <FieldError errors={errors} name="month" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="notice-no">通知番号（任意）</Label>
          <Input
            id="notice-no"
            value={form.noticeNo}
            onChange={(e) => setForm((f) => ({ ...f, noticeNo: e.target.value }))}
            placeholder="例: 2026-09-001"
            maxLength={50}
            disabled={pending}
            aria-invalid={!!errors.notice_no}
          />
          <FieldError errors={errors} name="notice_no" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notice-received">受領日（任意）</Label>
          <Input id="notice-received" type="date" value={form.receivedOn} onChange={(e) => setForm((f) => ({ ...f, receivedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.received_on} />
          <FieldError errors={errors} name="received_on" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="notice-total">通知の合計（税抜）</Label>
          <NumberInput
            id="notice-total"
            value={form.totalAmount}
            onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.total_amount}
          />
          <FieldError errors={errors} name="total_amount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notice-tax">消費税</Label>
          <NumberInput
            id="notice-tax"
            value={form.taxAmount}
            onChange={(e) => setForm((f) => ({ ...f, taxAmount: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.tax_amount}
          />
          <FieldError errors={errors} name="tax_amount" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notice-memo">メモ（任意）</Label>
        <Textarea
          id="notice-memo"
          value={form.memo}
          onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
          rows={2}
          className="min-h-[56px]"
          placeholder="例: 9/25 受領。数量の相違を担当者へ確認中"
          disabled={pending}
        />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {notice && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="text-destructive sm:mr-auto">
            <Trash2 /> 削除
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
