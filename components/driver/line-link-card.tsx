"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeJa } from "@/lib/format";
import { issueLineCodeAction, unlinkLineAction } from "@/lib/actions/integrations";

/** ドライバー本人の LINE 連携（合言葉の発行・解除） */
export function LineLinkCard({ linked, linkedAt }: { linked: boolean; linkedAt: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");

  const issue = () => {
    startTransition(async () => {
      const res = await issueLineCodeAction();
      if (res.ok) setCode(res.data.code);
      else toast.error(res.error);
    });
  };

  const unlink = () => {
    startTransition(async () => {
      const res = await unlinkLineAction();
      if (res.ok) {
        toast.success(res.message ?? "連携を解除しました。");
        setCode("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <CardTitle>LINE で受け取る</CardTitle>
          {linked && <Badge variant="success">連携済み</Badge>}
        </div>
        <CardDescription>支払明細ができたときのお知らせを LINE で受け取れます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {linked ? (
          <>
            <p className="text-sm text-muted-foreground">連携日: {formatDateTimeJa(linkedAt)}</p>
            <Button variant="outline" onClick={unlink} disabled={pending}>
              <Unlink /> {pending ? "解除中…" : "連携を解除する"}
            </Button>
          </>
        ) : (
          <>
            {code ? (
              <div className="space-y-2">
                <div className="rounded-md border bg-muted p-4 text-center">
                  <p className="num text-3xl font-bold tracking-[0.3em]">{code}</p>
                </div>
                <Alert>
                  LINE で会社の公式アカウントを友だち追加して、この 6 桁をそのまま送ってください（30 分間有効）。
                </Alert>
                <Button variant="outline" onClick={issue} disabled={pending}>
                  {pending ? "発行中…" : "合言葉を出し直す"}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">「合言葉を出す」を押すと 6 桁の数字が出ます。LINE の公式アカウントにその数字を送ると連携できます。</p>
                <Button onClick={issue} disabled={pending}>
                  {pending ? "発行中…" : "合言葉を出す"}
                </Button>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
