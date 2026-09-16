"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetMgmtFeeToDefaultAction } from "@/lib/actions/payouts";
import { yen } from "@/lib/format";

/** 明細テキスト（LINE 送付用）をクリップボードへコピー */
export function CopyStatementButton({ text }: { text: string }) {
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unsupported");
      await navigator.clipboard.writeText(text);
      toast.success("明細テキストをコピーしました。LINE 等に貼り付けて送れます。");
    } catch {
      toast.error("コピーできませんでした。ブラウザの設定を確認してください。");
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Copy />
      明細テキストをコピー
    </Button>
  );
}

/** 当月の管理費をドライバー標準値に戻す（admin+・未締めのときだけ表示すること） */
export function ResetMgmtFeeButton({ month, driverId, defaultFee }: { month: string; driverId: string; defaultFee: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = () => {
    startTransition(async () => {
      const res = await resetMgmtFeeToDefaultAction(month, driverId);
      if (res.ok) {
        toast.success(res.message ?? "管理費を標準値に戻しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };
  return (
    <Button type="button" variant="ghost" size="sm" onClick={run} disabled={pending} className="h-7 px-2 text-xs">
      <RotateCcw className="h-3.5 w-3.5" />
      標準（{yen(defaultFee)}）に戻す
    </Button>
  );
}
