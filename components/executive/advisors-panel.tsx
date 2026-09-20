"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
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
import { deleteAdvisorAction, saveAdvisorAction, type AdvisorInput } from "@/lib/actions/executive";
import { advisorSchema } from "@/lib/schemas/executive";
import type { Advisor } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

export function AdvisorsPanel({ advisors }: { advisors: Advisor[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Advisor | null>(null);

  const active = advisors.filter((a) => a.is_active);
  const feeTotal = active.reduce((sum, a) => sum + Number(a.fee ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          契約中 <span className="num font-semibold text-foreground">{active.length}</span> 件／顧問料の合計{" "}
          <Money value={feeTotal} className="font-semibold text-foreground" />
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 顧問を追加
        </Button>
      </div>

      {advisors.length === 0 ? (
        <Empty title="まだ顧問が登録されていません" description="「顧問を追加」から、税理士・社労士・弁護士などの連絡先と顧問料を控えておきましょう。">
          <Briefcase className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {advisors.map((a) => (
              <li key={a.id}>
                <Card className={cn("p-3", !a.is_active && "bg-muted/40 text-muted-foreground")} role="button" tabIndex={0} onClick={() => setEditing(a)} onKeyDown={(e) => e.key === "Enter" && setEditing(a)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{a.name}</span>
                        <Badge variant="outline">{a.kind || "顧問"}</Badge>
                        {!a.is_active && <Badge variant="secondary">契約終了</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">連絡先</dt>
                        <dd className="break-words text-right">{a.contact || "—"}</dd>
                        <dt className="text-muted-foreground">顧問料（月）</dt>
                        <dd className="text-right">
                          <Money value={a.fee} />
                        </dd>
                      </dl>
                      {a.memo && <p className="mt-1 break-words text-xs text-muted-foreground">{a.memo}</p>}
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
                  <TableHead className="pl-4">名前</TableHead>
                  <TableHead>区分</TableHead>
                  <TableHead>連絡先</TableHead>
                  <TableHead className="text-right">顧問料（月）</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advisors.map((a) => (
                  <TableRow key={a.id} className={cn(!a.is_active && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {a.name}
                        {!a.is_active && <Badge variant="secondary">契約終了</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{a.kind || "顧問"}</TableCell>
                    <TableCell className="break-words text-sm">{a.contact || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Money value={a.fee} />
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground">{a.memo || "—"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(a)}>
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

      <AdvisorDialog open={creating} onOpenChange={setCreating} advisor={null} />
      <AdvisorDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} advisor={editing} />
    </div>
  );
}

function AdvisorDialog({ open, onOpenChange, advisor }: { open: boolean; onOpenChange: (open: boolean) => void; advisor: Advisor | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{advisor ? "顧問を編集" : "顧問を追加"}</DialogTitle>
          <DialogDescription>顧問料は税抜の月額で入れてください（経費には自動で反映しません）。</DialogDescription>
        </DialogHeader>
        {open && <AdvisorForm onOpenChange={onOpenChange} advisor={advisor} />}
      </DialogContent>
    </Dialog>
  );
}

function AdvisorForm({ onOpenChange, advisor }: { onOpenChange: (open: boolean) => void; advisor: Advisor | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState(advisor?.kind ?? "税理士");
  const [name, setName] = useState(advisor?.name ?? "");
  const [contact, setContact] = useState(advisor?.contact ?? "");
  const [fee, setFee] = useState(advisor ? String(advisor.fee ?? 0) : "");
  const [memo, setMemo] = useState(advisor?.memo ?? "");
  const [sortOrder, setSortOrder] = useState(String(advisor?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(advisor?.is_active ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: AdvisorInput = { id: advisor?.id ?? null, kind, name, contact, fee, memo, is_active: isActive, sort_order: sortOrder };
    const parsed = advisorSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveAdvisorAction(input);
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
    if (!advisor) return;
    if (!window.confirm(`「${advisor.name}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteAdvisorAction(advisor.id);
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
          <Label htmlFor="advisor-kind">区分</Label>
          <Input id="advisor-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="税理士 / 社労士 / 弁護士" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="kind" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advisor-name">名前・事務所名</Label>
          <Input id="advisor-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={pending} aria-invalid={!!errors.name} />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advisor-contact">連絡先</Label>
          <Input id="advisor-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="電話番号・メール" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="contact" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advisor-fee">顧問料（月額・税抜）</Label>
          <NumberInput id="advisor-fee" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="30,000" disabled={pending} aria-invalid={!!errors.fee} />
          <FieldError errors={errors} name="fee" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="advisor-memo">備考（任意）</Label>
        <Textarea id="advisor-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="advisor-sort">並び順</Label>
          <NumberInput id="advisor-sort" decimal={false} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={pending} aria-invalid={!!errors.sort_order} />
          <FieldError errors={errors} name="sort_order" />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
          <div>
            <Label htmlFor="advisor-active">契約中</Label>
            <p className="text-xs text-muted-foreground">終わった契約は外します。</p>
          </div>
          <Switch id="advisor-active" checked={isActive} onCheckedChange={setIsActive} disabled={pending} />
        </div>
      </div>

      <DialogFooter>
        {advisor && (
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
