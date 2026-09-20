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
import { deleteNoticeItemAction, saveNoticeItemAction } from "@/lib/actions/notices";
import { noticeItemSchema, type NoticeItemFormInput } from "@/lib/schemas/notices";
import { groupItemOptions, type NoticeDiffItem, type NoticeItemOption } from "@/lib/notices/view";

export interface NoticeItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noticeId: string;
  /** null = 明細を 1 行足す */
  item: NoticeDiffItem | null;
  itemOptions: NoticeItemOption[];
}

type FieldErrors = Record<string, string[]>;

interface FormState {
  rawName: string;
  projectItemId: string;
  qty: string;
  unitPrice: string;
  amount: string;
  memo: string;
}

function initialForm(item: NoticeDiffItem | null): FormState {
  if (item) {
    return {
      rawName: item.rawName,
      projectItemId: item.projectItemId,
      qty: String(item.noticeQty ?? 0),
      unitPrice: String(item.noticeUnitPrice ?? 0),
      amount: String(item.noticeAmount ?? 0),
      memo: item.memo,
    };
  }
  return { rawName: "", projectItemId: "", qty: "", unitPrice: "", amount: "", memo: "" };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

/** 明細 1 行の追加・編集（admin+ のときだけ開く） */
export function NoticeItemDialog(props: NoticeItemDialogProps) {
  const { open, onOpenChange, item } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "明細を編集" : "明細を追加"}</DialogTitle>
          <DialogDescription>
            通知書に書かれている内容・数量・単価をそのまま入れてください。金額を空欄（0）にすると 数量 × 単価 で計算します。案件内容を選ぶと自社の売上と比べられます。
          </DialogDescription>
        </DialogHeader>
        {open && <NoticeItemForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function NoticeItemForm({ onOpenChange, noticeId, item, itemOptions }: NoticeItemDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(item));
  const [errors, setErrors] = useState<FieldErrors>({});
  const groups = groupItemOptions(itemOptions);

  const buildInput = (): NoticeItemFormInput => ({
    id: item?.id ?? null,
    notice_id: noticeId,
    project_item_id: form.projectItemId,
    raw_name: form.rawName,
    qty: form.qty === "" ? "0" : form.qty,
    unit_price: form.unitPrice === "" ? "0" : form.unitPrice,
    amount: form.amount === "" ? "0" : form.amount,
    memo: form.memo,
  });

  const save = () => {
    const input = buildInput();
    const parsed = noticeItemSchema.safeParse(input);
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
      const res = await saveNoticeItemAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      onOpenChange(false);
      router.refresh();
    });
  };

  const remove = () => {
    if (!item) return;
    if (!window.confirm(`「${item.rawName}」の明細を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteNoticeItemAction(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="notice-item-name">内容（通知書の表記）</Label>
        <Input
          id="notice-item-name"
          value={form.rawName}
          onChange={(e) => setForm((f) => ({ ...f, rawName: e.target.value }))}
          placeholder="例: 板橋エリア 定期便"
          maxLength={200}
          disabled={pending}
          aria-invalid={!!errors.raw_name}
        />
        <FieldError errors={errors} name="raw_name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notice-item-link">案件内容</Label>
        <Select id="notice-item-link" value={form.projectItemId} onChange={(e) => setForm((f) => ({ ...f, projectItemId: e.target.value }))} disabled={pending}>
          <option value="">紐づけない</option>
          {groups.map((g) => (
            <optgroup key={g.projectId} label={g.projectName}>
              {g.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.isActive ? "" : "（停止中）"}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <FieldError errors={errors} name="project_item_id" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="notice-item-qty">数量</Label>
          <NumberInput id="notice-item-qty" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} placeholder="0" disabled={pending} aria-invalid={!!errors.qty} />
          <FieldError errors={errors} name="qty" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notice-item-price">単価</Label>
          <NumberInput
            id="notice-item-price"
            value={form.unitPrice}
            onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.unit_price}
          />
          <FieldError errors={errors} name="unit_price" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notice-item-amount">金額</Label>
          <NumberInput
            id="notice-item-amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="数量 × 単価"
            disabled={pending}
            aria-invalid={!!errors.amount}
          />
          <FieldError errors={errors} name="amount" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notice-item-memo">メモ（任意）</Label>
        <Textarea id="notice-item-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {item && (
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
