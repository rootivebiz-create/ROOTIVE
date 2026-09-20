"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteOfficerAction, saveOfficerAction, type OfficerInput } from "@/lib/actions/executive";
import { officerSchema } from "@/lib/schemas/executive";
import type { Officer } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { EXPIRY_BADGE, dateText, expiryText, expiryTone } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** 任期満了の何日前から知らせるか（v_executive_tasks と同じ） */
const TERM_SOON_DAYS = 90;

export interface OfficersPanelProps {
  officers: Officer[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
}

export function OfficersPanel({ officers, today }: OfficersPanelProps) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Officer | null>(null);

  const active = officers.filter((o) => o.is_active);
  const expiring = active.filter((o) => {
    const tone = expiryTone(today, o.term_end_on, TERM_SOON_DAYS);
    return tone === "expired" || tone === "soon";
  });

  const termBadge = (o: Officer) => {
    const tone = expiryTone(today, o.term_end_on, TERM_SOON_DAYS);
    if (tone === "none") return <span className="text-muted-foreground">—</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="num">{dateText(o.term_end_on)}</span>
        {tone !== "ok" && <Badge variant={EXPIRY_BADGE[tone]}>{expiryText(today, o.term_end_on)}</Badge>}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {expiring.length > 0 && (
        <Alert variant="warning">
          <p className="font-semibold">任期満了が近い役員が {expiring.length} 名います。</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {expiring.map((o) => (
              <li key={o.id}>
                {o.name}（{o.title}）… {dateText(o.term_end_on)}／{expiryText(today, o.term_end_on)}
              </li>
            ))}
          </ul>
          <p className="mt-1">重任（再任）の登記は任期満了から 2 週間以内です。忘れると過料がかかります。</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          在任 <span className="num font-semibold text-foreground">{active.length}</span> 名／全 <span className="num">{officers.length}</span> 名
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 役員を追加
        </Button>
      </div>

      {officers.length === 0 ? (
        <Empty title="まだ役員が登録されていません" description="「役員を追加」から、氏名・役職・就任日・任期満了日を入れてください。任期が近づくと代表の画面で知らせます。">
          <UserRound className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {officers.map((o) => (
              <li key={o.id}>
                <Card className={cn("p-3", !o.is_active && "bg-muted/40 text-muted-foreground")} role="button" tabIndex={0} onClick={() => setEditing(o)} onKeyDown={(e) => e.key === "Enter" && setEditing(o)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{o.name}</span>
                        <Badge variant="outline">{o.title}</Badge>
                        {!o.is_active && <Badge variant="secondary">退任</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">就任日</dt>
                        <dd className="num text-right">{dateText(o.appointed_on)}</dd>
                        <dt className="text-muted-foreground">任期満了</dt>
                        <dd className="text-right">{termBadge(o)}</dd>
                      </dl>
                      {o.memo && <p className="mt-1 break-words text-xs text-muted-foreground">{o.memo}</p>}
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
                  <TableHead className="pl-4">氏名</TableHead>
                  <TableHead>役職</TableHead>
                  <TableHead>就任日</TableHead>
                  <TableHead>任期満了</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {officers.map((o) => (
                  <TableRow key={o.id} className={cn(!o.is_active && "text-muted-foreground")}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {o.name}
                        {!o.is_active && <Badge variant="secondary">退任</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{o.title}</TableCell>
                    <TableCell className="num whitespace-nowrap">{dateText(o.appointed_on)}</TableCell>
                    <TableCell className="whitespace-nowrap">{termBadge(o)}</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">{o.memo || "—"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(o)}>
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

      <OfficerDialog open={creating} onOpenChange={setCreating} officer={null} />
      <OfficerDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} officer={editing} />
    </div>
  );
}

interface FormState {
  name: string;
  title: string;
  appointedOn: string;
  termEndOn: string;
  isActive: boolean;
  memo: string;
  sortOrder: string;
}

function initialForm(officer: Officer | null): FormState {
  if (officer) {
    return {
      name: officer.name,
      title: officer.title,
      appointedOn: officer.appointed_on ?? "",
      termEndOn: officer.term_end_on ?? "",
      isActive: officer.is_active,
      memo: officer.memo,
      sortOrder: String(officer.sort_order ?? 0),
    };
  }
  return { name: "", title: "取締役", appointedOn: "", termEndOn: "", isActive: true, memo: "", sortOrder: "0" };
}

function OfficerDialog({ open, onOpenChange, officer }: { open: boolean; onOpenChange: (open: boolean) => void; officer: Officer | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{officer ? "役員を編集" : "役員を追加"}</DialogTitle>
          <DialogDescription>任期満了日を入れておくと、90 日前から重任（再任）の登記を知らせます。</DialogDescription>
        </DialogHeader>
        {open && <OfficerForm onOpenChange={onOpenChange} officer={officer} />}
      </DialogContent>
    </Dialog>
  );
}

function OfficerForm({ onOpenChange, officer }: { onOpenChange: (open: boolean) => void; officer: Officer | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(officer));
  const [errors, setErrors] = useState<FieldErrors>({});

  const buildInput = (): OfficerInput => ({
    id: officer?.id ?? null,
    name: form.name,
    title: form.title,
    appointed_on: form.appointedOn,
    term_end_on: form.termEndOn,
    is_active: form.isActive,
    memo: form.memo,
    sort_order: form.sortOrder,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = officerSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveOfficerAction(input);
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
    if (!officer) return;
    if (!window.confirm(`「${officer.name}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteOfficerAction(officer.id);
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
          <Label htmlFor="officer-name">氏名</Label>
          <Input id="officer-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={100} disabled={pending} aria-invalid={!!errors.name} />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="officer-title">役職</Label>
          <Input id="officer-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="代表取締役" maxLength={200} disabled={pending} />
          <FieldError errors={errors} name="title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="officer-appointed">就任日</Label>
          <Input id="officer-appointed" type="date" value={form.appointedOn} onChange={(e) => setForm((f) => ({ ...f, appointedOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.appointed_on} />
          <FieldError errors={errors} name="appointed_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="officer-term">任期満了日</Label>
          <Input id="officer-term" type="date" value={form.termEndOn} onChange={(e) => setForm((f) => ({ ...f, termEndOn: e.target.value }))} disabled={pending} aria-invalid={!!errors.term_end_on} />
          <FieldError errors={errors} name="term_end_on" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="officer-memo">備考（任意）</Label>
        <Textarea id="officer-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="officer-sort">並び順</Label>
          <NumberInput id="officer-sort" decimal={false} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} disabled={pending} aria-invalid={!!errors.sort_order} />
          <FieldError errors={errors} name="sort_order" />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3">
          <div>
            <Label htmlFor="officer-active">在任中</Label>
            <p className="text-xs text-muted-foreground">退任した役員は外します（記録は残ります）。</p>
          </div>
          <Switch id="officer-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={pending} />
        </div>
      </div>

      <DialogFooter>
        {officer && (
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
