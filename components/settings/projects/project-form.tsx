"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MonthLink } from "@/components/layout/month-link";
import { deleteProjectAction, saveProjectAction } from "@/lib/actions/projects";
import { subMoney } from "@/lib/calc/money";
import { parseNumberInput } from "@/lib/calc/parse";
import { UNIT_LABELS, type Unit } from "@/lib/calc/types";
import type { Client, Project, ProjectItem } from "@/lib/db/types";
import { useMonth } from "@/lib/hooks/use-month";
import { DEFAULT_ITEM_NAME, type ProjectFormInput } from "@/lib/schemas/projects";

export interface ProjectFormProps {
  /** false（viewer）なら閲覧のみ */
  canEdit: boolean;
  /** null = 新規 */
  project: Project | null;
  items: ProjectItem[];
  /** 内容 id → 稼働行の件数（削除可否） */
  entryCounts: Record<string, number>;
  /** 取引先の候補（有効な取引先 ＋ 現在設定中の取引先） */
  clients: Client[];
}

interface FormState {
  name: string;
  /** clients.id。"" = 未設定 */
  client_id: string;
  is_active: boolean;
  memo: string;
}

interface ItemRow {
  key: string;
  id: string | null;
  name: string;
  unit: Unit;
  bill_rate: string;
  pay_rate: string;
  is_active: boolean;
}

let rowSeq = 0;
const nextKey = () => `new-${++rowSeq}`;
const UNITS: Unit[] = ["day", "piece"];

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 受注 − 支払 の差額プレビュー（両方数値のときだけ） */
function DiffPreview({ bill, pay }: { bill: string; pay: string }) {
  const b = parseNumberInput(bill);
  const p = parseNumberInput(pay);
  if (b == null || p == null) return <span className="text-xs text-muted-foreground">差額 —</span>;
  const diff = subMoney(b, p);
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span>
        差額 <Money value={diff} />
      </span>
      {diff < 0 && (
        <span className="flex items-center gap-1 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> 支払単価が受注単価を上回っています（赤字）
        </span>
      )}
    </span>
  );
}

