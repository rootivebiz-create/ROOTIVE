"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteInsurancePolicyAction, saveInsurancePolicyAction, type InsurancePolicyInput } from "@/lib/actions/executive";
import { insurancePolicySchema } from "@/lib/schemas/executive";
import type { InsurancePolicy } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { EXPIRY_BADGE, dateText, expiryText, expiryTone } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** 満了の何日前から知らせるか（v_executive_tasks と同じ 60 日） */
const EXPIRY_SOON_DAYS = 60;

export function InsurancePanel({ policies, today }: { policies: InsurancePolicy[]; today: string }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);

  const active = policies.filter((p) => p.is_active);
  const expiring = active.filter((p) => {
    const tone = expiryTone(today, p.expires_on, EXPIRY_SOON_DAYS);
    return tone === "expired" || tone === "soon";
  });
  const premiumTotal = active.reduce((sum, p) => sum + Number(p.premium ?? 0), 0);

  const expiryBadge = (p: InsurancePolicy) => {
    const tone = expiryTone(today, p.expires_on, EXPIRY_SOON_DAYS);
    if (tone === "none") return <span className="text-muted-foreground">—</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="num">{dateText(p.expires_on)}</span>
        {tone !== "ok" && <Badge variant={EXPIRY_BADGE[tone]}>{expiryText(today, p.expires_on)}</Badge>}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {expiring.length > 0 && (
        <Alert variant="warning">
          <p className="font-semibold">満了が近い保険が {expiring.length} 件あります。</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {expiring.map((p) => (
              <li key={p.id}>
                {p.kind || "保険"}（{p.insurer || "保険会社の記載なし"}）… {dateText(p.expires_on)}／{expiryText(today, p.expires_on)}
              </li>
            ))}
          </ul>
          <p className="mt-1">切らすと事故のときに自腹になります。更新したら満了日を入れ直してください。</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          有効 <span className="num font-semibold text-foreground">{active.length}</span> 件／保険料の合計{" "}
          <Money value={premiumTotal} className="font-semibold text-foreground" />
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 保険を追加
        </Button>
      </div>

      {policies.length === 0 ? (
        <Empty title="まだ保険が登録されていません" description="「保険を追加」から、貨物保険・賠償責任保険・生命保険などを登録してください。満了の 60 日前から知らせます。">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {policies.map((p) => (
              <li key={p.id}>
                <Card className={cn("p-3", !p.is_active && "bg-muted/40 text-muted-foreground")} role="button" tabIndex={0} onClick={() => setEditing(p)} onKeyDown={(e) => e.key === "Enter" && setEditing(p)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.kind || "保険"}</span>
                        {!p.is_active && <Badge variant="secondary">解約</Badge>}
                      </div>
                      <p className="break-words text-sm text-muted-foreground">{p.insurer || "保険会社の記載なし"}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">満了日</dt>
                        <dd className="text-right">{expiryBadge(p)}</dd>
                        <dt className="text-muted-foreground">保険料</dt>
                        <dd className="text-right">
                          <Money value={p.premium} />
                        </dd>
                        <dt className="text-muted-foreground">証券番号</dt>
                        <dd className="num truncate text-right">{p.policy_no || "—"}</dd>
                      </dl>
                      {p.covers && <p className="mt-1 break-words text-xs text-muted-foreground">補償: {p.covers}</p>}
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
                  <TableHead className="pl-4">保険の種類</TableHead>
                  <TableHead>保険会社</TableHead>
                  <TableHead>証券番号</TableHead>
                  <TableHead>開始日</TableHead>
                  <TableHead>満了日</TableHead>
                  <TableHead className="text-right">保険料</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} className={cn(!p.is_active && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {p.kind || "保険"}
                        {!p.is_active && <Badge variant="secondary">解約</Badge>}
                      </span>
                      {p.covers && <p className="max-w-[16rem] truncate text-xs text-muted-foreground">{p.covers}</p>}
                    </TableCell>
                    <TableCell>{p.insurer || "—"}</TableCell>
                    <TableCell className="num">{p.policy_no || "—"}</TableCell>
                    <TableCell className="num whitespace-nowrap">{dateText(p.starts_on)}</TableCell>
                    <TableCell className="whitespace-nowrap">{expiryBadge(p)}</TableCell>
                    <TableCell className="text-right">
                      <Money value={p.premium} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(p)}>
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

      <InsuranceDialog open={creating} onOpenChange={setCreating} policy={null} />
      <InsuranceDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} policy={editing} />
    </div>
  );
}

function InsuranceDialog({ open, onOpenChange, policy }: { open: boolean; onOpenChange: (open: boolean) => void; policy: InsurancePolicy | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{policy ? "保険を編集" : "保険を追加"}</DialogTitle>
          <DialogDescription>満了日を入れておくと 60 日前から知らせます。保険料は税抜で入れてください。</DialogDescription>
        </DialogHeader>
        {open && <InsuranceForm onOpenChange={onOpenChange} policy={policy} />}
      </DialogContent>
    </Dialog>
  );
}

interface FormState {
  kind: string;
  insurer: string;
  policyNo: string;
  startsOn: string;
  expiresOn: string;
  premium: string;
  covers: string;
  memo: string;
  isActive: boolean;
}

function initialForm(policy: InsurancePolicy | null): FormState {
  if (policy) {
    return {
      kind: policy.kind,
      insurer: policy.insurer,
      policyNo: policy.policy_no,
      startsOn: policy.starts_on ?? "",
      expiresOn: policy.expires_on ?? "",
      premium: String(policy.premium ?? 0),
      covers: policy.covers,
      memo: policy.memo,
      isActive: policy.is_active,
    };
  }
  return { kind: "", insurer: "", policyNo: "", startsOn: "", expiresOn: "", premium: "", covers: "", memo: "", isActive: true };
}

function InsuranceForm({ onOpenChange, policy }: { onOpenChange: (open: boolean) => void; policy: InsurancePolicy | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(policy));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): InsurancePolicyInput => ({
    id: policy?.id ?? null,
    kind: form.kind,
    insurer: form.insurer,
    policy_no: form.policyNo,
    starts_on: form.startsOn,
    expires_on: form.expiresOn,
    premium: form.premium,
    covers: form.covers,
    memo: form.memo,
    is_active: form.isActive,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = insurancePolicySchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveInsurancePolicyAction(input);
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
    if (!policy) return;
    if (!window.confirm(`「${policy.kind || "保険"}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteInsurancePolicyAction(policy.id);
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
          <Label htmlFor="insurance-kind">保険の種類</Label>
          <Input id="insurance-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} placeholder="貨物保険 / 賠償責任保険 など" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance-insurer">保険会社</Label>
          <Input id="insurance-insurer" value={form.insurer} onChange={(e) => setForm((f) => ({ ...f, insurer: e.target.value }))} maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="insurer" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance-no">証券番号</Label>
          <Input id="insurance-no" value={form.policyNo} onChange={(e) => setForm((f) => ({ ...f, policyNo: e.target.value }))} maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="policy_no" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance-premium">保険料（税抜・円）</Label>
          <NumberInput id="insurance-premium" value={form.premium} onChange={(e) => setForm((f) => ({ ...f, premium: e.target.value }))} placeholder="120,000" disabled={pending} aria-invalid={!!errors.premium} />
          <FieldError errors={errors} name="premium" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance-starts">開始日</Label>
          <Input id="insurance-starts" type="date" value={form.startsOn} onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.starts_on} />
          <FieldError errors={errors} name="starts_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insurance-expires">満了日</Label>
          <Input id="insurance-expires" type="date" value={form.expiresOn} onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.expires_on} />
          <FieldError errors={errors} name="expires_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="insurance-covers">補償の内容（任意）</Label>
        <Textarea id="insurance-covers" value={form.covers} onChange={(e) => setForm((f) => ({ ...f, covers: e.target.value }))} rows={2} className="min-h-[56px]" placeholder="対人・対物無制限、貨物 100 万円まで など" disabled={pending} />
        <FieldError errors={errors} name="covers" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="insurance-memo">備考（任意）</Label>
        <Textarea id="insurance-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
        <div>
          <Label htmlFor="insurance-active">加入中</Label>
          <p className="text-xs text-muted-foreground">解約した保険は外します（記録は残ります）。</p>
        </div>
        <Switch id="insurance-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
      </div>

      <DialogFooter>
        {policy && (
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
