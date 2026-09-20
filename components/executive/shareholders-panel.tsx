"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteShareholderAction, saveShareholderAction, type ShareholderInput } from "@/lib/actions/executive";
import { shareholderSchema } from "@/lib/schemas/executive";
import type { Shareholder } from "@/lib/db/types";
import { pct, qty } from "@/lib/format";
import { shareRatio } from "./helpers";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

/** 議決権の目安（過半数・特別決議） */
const MAJORITY = 0.5;
const SUPER_MAJORITY = 2 / 3;

export function ShareholdersPanel({ shareholders }: { shareholders: Shareholder[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Shareholder | null>(null);

  const total = useMemo(() => shareholders.reduce((sum, s) => sum + Number(s.shares ?? 0), 0), [shareholders]);
  const top = useMemo(() => [...shareholders].sort((a, b) => Number(b.shares ?? 0) - Number(a.shares ?? 0))[0] ?? null, [shareholders]);
  const topRatio = top ? shareRatio(top.shares, total) : null;

  const ratioBadge = (ratio: number | null) => {
    if (ratio == null) return null;
    if (ratio >= SUPER_MAJORITY) return <Badge variant="success">特別決議まで単独可</Badge>;
    if (ratio > MAJORITY) return <Badge variant="default">過半数</Badge>;
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Card>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">発行済みの株式（登録ぶん）</p>
            <p className="num mt-1 text-lg font-semibold md:text-xl">{qty(total)} 株</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">筆頭株主</p>
            <p className="mt-1 truncate text-lg font-semibold md:text-xl">{top?.name ?? "—"}</p>
            <p className="num mt-0.5 text-xs text-muted-foreground">{topRatio == null ? "—" : pct(topRatio)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">株主</p>
            <p className="num mt-1 text-lg font-semibold md:text-xl">{shareholders.length} 名</p>
            <p className="mt-0.5 text-xs text-muted-foreground">持株比率は登録した株式数の合計から計算します。</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">株主名簿は登記と一緒に整えておくと、融資や事業承継のときに役立ちます。</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> 株主を追加
        </Button>
      </div>

      {shareholders.length === 0 ? (
        <Empty title="まだ株主が登録されていません" description="「株主を追加」から、氏名（法人名）と持株数を入れてください。持株比率は自動で計算します。">
          <Users className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード */}
          <ul className="space-y-2 md:hidden">
            {shareholders.map((s) => {
              const ratio = shareRatio(s.shares, total);
              return (
                <li key={s.id}>
                  <Card className="p-3" role="button" tabIndex={0} onClick={() => setEditing(s)} onKeyDown={(e) => e.key === "Enter" && setEditing(s)}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{s.name}</span>
                          {ratioBadge(ratio)}
                        </div>
                        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                          <dt className="text-muted-foreground">持株数</dt>
                          <dd className="num text-right">{qty(s.shares)} 株</dd>
                          <dt className="text-muted-foreground">持株比率</dt>
                          <dd className="num text-right">{ratio == null ? "—" : pct(ratio)}</dd>
                        </dl>
                        {s.memo && <p className="mt-1 break-words text-xs text-muted-foreground">{s.memo}</p>}
                      </div>
                      <Pencil className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>

          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">株主</TableHead>
                  <TableHead className="text-right">持株数</TableHead>
                  <TableHead className="text-right">持株比率</TableHead>
                  <TableHead>備考</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholders.map((s) => {
                  const ratio = shareRatio(s.shares, total);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="pl-4 font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {s.name}
                          {ratioBadge(ratio)}
                        </span>
                      </TableCell>
                      <TableCell className="num text-right">{qty(s.shares)}</TableCell>
                      <TableCell className="num text-right">{ratio == null ? "—" : pct(ratio)}</TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">{s.memo || "—"}</TableCell>
                      <TableCell className="pr-4 text-right">
                        <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setEditing(s)}>
                          編集
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">合計</TableCell>
                  <TableCell className="num text-right">{qty(total)}</TableCell>
                  <TableCell className="num text-right">{total > 0 ? pct(1) : "—"}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </>
      )}

      <ShareholderDialog open={creating} onOpenChange={setCreating} shareholder={null} />
      <ShareholderDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} shareholder={editing} />
    </div>
  );
}

function ShareholderDialog({ open, onOpenChange, shareholder }: { open: boolean; onOpenChange: (open: boolean) => void; shareholder: Shareholder | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shareholder ? "株主を編集" : "株主を追加"}</DialogTitle>
          <DialogDescription>持株比率は、登録した株主の持株数の合計から計算して表示します。</DialogDescription>
        </DialogHeader>
        {open && <ShareholderForm onOpenChange={onOpenChange} shareholder={shareholder} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareholderForm({ onOpenChange, shareholder }: { onOpenChange: (open: boolean) => void; shareholder: Shareholder | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(shareholder?.name ?? "");
  const [shares, setShares] = useState(shareholder ? String(shareholder.shares ?? 0) : "");
  const [memo, setMemo] = useState(shareholder?.memo ?? "");
  const [sortOrder, setSortOrder] = useState(String(shareholder?.sort_order ?? 0));
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const input: ShareholderInput = { id: shareholder?.id ?? null, name, shares, memo, sort_order: sortOrder };
    const parsed = shareholderSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveShareholderAction(input);
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
    if (!shareholder) return;
    if (!window.confirm(`「${shareholder.name}」を削除します。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteShareholderAction(shareholder.id);
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
        <Label htmlFor="shareholder-name">氏名・法人名</Label>
        <Input id="shareholder-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={pending} aria-invalid={!!errors.name} />
        <FieldError errors={errors} name="name" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="shareholder-shares">持株数（株）</Label>
          <NumberInput id="shareholder-shares" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="100" disabled={pending} aria-invalid={!!errors.shares} />
          <FieldError errors={errors} name="shares" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shareholder-sort">並び順</Label>
          <NumberInput id="shareholder-sort" decimal={false} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} disabled={pending} aria-invalid={!!errors.sort_order} />
          <FieldError errors={errors} name="sort_order" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="shareholder-memo">備考（任意）</Label>
        <Textarea id="shareholder-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className="min-h-[56px]" disabled={pending} />
        <FieldError errors={errors} name="memo" />
      </div>

      <DialogFooter>
        {shareholder && (
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
