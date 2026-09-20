"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseNumberInput } from "@/lib/calc";
import { yen } from "@/lib/format";
import { formatDateJa } from "@/lib/month";
import { requestApprovalSchema } from "@/lib/schemas/executive";
import { checkApprovalRequiredAction, requestApprovalAction, type RequestApprovalInput } from "@/lib/actions/approvals";
import { APPROVAL_KIND_LABELS, type ApprovalKind } from "@/lib/db/types";

/**
 * 「この操作は代表の決裁が要ります」を伝えて、申請だけを出す共通のダイアログ。
 *
 * **ここでできるのは申請までで、本処理は通さない。** 承認が出たあとに、代表が（または申請した人が）
 * いつもの画面で登録する導線にしている。画面の文言でもそれが分かるようにしている。
 *
 * 決裁が要るかの判定は必ずサーバー側（DB の approval_rules → `approval_required`）で行う：
 * - 入口を出すかどうか：ページの Server Component が `checkApprovalRequired()` を呼び、その結果を `notice` で渡す
 * - 金額を入れたあと：`checkApprovalRequiredAction()` でその金額のときの判定をもう一度取り直す
 * 画面側にしきい値の金額を書かない（CLAUDE.md の「画面で金額を手書きしない」）。
 */

export interface ApprovalNotice {
  /** その種別（と渡した金額）で代表の決裁が要るか */
  required: boolean;
  /** ルールの名前（例「高額の経費」）。有効なルールが無いときは "" */
  label: string;
  /** 決裁の期限の目安 "YYYY-MM-DD" */
  dueOn: string | null;
}

export interface RequestApprovalDialogProps {
  kind: ApprovalKind;
  /** サーバーの `checkApprovalRequired()` の結果 */
  notice: ApprovalNotice;
  /** 件名の初期値 */
  defaultTitle?: string;
  /** 金額欄を出すか（経費・支払・借入など） */
  withAmount?: boolean;
  /** 金額の初期値（全角・カンマ可） */
  defaultAmount?: string;
  /** 申請の対象（テーブル名と ID。二重申請の確認に使う） */
  refTable?: string;
  refId?: string;
  /** 代表が確認しに行く画面（?m を引き継いだ URL） */
  href?: string;
  /** 入口に添える一言（画面ごとの説明） */
  description?: string;
  className?: string;
}

/** 有効なルールがあるか（required が false でも、金額のしきい値つきのルールがあれば label が入る） */
export function hasApprovalRule(notice: ApprovalNotice): boolean {
  return notice.required || notice.label.trim() !== "";
}

/** 入口に出す見出し */
export function approvalNoticeTitle(kind: ApprovalKind, notice: ApprovalNotice): string {
  const name = notice.label.trim() || APPROVAL_KIND_LABELS[kind];
  return notice.required ? `${name}は代表の決裁が要ります` : `${name}は代表の決裁が要ることがあります`;
}

export function RequestApprovalDialog(props: RequestApprovalDialogProps) {
  const { kind, notice, description, className } = props;
  const [open, setOpen] = useState(false);

  // 有効なルールが無いときは何も出さない（決裁の要らない会社の画面を汚さない）
  if (!hasApprovalRule(notice)) return null;

  return (
    <>
      <Alert variant="warning" className={className}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="font-semibold">{approvalNoticeTitle(kind, notice)}</p>
            <p className="text-xs">{description ?? "先に代表へ申請してください。代表の承認後に登録できます。"}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
            <ShieldCheck /> 代表に決裁をお願いする
          </Button>
        </div>
      </Alert>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>代表に決裁をお願いする</DialogTitle>
            <DialogDescription>
              申請を出すだけで、この操作はまだ実行されません。<strong>代表の承認後に登録できます。</strong>
            </DialogDescription>
          </DialogHeader>
          {/* 閉じると中身がアンマウントされるため、開くたびにフォーム状態が初期化される */}
          {open && <RequestApprovalForm {...props} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type FieldErrors = Record<string, string[]>;

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  const msg = errors[name]?.[0];
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

function RequestApprovalForm({
  kind,
  notice,
  defaultTitle,
  withAmount,
  defaultAmount,
  refTable,
  refId,
  href,
  onDone,
}: RequestApprovalDialogProps & { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [detail, setDetail] = useState("");
  const [amount, setAmount] = useState(defaultAmount ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  /** 入力中の金額での判定（サーバーに聞き直した結果） */
  const [check, setCheck] = useState<ApprovalNotice>(notice);

  // 金額を入れ終わったら、その金額のときに決裁が要るかをサーバーへ聞き直す
  useEffect(() => {
    if (!withAmount) return;
    const id = setTimeout(async () => {
      const res = await checkApprovalRequiredAction(kind, amount);
      if (res.ok) setCheck({ required: res.data.required, label: res.data.label, dueOn: res.data.due_on });
    }, 400);
    return () => clearTimeout(id);
  }, [withAmount, kind, amount]);

  const amountNum = parseNumberInput(amount);

  const submit = () => {
    const input: RequestApprovalInput = {
      kind,
      title,
      detail,
      amount: withAmount ? amount : null,
      ref_table: refTable ?? "",
      ref_id: refId ?? "",
      href: href ?? "",
      due_on: check.dueOn ?? notice.dueOn,
    };
    const parsed = requestApprovalSchema.safeParse(input);
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
      const res = await requestApprovalAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "代表に決裁をお願いしました");
      router.refresh();
      onDone();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="approval-title">件名</Label>
        <Input
          id="approval-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`例: ${APPROVAL_KIND_LABELS[kind]}の登録`}
          maxLength={200}
          disabled={pending}
          aria-invalid={!!errors.title}
        />
        <FieldError errors={errors} name="title" />
      </div>

      {withAmount && (
        <div className="space-y-1.5">
          <Label htmlFor="approval-amount">金額（税抜）</Label>
          <NumberInput
            id="approval-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            disabled={pending}
            aria-invalid={!!errors.amount}
            className="text-lg"
          />
          <p className="text-xs text-muted-foreground">
            {amount.trim() === ""
              ? "金額を入れると、代表の決裁が要るかを確かめます。"
              : check.required
                ? `${yen(amountNum)} は代表の決裁が要ります。`
                : `${yen(amountNum)} は代表の決裁は要りません。そのまま登録できます。`}
          </p>
          <FieldError errors={errors} name="amount" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="approval-detail">内容・理由</Label>
        <Textarea
          id="approval-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={4}
          placeholder="何を、なぜ行いたいかを書いてください。"
          maxLength={4000}
          disabled={pending}
          aria-invalid={!!errors.detail}
        />
        <FieldError errors={errors} name="detail" />
      </div>

      {(check.dueOn ?? notice.dueOn) && (
        <p className="text-xs text-muted-foreground">決裁の期限の目安：{formatDateJa((check.dueOn ?? notice.dueOn) as string)}</p>
      )}

      <Alert>
        この申請では登録は行われません。<strong>代表の承認後に、この画面から登録してください。</strong>
      </Alert>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          やめる
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "送信中…" : "決裁をお願いする"}
        </Button>
      </DialogFooter>
    </div>
  );
}
