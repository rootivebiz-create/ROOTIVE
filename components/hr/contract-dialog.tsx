"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteContractAction, endContractAction, saveContractAction } from "@/lib/actions/hr";
import { contractInputSchema, CONTRACT_STATUS_VALUES, type ContractFormInput } from "@/lib/schemas/hr";
import type { ContractView, DriverLike } from "@/lib/hr/helpers";
import { ContractFileField } from "./contract-file-field";
import { isStoredContractFile } from "./contract-file-badge";
import { CONTRACT_STATUS_LABELS, type ContractStatus } from "@/lib/db/types";

const DEFAULT_TITLE = "業務委託契約書";

export interface ContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新規 */
  contract?: ContractView | null;
  drivers: DriverLike[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** 新規のときに最初から選んでおくドライバー（契約が無い人から追加するとき） */
  defaultDriverId?: string;
}

interface FormState {
  driverId: string;
  title: string;
  status: ContractStatus;
  startOn: string;
  endOn: string;
  autoRenew: boolean;
  noticeDays: string;
  filePath: string;
  agreedOn: string;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function initialForm(contract: ContractView | null | undefined, drivers: DriverLike[], today: string, defaultDriverId?: string): FormState {
  if (contract) {
    return {
      driverId: contract.driverId,
      title: contract.title,
      status: contract.status,
      startOn: contract.startOn,
      endOn: contract.endOn,
      autoRenew: contract.autoRenew,
      noticeDays: String(contract.noticeDays),
      filePath: contract.filePath,
      agreedOn: contract.agreedOn,
      memo: contract.memo,
    };
  }
  return {
    driverId: defaultDriverId || (drivers.find((d) => d.is_active)?.id ?? ""),
    title: DEFAULT_TITLE,
    status: "active",
    startOn: today,
    endOn: "",
    autoRenew: true,
    noticeDays: "30",
    filePath: "",
    agreedOn: "",
    memo: "",
  };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function ContractDialog(props: ContractDialogProps) {
  const { open, onOpenChange, contract } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contract ? "契約を編集" : "契約を追加"}</DialogTitle>
          <DialogDescription>自動更新の契約は、終了日の {contract?.noticeDays ?? 30} 日前から「更新時期」として警告します。</DialogDescription>
        </DialogHeader>
        {open && <ContractForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ContractForm({ onOpenChange, contract, drivers, today, defaultDriverId }: ContractDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(contract, drivers, today, defaultDriverId));
  const [errors, setErrors] = useState<FieldErrors>({});

  // 停止中のドライバーは、その契約を開いているときだけ選択肢に残す
  const driverOptions = drivers.filter((d) => d.is_active || d.id === form.driverId);

  const buildInput = (): ContractFormInput => ({
    id: contract?.id ?? null,
    driver_id: form.driverId,
    title: form.title,
    status: form.status,
    start_on: form.startOn,
    end_on: form.endOn,
    auto_renew: form.autoRenew,
    notice_days: form.noticeDays,
    file_path: form.filePath,
    agreed_on: form.agreedOn,
    memo: form.memo,
  });

  const save = () => {
    const input = buildInput();
    const parsed = contractInputSchema.safeParse(input);
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
      const res = await saveContractAction(input);
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
    if (!contract) return;
    if (!window.confirm(`${contract.driverName} さんの「${contract.title}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteContractAction(contract.id);
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
        <Label htmlFor="contract-driver">ドライバー</Label>
        <Select id="contract-driver" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} disabled={pending} aria-invalid={!!errors.driver_id}>
          <option value="">ドライバーを選択</option>
          {driverOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.is_active ? "" : "（停止中）"}
            </option>
          ))}
        </Select>
        <FieldError errors={errors} name="driver_id" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contract-title">契約名</Label>
          <Input id="contract-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={100} disabled={pending} aria-invalid={!!errors.title} />
          <FieldError errors={errors} name="title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-status">状態</Label>
          <Select id="contract-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ContractStatus }))} disabled={pending}>
            {CONTRACT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="status" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-start">開始日</Label>
          <Input id="contract-start" type="date" value={form.startOn} onChange={(e) => setForm((f) => ({ ...f, startOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.start_on} />
          <FieldError errors={errors} name="start_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-end">終了日（空欄 = 期限なし）</Label>
          <Input id="contract-end" type="date" value={form.endOn} onChange={(e) => setForm((f) => ({ ...f, endOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.end_on} />
          <FieldError errors={errors} name="end_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-notice">更新の通知日数</Label>
          <NumberInput
            id="contract-notice"
            decimal={false}
            value={form.noticeDays}
            onChange={(e) => setForm((f) => ({ ...f, noticeDays: e.target.value }))}
            placeholder="30"
            disabled={pending}
            aria-invalid={!!errors.notice_days}
          />
          <FieldError errors={errors} name="notice_days" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contract-agreed">合意日（任意）</Label>
          <Input id="contract-agreed" type="date" value={form.agreedOn} onChange={(e) => setForm((f) => ({ ...f, agreedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.agreed_on} />
          <FieldError errors={errors} name="agreed_on" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <Label htmlFor="contract-auto" className="font-normal">
          自動更新する
        </Label>
        <Switch id="contract-auto" checked={form.autoRenew} onCheckedChange={(v) => setForm((f) => ({ ...f, autoRenew: v === true }))} disabled={pending} />
      </div>

      <ContractFileField
        contractId={contract?.id ?? null}
        filePath={form.filePath}
        onChange={(filePath) => setForm((f) => ({ ...f, filePath }))}
        canEdit
        disabled={pending}
      />

      {!isStoredContractFile(form.filePath) && (
        <div className="space-y-1.5">
          <Label htmlFor="contract-file">契約書の保管場所メモ（任意）</Label>
          <Input
            id="contract-file"
            value={form.filePath}
            onChange={(e) => setForm((f) => ({ ...f, filePath: e.target.value }))}
            placeholder="例: 共有フォルダ/契約書/2026/山田太郎.pdf"
            maxLength={500}
            disabled={pending}
            aria-invalid={!!errors.file_path}
          />
          <p className="text-xs text-muted-foreground">紙の原本を別の場所で保管しているときに、置き場所を書き留めておけます。</p>
          <FieldError errors={errors} name="file_path" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="contract-memo">備考（任意）</Label>
        <Textarea id="contract-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {contract && (
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

// ---------------------------------------------------------------------------
// 終了にする
// ---------------------------------------------------------------------------

export interface EndContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: ContractView | null;
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

export function EndContractDialog({ open, onOpenChange, contract, today }: EndContractDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [endOn, setEndOn] = useState(contract?.endOn || today);

  const submit = () => {
    if (!contract) return;
    startTransition(async () => {
      const res = await endContractAction(contract.id, endOn);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "契約を終了にしました");
      router.refresh();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onOpenChange(false);
      }}
    >
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>契約を終了にする</DialogTitle>
          <DialogDescription>
            {contract ? `${contract.driverName} さんの「${contract.title}」を終了にします。` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="end-on">終了日</Label>
          <Input id="end-on" type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} disabled={pending} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "処理中…" : "終了にする"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
