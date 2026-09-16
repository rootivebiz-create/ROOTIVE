"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetCompanyDataAction } from "@/lib/actions/data";
import { countsText } from "./labels";

/** データ全削除（owner）。会社名を入力して一致したときだけ実行できる */
export function ResetPanel({ companyName }: { companyName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const matched = value.trim() === companyName;

  const doReset = () => {
    if (!matched) return;
    startTransition(async () => {
      const res = await resetCompanyDataAction(value.trim());
      if (res.ok) {
        setOpen(false);
        setValue("");
        toast.success(`${res.message ?? "会社のデータをすべて削除しました。"} ${countsText(res.data)}`, { duration: 12000 });
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">データ全削除（オーナー）</CardTitle>
        <CardDescription>
          ドライバー・案件・個別単価・固定控除・稼働行・管理費・調整・月締めをすべて削除します。ユーザー・招待・会社設定は残ります。取り消せないため、先にバックアップ JSON を保存してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="reset-company-name">
            確認のため会社名「<span className="font-semibold">{companyName}</span>」を入力
          </Label>
          <Input
            id="reset-company-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={companyName}
            autoComplete="off"
            disabled={pending}
            aria-describedby="reset-company-name-hint"
          />
          <p id="reset-company-name-hint" className="text-xs text-muted-foreground">
            会社名が一致するとボタンが有効になります。
          </p>
        </div>
        <Button variant="destructive" onClick={() => setOpen(true)} disabled={!matched || pending}>
          <Trash2 /> データを全削除
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>本当にすべて削除しますか？</DialogTitle>
            <DialogDescription>
              「{companyName}」のドライバー・案件・稼働・調整・月締めがすべて削除されます。この操作は取り消せません（監査ログには件数が記録されます）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={doReset} disabled={pending || !matched}>
              <Trash2 /> {pending ? "削除中…" : "すべて削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