export function ProjectForm({ canEdit, project, items, entryCounts, clients }: ProjectFormProps) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const listHref = href("/settings/projects");
  const isNew = project == null;
  const disabled = !canEdit || pending;

  const [f, setF] = useState<FormState>(() => ({
    name: project?.name ?? "",
    client_id: project?.client_id ?? "",
    is_active: project?.is_active ?? true,
    memo: project?.memo ?? "",
  }));
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));

  const [rows, setRows] = useState<ItemRow[]>(() =>
    items.length > 0
      ? items.map((it) => ({
          key: it.id,
          id: it.id,
          name: it.name,
          unit: it.unit,
          bill_rate: String(Number(it.bill_rate ?? 0)),
          pay_rate: String(Number(it.pay_rate ?? 0)),
          is_active: it.is_active,
        }))
      : [{ key: nextKey(), id: null, name: DEFAULT_ITEM_NAME, unit: "day", bill_rate: "", pay_rate: "", is_active: true }],
  );
  const updateRow = (key: string, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const addRow = () => setRows((rs) => [...rs, { key: nextKey(), id: null, name: "", unit: rs[rs.length - 1]?.unit ?? "day", bill_rate: "", pay_rate: "", is_active: true }]);

  const totalEntries = Object.values(entryCounts).reduce((a, b) => a + b, 0);

  const submit = () => {
    if (!canEdit) return;
    const input: ProjectFormInput = {
      id: project?.id ?? null,
      name: f.name,
      client_id: f.client_id === "" ? null : f.client_id,
      is_active: f.is_active,
      memo: f.memo,
      items: rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, bill_rate: r.bill_rate, pay_rate: r.pay_rate, is_active: r.is_active })),
    };
    startTransition(async () => {
      const res = await saveProjectAction(input);
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "保存しました");
        router.push(listHref);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!project) return;
    startTransition(async () => {
      const res = await deleteProjectAction(project.id);
      setConfirmOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "削除しました");
        router.push(listHref);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!canEdit && <Alert>閲覧のみです（編集権限がありません）。</Alert>}
      {errors._ && <Alert variant="destructive">{errors._[0]}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>案件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">案件名（必須）</Label>
            <Input id="project-name" value={f.name} onChange={(e) => set({ name: e.target.value })} disabled={disabled} required maxLength={100} autoComplete="off" placeholder="例: 三郷Amazon" />
            <FieldError messages={errors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-client">取引先</Label>
            <Select id="project-client" value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} disabled={disabled}>
              <option value="">未設定</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? "" : "（停止中）"}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              請求書は取引先ごとに作ります。候補にないときは「設定 → 取引先」で登録してください。
            </p>
            <FieldError messages={errors.client_id} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="project-active">状態</Label>
              <p className="text-xs text-muted-foreground">{f.is_active ? "稼働中（稼働入力の候補に表示）" : "停止中（稼働入力の候補に表示しない）"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={f.is_active ? "success" : "secondary"}>{f.is_active ? "稼働中" : "停止中"}</Badge>
              <Switch id="project-active" checked={f.is_active} onCheckedChange={(c) => set({ is_active: c })} disabled={disabled} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-memo">備考</Label>
            <Textarea id="project-memo" value={f.memo} onChange={(e) => set({ memo: e.target.value })} disabled={disabled} maxLength={2000} rows={3} />
            <FieldError messages={errors.memo} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>内容・単価</CardTitle>
          <CardDescription>1 案件に 1 つ以上。区分は日給（数量＝稼働日数）か個数（数量＝個数）。単価は稼働行の新規作成時に複写されます。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FieldError messages={errors.items} />
          {rows.map((r, i) => {
            const entries = r.id ? (entryCounts[r.id] ?? 0) : 0;
            return (
              <div key={r.key} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_9rem]">
                  <div className="space-y-1">
                    <Label htmlFor={`item-name-${r.key}`}>内容名</Label>
                    <Input id={`item-name-${r.key}`} value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} disabled={disabled} maxLength={100} placeholder={DEFAULT_ITEM_NAME} />
                    <FieldError messages={errors[`items.${i}.name`]} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`item-unit-${r.key}`}>区分</Label>
                    <Select id={`item-unit-${r.key}`} value={r.unit} onChange={(e) => updateRow(r.key, { unit: e.target.value as Unit })} disabled={disabled}>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </Select>
                    <FieldError messages={errors[`items.${i}.unit`]} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`item-bill-${r.key}`}>受注単価</Label>
                    <NumberInput id={`item-bill-${r.key}`} value={r.bill_rate} onChange={(e) => updateRow(r.key, { bill_rate: e.target.value })} disabled={disabled} placeholder="0" />
                    <FieldError messages={errors[`items.${i}.bill_rate`]} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`item-pay-${r.key}`}>支払単価</Label>
                    <NumberInput id={`item-pay-${r.key}`} value={r.pay_rate} onChange={(e) => updateRow(r.key, { pay_rate: e.target.value })} disabled={disabled} placeholder="0" />
                    <FieldError messages={errors[`items.${i}.pay_rate`]} />
                  </div>
                </div>
                <DiffPreview bill={r.bill_rate} pay={r.pay_rate} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={r.is_active} onCheckedChange={(c) => updateRow(r.key, { is_active: c })} disabled={disabled} aria-label="有効" />
                    {r.is_active ? "有効" : "停止中"}
                  </label>
                  {canEdit &&
                    (entries > 0 ? (
                      <span className="text-xs text-muted-foreground">稼働行 {entries} 件あり（削除不可。停止中にしてください）</span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => removeRow(r.key)} disabled={pending || rows.length <= 1} aria-label="この内容を削除">
                        <Trash2 /> 削除
                      </Button>
                    ))}
                </div>
              </div>
            );
          })}
          {canEdit && (
            <Button variant="outline" onClick={addRow} disabled={pending}>
              <Plus /> 内容を追加
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <MonthLink href="/settings/projects" className={buttonVariants({ variant: "outline" })}>
          一覧へ戻る
        </MonthLink>
        {canEdit && (
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
          </Button>
        )}
      </div>

      {canEdit && project && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">削除</CardTitle>
            <CardDescription>
              {totalEntries > 0
                ? `稼働行が ${totalEntries} 件あるため削除できません。不要な場合は「停止中」にしてください。`
                : "稼働行が無い案件のみ削除できます。内容とドライバーの個別単価も一緒に削除されます。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={pending || totalEntries > 0}>
              <Trash2 /> この案件を削除
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>案件を削除しますか？</DialogTitle>
            <DialogDescription>「{project?.name}」とその内容を削除します。この操作は取り消せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
