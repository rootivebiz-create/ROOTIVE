"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteClientAction, saveClientAction } from "@/lib/actions/clients";
import type { Client } from "@/lib/db/types";
import { DEFAULT_HONORIFIC, PAYMENT_MONTH_OFFSETS, PAYMENT_MONTH_OFFSET_LABELS, type ClientFormInput } from "@/lib/schemas/clients";

export interface ClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  client: Client | null;
}

interface FormState {
  name: string;
  honorific: string;
  address: string;
  tel: string;
  invoice_reg_no: string;
  payment_month_offset: string;
  payment_day: string;
  memo: string;
  is_active: boolean;
}

const DAY_OPTIONS = [0, ...Array.from({ length: 31 }, (_, i) => i + 1)];

function emptyForm(): FormState {
  return {
    name: "",
    honorific: DEFAULT_HONORIFIC,
    address: "",
    tel: "",
    invoice_reg_no: "",
    payment_month_offset: "1",
    payment_day: "0",
    memo: "",
    is_active: true,
  };
}

function toForm(c: Client | null): FormState {
  if (!c) return emptyForm();
  return {
    name: c.name,
    honorific: c.honorific ?? DEFAULT_HONORIFIC,
    address: c.address ?? "",
    tel: c.tel ?? "",
    invoice_reg_no: c.invoice_reg_no ?? "",
    payment_month_offset: String(c.payment_month_offset ?? 1),
    payment_day: String(c.payment_day ?? 0),
    memo: c.memo ?? "",
    is_active: c.is_active,
  };
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 取引先の追加・編集ダイアログ（スマホでは下から全幅シート） */
export function ClientDialog({ open, onOpenChange, client }: ClientDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [f, setF] = useState<FormState>(() => toForm(client));
  const isNew = client == null;

  useEffect(() => {
    if (open) {
      setF(toForm(client));
      setErrors({});
      setConfirmDelete(false);
    }
  }, [open, client]);

  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));

  const submit = () => {
    const input: ClientFormInput = {
      id: client?.id ?? null,
      name: f.name,
      honorific: f.honorific,
      address: f.address,
      tel: f.tel,
      invoice_reg_no: f.invoice_reg_no,
      payment_month_offset: f.payment_month_offset,
      payment_day: f.payment_day,
      memo: f.memo,
      is_active: f.is_active,
    };
    startTransition(async () => {
      const res = await saveClientAction(input);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        onOpenChange(false);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!client) return;
    startTransition(async () => {
      const res = await deleteClientAction(client.id);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        onOpenChange(false);
        router.refresh();
      } else {
        setConfirmDelete(false);
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "取引先を追加" : "取引先の編集"}</DialogTitle>
          <DialogDescription>請求書の宛名・入金予定日に使います。名称は会社内で一意です。</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {errors._ && <Alert variant="destructive">{errors._[0]}</Alert>}

          <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">取引先名（必須）</Label>
              <Input id="client-name" value={f.name} onChange={(e) => set({ name: e.target.value })} disabled={pending} required maxLength={100} autoComplete="off" placeholder="例: 株式会社三郷物流" />
              <FieldError messages={errors.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-honorific">敬称</Label>
              <Input id="client-honorific" value={f.honorific} onChange={(e) => set({ honorific: e.target.value })} disabled={pending} maxLength={10} autoComplete="off" placeholder={DEFAULT_HONORIFIC} />
              <FieldError messages={errors.honorific} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-address">住所</Label>
            <Input id="client-address" value={f.address} onChange={(e) => set({ address: e.target.value })} disabled={pending} maxLength={200} autoComplete="off" />
            <FieldError messages={errors.address} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-tel">電話番号</Label>
              <Input id="client-tel" type="tel" value={f.tel} onChange={(e) => set({ tel: e.target.value })} disabled={pending} maxLength={50} autoComplete="off" />
              <FieldError messages={errors.tel} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-reg">適格請求書登録番号</Label>
              <Input id="client-reg" value={f.invoice_reg_no} onChange={(e) => set({ invoice_reg_no: e.target.value })} disabled={pending} maxLength={30} autoComplete="off" placeholder="T1234567890123" />
              <FieldError messages={errors.invoice_reg_no} />
            </div>
          </div>

          <fieldset className="space-y-1.5 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">入金予定日</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="client-pay-month">月</Label>
                <Select id="client-pay-month" value={f.payment_month_offset} onChange={(e) => set({ payment_month_offset: e.target.value })} disabled={pending}>
                  {PAYMENT_MONTH_OFFSETS.map((o) => (
                    <option key={o} value={String(o)}>
                      {PAYMENT_MONTH_OFFSET_LABELS[o]}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors.payment_month_offset} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-pay-day">日</Label>
                <Select id="client-pay-day" value={f.payment_day} onChange={(e) => set({ payment_day: e.target.value })} disabled={pending}>
                  {DAY_OPTIONS.map((d) => (
                    <option key={d} value={String(d)}>
                      {d === 0 ? "末日" : `${d}日`}
                    </option>
                  ))}
                </Select>
                <FieldError messages={errors.payment_day} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">稼動月からの入金予定日です。請求書の作成時にお支払い期限として入ります。</p>
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="client-active">状態</Label>
              <p className="text-xs text-muted-foreground">{f.is_active ? "有効（案件の取引先の候補に表示）" : "停止中（候補に表示しない）"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={f.is_active ? "success" : "secondary"}>{f.is_active ? "有効" : "停止中"}</Badge>
              <Switch id="client-active" checked={f.is_active} onCheckedChange={(c) => set({ is_active: c })} disabled={pending} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-memo">備考</Label>
            <Textarea id="client-memo" value={f.memo} onChange={(e) => set({ memo: e.target.value })} disabled={pending} maxLength={2000} rows={2} />
            <FieldError messages={errors.memo} />
          </div>

          {!isNew &&
            (confirmDelete ? (
              <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-2">
                <span>「{client?.name}」を削除します。取り消せません。</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={pending}>
                    やめる
                  </Button>
                  <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
                    削除する
                  </Button>
                </span>
              </Alert>
            ) : (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={pending}>
                <Trash2 /> この取引先を削除
              </Button>
            ))}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
