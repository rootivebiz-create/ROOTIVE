"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

/** コピーできる読み取り専用の入力欄（Webhook URL などに使う） */
export function CopyField({ value, label, hint }: { value: string; label: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={value} readOnly onFocus={(e) => e.currentTarget.select()} className="num text-xs" aria-label={label} />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={async () => {
            const ok = await copyText(value);
            if (ok) {
              setCopied(true);
              toast.success("コピーしました");
              setTimeout(() => setCopied(false), 2000);
            } else {
              toast.error("コピーできませんでした。長押しして選択してください。");
            }
          }}
        >
          {copied ? <Check /> : <Copy />} コピー
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
