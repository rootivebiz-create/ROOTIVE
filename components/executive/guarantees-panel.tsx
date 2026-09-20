"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteGuaranteeAction, saveGuaranteeAction, type GuaranteeInput } from "@/lib/actions/executive";
import { guaranteeSchema } from "@/lib/schemas/executive";
import type { Guarantee } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { dateText } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** 借入の選択肢（画面側で作る） */
export interface GuaranteeLoanOption {
  id: string;
  label: string;
}

export function GuaranteesPanel({ guarantees, loans }: { guarantees: Guarantee[]; loans: GuaranteeLoanOption[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Guarantee | null>(null);

  const active = guarantees.filter((g) => g.is_active);
  const total = active.reduce((sum, g) => sum + Number(g.amount ?? 0), 0);

  return (
    <div className="space-y-3">
      <Card className={cn(total > 0 && "border-warning/40 bg-warning/5")}>
        <CardContent className="p-4 md:p-5">
          <p className="text-xs text-muted-foreground">いま代表個人が負っている保証・担保の合計</p>
          <p className="mt-1 text-2xl font-bold md:text-3xl">
            <Money value={total} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            有効 {active.length} 件。会社が返せなくなったとき、この金額が個人に来ます。借入を返し終えたら「有効」を外してください。
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          全 <span className="num font-semibold text-foreground">{guarantees.length}</span> 件
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 保証・担保を追加
        </Button>
      </div>

      {guarantees.length === 0 ? (
        <Empty title="まだ個人保証・担保が登録されていません" description="「保証・担保を追加」から、借入の連帯保証や差し入れている担保を記録しておきましょう。代表個人が負っているリスクが一目で分かります。">
          <HandCoins className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {guarantees.map((g) => (
              <li key={g.id}>
                <Card className={cn("p-3", !g.is_active && "bg-muted/40 text-muted-foreground")} role="button" tabIndex={0} onClick={() => setEditing(g)} onKeyDown={(e) => e.key === "Enter" && setEditing(g)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{g.lender || "相手先の記載なし"}</span>
                        <Badge variant="outline">{g.kind || "個人保証"}</Badge>
                        {!g.is_active && <Badge variant="secondary">終了</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">金額</dt>
                        <dd className="text-right">
                          <Money value={g.amount} />
                        </dd>
                        <dt className="text-muted-foreground">期間</dt>
                        <dd className="num text-right">
                          {dateText(g.starts_on)} 〜 {dateText(g.ends_on)}
                        </dd>
                      </dl>
                      {g.memo && <p className="mt-1 break-words text-xs text-muted-foreground">{g.memo}</p>}
                    </div>
                    <Pencil className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
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
                  <TableHead className="pl-4">相手先</TableHead>
                  <TableHead>種類</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead>始まり</TableHead>
                  <TableHead>終わり</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {guarantees.map((g) => (
                  <TableRow key={g.id} className={cn(!g.is_active && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {g.lender || "—"}
                        {!g.is_active && <Badge variant="secondary">終了</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{g.kind || "個人保証"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={g.amount} />
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">{dateText(g.starts_on)}</TableCell>
                    <TableCell className="num whitespace-nowrap">{dateText(g.ends_on)}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground">{g.memo || "—"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(g)}>
                        編集
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <GuaranteeDialog open={creating} onOpenChange={setCreating} guarantee={null} loans={loans} />
      <GuaranteeDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} guarantee={editing} loans={loans} />
    </div>
  );
}

function GuaranteeDialog({
  open,
  onOpenChange,
  guarantee,
  loans,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guarantee: Guarantee | null;
  loans: GuaranteeLoanOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{guarantee ? "保証・担保を編集" : "保証・担保を追加"}</DialogTitle>
          <DialogDescription>借入と結びつけておくと、どの借入に紐づく保証かが分かります。</DialogDescription>
        </DialogHeader>
        {open && <GuaranteeForm onOpenChange={onOpenChange} guarantee={guarantee} loans={loans} />}
      </DialogContent>
    </Dialog>
  );
}

function GuaranteeForm({
  onOpenChange,
  guarantee,
  loans,
}: {
  onOpenChange: (open: boolean) => void;
  guarantee: Guarantee | null;
  loans: GuaranteeLoanOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lender, setLender] = useState(guarantee?.lender ?? "");
  const [kind, setKind] = useState(guarantee?.kind ?? "個人保証");
  const [amount, setAmount] = useState(guarantee ? String(guarantee.amount ?? 0) : "");
  const [loanId, setLoanId] = useState(guarantee?.loan_id ?? "");
  const [startsOn, setStartsOn] = useState(guarantee?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(guarantee?.ends_on ?? "");
  const [isActive, setIsActive] = useState(guarantee?.is_active ?? true);
  const [memo, setMemo] = useState(guarantee?.memo ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: GuaranteeInput = {
      id: guarantee?.id ?? null,
      lender,
      kind,
      amount,
      loan_id: loanId,
      starts_on: startsOn,
      ends_on: endsOn,
      is_active: isActive,
      memo,
    };
    const parsed = guaranteeSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveGuaranteeAction(input);
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
    if (!guarantee) return;
    if (!window.confirm(`「${guarantee.lender || "保証"}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteGuaranteeAction(guarantee.id);
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-lender">相手先</Label>
          <Input id="guarantee-lender" value={lender} onChange={(e) => setLender(e.target.value)} placeholder="日本政策金融公庫 / リース会社 など" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="lender" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-kind">種類</Label>
          <Input id="guarantee-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="個人保証 / 不動産担保 / 連帯保証" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-amount">金額（円）</Label>
          <NumberInput id="guarantee-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5,000,000" disabled={pending} aria-invalid={!!errors.amount} />
          <FieldError errors={errors} name="amount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-loan">結びつける借入（任意）</Label>
          <Select id="guarantee-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)} disabled={pending}>
            <option value="">指定なし</option>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
          <FieldError errors={errors} name="loan_id" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-starts">始まり</Label>
          <Input id="guarantee-starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={pending} aria-invalid={!!errors.starts_on} />
          <FieldError errors={errors} name="starts_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guarantee-ends">終わり（任意）</Label>
          <Input id="guarantee-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} disabled={pending} aria-invalid={!!errors.ends_on} />
          <FieldError errors={errors} name="ends_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guarantee-memo">備考（任意）</Label>
        <Textarea id="guarantee-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="guarantee-active">いまも有効</Label>
          <p className="text-xs text-muted-foreground">返し終えた借入の保証は外します（合計から消えます）。</p>
        </div>
        <Switch id="guarantee-active" checked={isActive} onCheckedChange={setIsActive} disabled={pending} />
      </div>

      <DialogFooter>
        {guarantee && (
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
