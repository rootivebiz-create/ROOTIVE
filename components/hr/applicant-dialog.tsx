"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Trash2, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  addApplicantEventAction,
  convertApplicantToDriverAction,
  createApplicantAction,
  deleteApplicantAction,
  moveApplicantStageAction,
  toggleChecklistAction,
  updateApplicantAction,
} from "@/lib/actions/hr";
import { createApplicantSchema, type ApplicantFormInput } from "@/lib/schemas/hr";
import {
  CHECKLIST_ITEMS,
  checklistProgress,
  isClosedStage,
  nextStage,
  prevStage,
  stageLabel,
  type ApplicantEventView,
  type ApplicantView,
  type ChecklistKey,
} from "@/lib/hr/helpers";
import { APPLICANT_STAGE_LABELS, type ApplicantStage } from "@/lib/db/types";
import { formatDateJa } from "@/lib/month";

export interface ApplicantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** mode = "edit" のときの対象（一覧から探し直すので、保存後も最新の内容が入る） */
  applicant?: ApplicantView | null;
  /** その応募者のやりとり（新しい順） */
  events?: ApplicantEventView[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
}

interface FormState {
  name: string;
  kana: string;
  phone: string;
  email: string;
  source: string;
  appliedOn: string;
  interviewOn: string;
  memo: string;
}

type FieldErrors = Record<string, string[]>;

function initialForm(applicant: ApplicantView | null | undefined, today: string): FormState {
  return {
    name: applicant?.name ?? "",
    kana: applicant?.kana ?? "",
    phone: applicant?.phone ?? "",
    email: applicant?.email ?? "",
    source: applicant?.source ?? "",
    appliedOn: applicant?.appliedOn || today,
    interviewOn: applicant?.interviewOn ?? "",
    memo: applicant?.memo ?? "",
  };
}

