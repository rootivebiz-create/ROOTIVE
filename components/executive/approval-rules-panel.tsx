"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveApprovalRuleAction, type ApprovalRuleInput } from "@/lib/actions/executive";
import { approvalRuleSchema } from "@/lib/schemas/executive";
import type { ApprovalRule } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { kindLabel } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** ルールの条件を 1 行で */
function conditionText(rule: ApprovalRule): string {
  if (!rule.is_enabled) return "決裁は要りません";
  if (rule.threshold_amount == null) return "金額を問わず必ず";
  return "しきい値以上のときだけ";
}

export function ApprovalRulesPanel({ rules }: { rules: ApprovalRule[] }) {
  const [editing, setEditing] = useState<ApprovalRule | null>(null);

  const threshold = (rule: ApprovalRule) =>
    rule.threshold_amount == null ? <span className="text-muted-foreground">—</span> : <Money value={rule.threshold_amount} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        管理者の操作のうち、どれを代表の決裁に回すかを決めます。ここで決めたしきい値は、申請の画面が自動で見ます（金額を手で覚えません）。
      </p>

      {rules.length === 0 ? (
        <Empty title="決裁のルールがありません" description="会社を作ったときに既定のルールが入ります。見当たらないときはデータの取り込み直後かもしれません。">
          <Scale className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {rules.map((r) => (
              <li key={r.id}>
                <Card className={cn("p-3", !r.is_enabled && "bg-muted/40 text-muted-foreground")} role="button" tabIndex={0} onClick={() => setEditing(r)} onKeyDown={(e) => e.key === "Enter" && setEditing(r)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.label || kindLabel(r.kind)}</span>
                        <Badge variant="outline">{kindLabel(r.kind)}</Badge>
                        {!r.is_enabled && <Badge variant="secondary">止めています</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">決裁の要否</dt>
                        <dd className="text-right">{conditionText(r)}</dd>
                        <dt className="text-muted-foreground">しきい値</dt>
                        <dd className="text-right">{threshold(r)}</dd>
                        <dt className="text-muted-foreground">期限</dt>
                        <dd className="num text-right">申請から {r.due_days} 日</dd>
                      </dl>
                      {r.note && <p className="mt-1 break-words text-xs text-muted-foreground">{r.note}</p>}
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
                  <TableHead className="pl-4">種別</TableHead>
                  <TableHead>決裁の要否</TableHead>
                  <TableHead className="text-right">しきい値</TableHead>
                  <TableHead className="text-right">期限</TableHead>
                  <TableHead>メモ</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id} className={cn(!r.is_enabled && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.label || kindLabel(r.kind)}
                        <Badge variant="outline">{kindLabel(r.kind)}</Badge>
                      </span>
                    </TableCell>
                    <TableCell>{conditionText(r)}</TableCell>
                    <TableCell className="text-right">{threshold(r)}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">{r.due_days} 日</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">{r.note || "—"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(r)}>
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

      <RuleDialog rule={editing} onOpenChange={(v) => !v && setEditing(null)} />
    </div>
  );
}

function RuleDialog({ rule, onOpenChange }: { rule: ApprovalRule | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={rule != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? `${kindLabel(rule.kind)}のルール` : "決裁のルール"}</DialogTitle>
          <DialogDescription>この種別で代表の決裁が要る条件と、決裁の期限（申請からの日数）を決めます。</DialogDescription>
        </DialogHeader>
        {rule && <RuleForm rule={rule} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

/** しきい値のあつかい */
type Mode = "always" | "threshold" | "off";

function initialMode(rule: ApprovalRule): Mode {
  if (!rule.is_enabled) return "off";
  return rule.threshold_amount == null ? "always" : "threshold";
}

function RuleForm({ rule, onOpenChange }: { rule: ApprovalRule; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(() => initialMode(rule));
  const [amount, setAmount] = useState(rule.threshold_amount == null ? "" : String(rule.threshold_amount));
  const [dueDays, setDueDays] = useState(String(rule.due_days ?? 3));
  const [label, setLabel] = useState(rule.label ?? "");
  const [note, setNote] = useState(rule.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: ApprovalRuleInput = {
      id: rule.id,
      // 「金額を問わず必ず」「この種別は要らない」のときはしきい値を空にする
      threshold_amount: mode === "threshold" ? amount : "",
      is_enabled: mode !== "off",
      due_days: dueDays,
      label,
      note,
    };
    const parsed = approvalRuleSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    if (mode === "threshold" && amount.trim() === "") {
      setErrors({ threshold_amount: ["しきい値の金額を入れてください"] });
      toast.error("しきい値の金額を入れてください");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveApprovalRuleAction(input);
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
      <div className="space-y-1.5">
        <Label htmlFor="rule-mode">決裁の要否</Label>
        <Select id="rule-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={pending}>
          <option value="threshold">決まった金額以上のときだけ決裁が要る</option>
          <option value="always">金額を問わず必ず決裁が要る</option>
          <option value="off">この種別は決裁を要らないことにする（止める）</option>
        </Select>
      </div>

      {mode === "threshold" && (
        <div className="space-y-1.5">
          <Label htmlFor="rule-amount">しきい値（この金額以上・円）</Label>
          <NumberInput id="rule-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="300,000" disabled={pending} aria-invalid={!!errors.threshold_amount} />
          <FieldError errors={errors} name="threshold_amount" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="rule-due">決裁の期限（申請から何日）</Label>
        <NumberInput id="rule-due" decimal={false} value={dueDays} onChange={(e) => setDueDays(e.target.value)} placeholder="3" disabled={pending} aria-invalid={!!errors.due_days} />
        <p className="text-xs text-muted-foreground">この日数を過ぎると「期限切れ」として決裁の画面のいちばん上に出ます。</p>
        <FieldError errors={errors} name="due_days" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-label">呼び名（任意）</Label>
        <Input id="rule-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="高額の経費" maxLength={200} disabled={pending} />
        <FieldError errors={errors} name="label" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-note">メモ（任意）</Label>
        <Input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} disabled={pending} />
        <FieldError errors={errors} name="note" />
      </div>

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
