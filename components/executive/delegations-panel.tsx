"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Pencil, Plus, Stamp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { saveDelegationAction, stopDelegationAction, type DelegationInput } from "@/lib/actions/executive";
import { APPROVAL_KINDS, delegationSchema } from "@/lib/schemas/executive";
import { APPROVAL_KIND_LABELS, type ApprovalKind, type DelegationRow } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { dateText, delegationBannerText, delegationKindsText } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** 委任先に選べる人（owner / admin のスタッフ） */
export interface DelegateOption {
  id: string;
  name: string;
  role: string;
}

export function DelegationsPanel({ delegations, staff, today }: { delegations: DelegationRow[]; staff: DelegateOption[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DelegationRow | null>(null);

  const current = delegations.filter((d) => d.is_current);

  const stop = (d: DelegationRow) => {
    if (!d.id) return;
    if (!window.confirm(`${d.to_name || "この管理者"} への委任を止めます。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await stopDelegationAction(d.id as string);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "決裁の委任を停止しました");
      router.refresh();
    });
  };

  const statusBadge = (d: DelegationRow) => {
    if (!d.is_active) return <Badge variant="secondary">停止</Badge>;
    if (d.is_current) return <Badge variant="warning">委任中</Badge>;
    if (d.to_on && d.to_on < today) return <Badge variant="secondary">終了</Badge>;
    return <Badge variant="outline">これから</Badge>;
  };

  return (
    <div className="space-y-3">
      {current.length > 0 && (
        <Alert variant="warning">
          <p className="flex items-center gap-2 font-semibold">
            <Stamp className="h-4 w-4" />
            いま代理で決裁できる人がいます
          </p>
          <ul className="mt-1 space-y-0.5">
            {current.map((d) => (
              <li key={d.id}>
                {delegationBannerText(d)}（{delegationKindsText(d.kinds)}）
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          代表が動けないあいだだけ、期間・上限金額・種別を切って決裁を預けます。権限そのものは渡しません（決裁の記録には代表の名前が残ります）。
        </p>
        <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
          <Plus /> 委任を作る
        </Button>
      </div>

      {delegations.length === 0 ? (
        <Empty title="まだ委任はありません" description="「委任を作る」から、誰に・いつまで・いくらまで任せるかを決めます。出張や入院のときに使ってください。">
          <Stamp className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {delegations.map((d) => (
              <li key={d.id}>
                <Card className={cn("p-3", !d.is_active && "bg-muted/40 text-muted-foreground")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold">{d.to_name || "（名前なし）"}</p>
                      <p className="num text-sm text-muted-foreground">
                        {dateText(d.from_on)} 〜 {dateText(d.to_on)}
                      </p>
                    </div>
                    {statusBadge(d)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">上限金額</dt>
                    <dd className="text-right">{d.max_amount == null ? "上限なし" : <Money value={d.max_amount} />}</dd>
                    <dt className="text-muted-foreground">対象の種別</dt>
                    <dd className="break-words text-right">{delegationKindsText(d.kinds)}</dd>
                  </dl>
                  {d.memo && <p className="mt-1 break-words text-xs text-muted-foreground">{d.memo}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(d)} disabled={pending}>
                      <Pencil /> 編集
                    </Button>
                    {d.is_active && (
                      <Button variant="ghost" size="sm" className="flex-1 text-destructive" onClick={() => stop(d)} disabled={pending}>
                        <Ban /> 止める
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">委任先</TableHead>
                  <TableHead>期間</TableHead>
                  <TableHead className="text-right">上限金額</TableHead>
                  <TableHead>対象の種別</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delegations.map((d) => (
                  <TableRow key={d.id} className={cn(!d.is_active && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">{d.to_name || "（名前なし）"}</TableCell>
                    <TableCell className="num whitespace-nowrap">
                      {dateText(d.from_on)} 〜 {dateText(d.to_on)}
                    </TableCell>
                    <TableCell className="text-right">{d.max_amount == null ? "上限なし" : <Money value={d.max_amount} />}</TableCell>
                    <TableCell className="max-w-[16rem] break-words text-sm">{delegationKindsText(d.kinds)}</TableCell>
                    <TableCell>{statusBadge(d)}</TableCell>
                    <TableCell className="whitespace-nowrap pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(d)}>
                        編集
                      </button>
                      {d.is_active && (
                        <button type="button" className="ml-3 text-sm text-destructive underline-offset-2 hover:underline" onClick={() => stop(d)}>
                          止める
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <DelegationDialog open={creating} onOpenChange={setCreating} delegation={null} staff={staff} today={today} />
      <DelegationDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} delegation={editing} staff={staff} today={today} />
    </div>
  );
}

interface DelegationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delegation: DelegationRow | null;
  staff: DelegateOption[];
  today: string;
}

function DelegationDialog(props: DelegationDialogProps) {
  const { open, onOpenChange, delegation } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{delegation ? "委任を編集" : "決裁を委任する"}</DialogTitle>
          <DialogDescription>期間・上限金額・種別を決めて、そのあいだだけ管理者に決裁を任せます。代理で決めた記録は必ず残ります。</DialogDescription>
        </DialogHeader>
        {open && <DelegationForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

/** 30 日後 */
function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function DelegationForm({ onOpenChange, delegation, staff, today }: DelegationDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toProfileId, setToProfileId] = useState(delegation?.to_profile_id ?? staff[0]?.id ?? "");
  const [fromOn, setFromOn] = useState(delegation?.from_on ?? today);
  const [toOn, setToOn] = useState(delegation?.to_on ?? plusDays(today, 14));
  const [maxAmount, setMaxAmount] = useState(delegation?.max_amount == null ? "" : String(delegation.max_amount));
  const [kinds, setKinds] = useState<ApprovalKind[]>(delegation?.kinds ?? []);
  const [isActive, setIsActive] = useState(delegation?.is_active ?? true);
  const [memo, setMemo] = useState(delegation?.memo ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const toggleKind = (kind: ApprovalKind, checked: boolean) => {
    setKinds((prev) => (checked ? [...prev, kind] : prev.filter((k) => k !== kind)));
  };

  const submit = () => {
    const input: DelegationInput = {
      id: delegation?.id ?? null,
      to_profile_id: toProfileId,
      from_on: fromOn,
      to_on: toOn,
      max_amount: maxAmount,
      kinds,
      is_active: isActive,
      memo,
    };
    const parsed = delegationSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveDelegationAction(input);
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

  return (
    <div className="flex flex-col gap-4">
      {staff.length === 0 ? (
        <Alert variant="warning">委任できる管理者がいません。先に「設定 / ユーザー管理」で管理者を追加してください。</Alert>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="delegation-to">委任先（管理者以上）</Label>
          <Select id="delegation-to" value={toProfileId} onChange={(e) => setToProfileId(e.target.value)} disabled={pending}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.role === "owner" ? "代表" : "管理者"}）
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="to_profile_id" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="delegation-from">始まりの日</Label>
          <Input id="delegation-from" type="date" value={fromOn} onChange={(e) => setFromOn(e.target.value)} disabled={pending} aria-invalid={!!errors.from_on} />
          <FieldError errors={errors} name="from_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delegation-to-on">終わりの日</Label>
          <Input id="delegation-to-on" type="date" value={toOn} onChange={(e) => setToOn(e.target.value)} disabled={pending} aria-invalid={!!errors.to_on} />
          <FieldError errors={errors} name="to_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="delegation-max">上限金額（空欄なら上限なし）</Label>
        <NumberInput id="delegation-max" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="500,000" disabled={pending} aria-invalid={!!errors.max_amount} />
        <p className="text-xs text-muted-foreground">この金額を超える申請は、代表しか決裁できません。</p>
        <FieldError errors={errors} name="max_amount" />
      </div>

      <div className="space-y-1.5">
        <Label>対象の種別（選ばなければすべて）</Label>
        <div className="grid grid-cols-2 gap-2">
          {APPROVAL_KINDS.map((k) => (
            <label key={k} htmlFor={`delegation-kind-${k}`} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
              <Checkbox id={`delegation-kind-${k}`} checked={kinds.includes(k)} onCheckedChange={(v) => toggleKind(k, v === true)} disabled={pending} />
              {APPROVAL_KIND_LABELS[k]}
            </label>
          ))}
        </div>
        <FieldError errors={errors} name="kinds" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="delegation-memo">メモ（任意）</Label>
        <Textarea id="delegation-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="min-h-[56px]" placeholder="例: 入院のあいだ" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="delegation-active">有効</Label>
          <p className="text-xs text-muted-foreground">外すとすぐに代理で決裁できなくなります。</p>
        </div>
        <Switch id="delegation-active" checked={isActive} onCheckedChange={setIsActive} disabled={pending} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={submit} disabled={pending || staff.length === 0}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