/** 日付の表示（空欄は "—"） */
function dateText(date: string): string {
  return date ? formatDateJa(date) : "—";
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function ApplicantDialog(props: ApplicantDialogProps) {
  const { open, onOpenChange, mode, applicant } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "応募者を追加" : (applicant?.name ?? "応募者")}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "応募を受けた人を登録します。段階は「応募」から始まります。" : "連絡先・必要書類・やりとりを確認できます。"}
          </DialogDescription>
        </DialogHeader>
        {/* 閉じると中身がアンマウントされるため、開くたびにフォーム状態が初期化される */}
        {open && <ApplicantBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function ApplicantBody({ onOpenChange, mode, applicant, events = [], today, canEdit }: ApplicantDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(applicant, today));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [reason, setReason] = useState("");
  const [eventNote, setEventNote] = useState("");
  const [eventDate, setEventDate] = useState(today);
  const [converting, setConverting] = useState(false);
  const [convertName, setConvertName] = useState(applicant?.name ?? "");
  const [convertStart, setConvertStart] = useState(applicant?.startedOn || today);

  const editable = canEdit && !pending;
  const stage = applicant?.stage ?? "applied";
  const progress = checklistProgress(applicant?.checklist ?? {});

  const buildInput = (): ApplicantFormInput => ({
    id: applicant?.id ?? null,
    name: form.name,
    kana: form.kana,
    phone: form.phone,
    email: form.email,
    source: form.source,
    stage: "applied",
    applied_on: form.appliedOn,
    interview_on: form.interviewOn,
    memo: form.memo,
  });

  /** 保存（新規 → createApplicantAction、既存 → updateApplicantAction） */
  const save = () => {
    const input = buildInput();
    const parsed = createApplicantSchema.safeParse(input);
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
      const res = mode === "create" ? await createApplicantAction(input) : await updateApplicantAction(input);
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

  const move = (next: ApplicantStage, note = "") => {
    if (!applicant) return;
    startTransition(async () => {
      const res = await moveApplicantStageAction(applicant.id, next, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${APPLICANT_STAGE_LABELS[next]}にしました`);
      setReason("");
      router.refresh();
    });
  };

  const toggle = (key: ChecklistKey, value: boolean) => {
    if (!applicant) return;
    startTransition(async () => {
      const res = await toggleChecklistAction(applicant.id, key, value);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  };

  const addEvent = () => {
    if (!applicant) return;
    if (eventNote.trim() === "") {
      toast.error("やりとりの内容を入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await addApplicantEventAction(applicant.id, eventDate, eventNote);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "記録しました");
      setEventNote("");
      router.refresh();
    });
  };

  const convert = () => {
    if (!applicant) return;
    startTransition(async () => {
      const res = await convertApplicantToDriverAction(applicant.id, {
        name: convertName,
        kana: applicant.kana,
        phone: applicant.phone,
        email: applicant.email,
        started_on: convertStart,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "ドライバーとして登録しました");
      setConverting(false);
      router.refresh();
    });
  };

  const remove = () => {
    if (!applicant) return;
    if (!window.confirm(`${applicant.name} さんを削除します。やりとりの履歴も消えます。よろしいですか？`)) return;
    startTransition(async () => {
      const res = await deleteApplicantAction(applicant.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      router.refresh();
      onOpenChange(false);
    });
  };

  const forward = nextStage(stage);
  const backward = prevStage(stage);

  return (
    <div className="flex flex-col gap-4">
      {/* 段階 */}
      {mode === "edit" && applicant && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isClosedStage(stage) ? "secondary" : "default"}>{stageLabel(stage)}</Badge>
            <span className="text-xs text-muted-foreground">応募 {dateText(applicant.appliedOn)}</span>
            {applicant.driverName && <Badge variant="success">ドライバー登録済み: {applicant.driverName}</Badge>}
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {backward && (
                <Button size="sm" variant="outline" onClick={() => move(backward)} disabled={!editable}>
                  <ArrowLeft /> {stageLabel(backward)}へ戻す
                </Button>
              )}
              {forward && (
                <Button size="sm" onClick={() => move(forward)} disabled={!editable}>
                  {stageLabel(forward)}へ進める <ArrowRight />
                </Button>
              )}
              {isClosedStage(stage) && (
                <Button size="sm" variant="outline" onClick={() => move("applied")} disabled={!editable}>
                  選考に戻す
                </Button>
              )}
            </div>
          )}
          {canEdit && !isClosedStage(stage) && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="辞退・見送りの理由（任意）"
                maxLength={500}
                disabled={!editable}
                className="h-9 w-full sm:w-64"
              />
              <Button size="sm" variant="ghost" onClick={() => move("declined", reason)} disabled={!editable}>
                本人辞退
              </Button>
              <Button size="sm" variant="ghost" onClick={() => move("rejected", reason)} disabled={!editable}>
                見送り
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 連絡先 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="applicant-name">氏名</Label>
          <Input id="applicant-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={100} disabled={!editable} aria-invalid={!!errors.name} />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-kana">かな（任意）</Label>
          <Input id="applicant-kana" value={form.kana} onChange={(e) => setForm((f) => ({ ...f, kana: e.target.value }))} maxLength={100} disabled={!editable} />
          <FieldError errors={errors} name="kana" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-phone">電話（任意）</Label>
          <Input id="applicant-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={50} disabled={!editable} />
          <FieldError errors={errors} name="phone" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-email">メール（任意）</Label>
          <Input id="applicant-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} maxLength={200} disabled={!editable} aria-invalid={!!errors.email} />
          <FieldError errors={errors} name="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-source">応募元（任意）</Label>
          <Input id="applicant-source" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="例: 求人サイト・紹介" maxLength={100} disabled={!editable} />
          <FieldError errors={errors} name="source" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-applied">応募日</Label>
          <Input id="applicant-applied" type="date" value={form.appliedOn} onChange={(e) => setForm((f) => ({ ...f, appliedOn: e.target.value }))} disabled={!editable} aria-invalid={!!errors.applied_on} />
          <FieldError errors={errors} name="applied_on" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="applicant-interview">面談日（任意）</Label>
          <Input id="applicant-interview" type="date" value={form.interviewOn} onChange={(e) => setForm((f) => ({ ...f, interviewOn: e.target.value }))} disabled={!editable} aria-invalid={!!errors.interview_on} />
          <FieldError errors={errors} name="interview_on" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="applicant-memo">メモ（任意）</Label>
        <Textarea id="applicant-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className="min-h-[56px]" disabled={!editable} />
        <FieldError errors={errors} name="memo" />
      </div>

      {mode === "edit" && applicant && (
        <>
          <Separator />
          {/* 必要書類 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">必要書類</p>
              <span className="num text-sm text-muted-foreground">
                {progress.done}/{progress.total}
              </span>
            </div>
            <ul className="space-y-1.5">
              {CHECKLIST_ITEMS.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`checklist-${item.key}`}
                    checked={applicant.checklist[item.key]}
                    onCheckedChange={(v) => toggle(item.key, v === true)}
                    disabled={!editable}
                  />
                  <Label htmlFor={`checklist-${item.key}`} className="font-normal">
                    {item.label}
                  </Label>
                </li>
              ))}
            </ul>
            {!progress.complete && <p className="text-xs text-muted-foreground">稼働開始までに 4 点すべてを揃えてください。</p>}
          </div>

          <Separator />
          {/* ドライバーとして登録 */}
          <div className="space-y-2">
            <p className="font-medium">ドライバーとして登録</p>
            {applicant.driverId ? (
              <Alert variant="success">
                {applicant.driverName || "ドライバー"} として登録済みです{applicant.startedOn ? `（稼働開始 ${dateText(applicant.startedOn)}）` : ""}。
              </Alert>
            ) : !canEdit ? (
              <p className="text-sm text-muted-foreground">管理者が登録できます。</p>
            ) : !converting ? (
              <Button size="sm" variant="secondary" onClick={() => setConverting(true)} disabled={!editable}>
                <UserCheck /> ドライバーとして登録
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg bg-muted p-3">
                {!progress.complete && <Alert variant="warning">必要書類がまだ {progress.total - progress.done} 点足りません。揃ってから登録することをおすすめします。</Alert>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="convert-name">ドライバー名</Label>
                    <Input id="convert-name" value={convertName} onChange={(e) => setConvertName(e.target.value)} maxLength={100} disabled={!editable} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="convert-start">稼働開始日</Label>
                    <Input id="convert-start" type="date" value={convertStart} onChange={(e) => setConvertStart(e.target.value)} disabled={!editable} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">単価・管理費などは登録後にドライバー設定で入力してください。</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={convert} disabled={!editable}>
                    {pending ? <Loader2 className="animate-spin" /> : <UserCheck />} この内容で登録
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConverting(false)} disabled={pending}>
                    やめる
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />
          {/* やりとり */}
          <div className="space-y-2">
            <p className="font-medium">やりとり（{events.length} 件）</p>
            {canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={!editable} className="sm:w-40" aria-label="やりとりの日付" />
                <Input
                  value={eventNote}
                  onChange={(e) => setEventNote(e.target.value)}
                  placeholder="例: 電話で面談の日程を調整"
                  maxLength={500}
                  disabled={!editable}
                  aria-label="やりとりの内容"
                />
                <Button size="sm" variant="secondary" onClick={addEvent} disabled={!editable} className="h-11 sm:h-10">
                  記録
                </Button>
              </div>
            )}
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ記録がありません。</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-2 border-b pb-1.5 text-sm last:border-0">
                    <span className="num text-xs text-muted-foreground">{e.happenedOn}</span>
                    {e.stage && <Badge variant="outline">{APPLICANT_STAGE_LABELS[e.stage]}</Badge>}
                    <span className="min-w-0 flex-1 break-words">{e.note || "段階を変更しました"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <DialogFooter>
        {mode === "edit" && canEdit && (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="sm:mr-auto text-destructive">
            <Trash2 /> 削除
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          閉じる
        </Button>
        {canEdit && (
          <Button type="button" onClick={save} disabled={!editable}>
            {pending ? "保存中…" : "保存"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
