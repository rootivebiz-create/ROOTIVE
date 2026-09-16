"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { InvitationResult } from "@/lib/actions/users";
import { formatDateTimeJa } from "@/lib/format";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // フォールバックへ
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 招待リンクのコピー用ボタン */
export function CopyLinkButton({ link, size = "sm", label = "リンクをコピー" }: { link: string; size?: "sm" | "default"; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={async () => {
        const ok = await copyText(link);
        if (ok) {
          setCopied(true);
          toast.success("招待リンクをコピーしました");
          setTimeout(() => setCopied(false), 2000);
        } else {
          toast.error("コピーできませんでした。リンクを長押し・選択してコピーしてください。");
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {label}
    </Button>
  );
}

/** 招待リンクの表示（読み取り専用の入力欄 ＋ コピー） */
export function InviteLinkBox({ link }: { link: string }) {
  return (
    <div className="space-y-2">
      <Input value={link} readOnly onFocus={(e) => e.currentTarget.select()} className="num text-xs" aria-label="招待リンク" />
      <div className="flex flex-wrap gap-2">
        <CopyLinkButton link={link} size="default" />
      </div>
      <p className="text-xs text-muted-foreground">メールが届かない人には、このリンクを LINE 等で直接送ってください。リンクを開くだけでログインできます（メール不要）。</p>
    </div>
  );
}

/** 招待・再発行の結果（リンクと送信状況）を表示するダイアログ */
export function InviteResultDialog({ result, onClose, title = "招待リンク" }: { result: InvitationResult | null; onClose: () => void; title?: string }) {
  return (
    <Dialog open={result != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{result ? `有効期限: ${formatDateTimeJa(result.expiresAt)}` : ""}</DialogDescription>
        </DialogHeader>
        {result && (
          <>
            {result.emailSent && <Alert variant="success">招待メールを送信しました。</Alert>}
            {result.warning && <Alert variant="warning">{result.warning}</Alert>}
            <InviteLinkBox link={result.link} />
          </>
        )}
        <DialogFooter>
          <Button onClick={onClose}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
