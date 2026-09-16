"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sprout } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { seedInitialDataAction } from "@/lib/actions/data";
import { countsText } from "./labels";

/** 初期データ投入（admin+、ドライバーが 0 件のときだけ表示される。§8.6） */
export function SeedPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [withEntries, setWithEntries] = useState(true);
  const [open, setOpen] = useState(false);

  const doSeed = () => {
    startTransition(async () => {
      const res = await seedInitialDataAction(withEntries);
      if (res.ok) {
        setOpen(false);
        toast.success(`${res.message ?? "サンプル初期データを投入しました。"} ${countsText(res.data)}`, { duration: 10000 });
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>初期データ投入</CardTitle>
        <CardDescription>
          試作アプリの JSON が無い場合に、サンプルの初期データ（ドライバー 10 名・案件 7 件・個別単価）を投入できます。ドライバーが 0 件のときだけ実行できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={withEntries} onCheckedChange={(v) => setWithEntries(v === true)} disabled={pending} className="mt-0.5" />
          <span>2026 年 9 月の稼働行（計算テストケース §2.6 の 10 行）も投入する</span>
        </label>
        <Button onClick={() => setOpen(true)} disabled={pending}>
          <Sprout /> サンプル初期データを投入（§8.6）
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サンプル初期データを投入しますか？</DialogTitle>
            <DialogDescription>
              ドライバー 10 名、案件 7 件（内容 8 件）、個別単価 2 件{withEntries ? "、2026 年 9 月の稼働行 10 行" : ""}
              を登録します。投入後は通常どおり編集・削除できます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={doSeed} disabled={pending}>
              <Sprout /> {pending ? "投入中…" : "投入する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
