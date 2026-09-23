"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useRun } from "@/components/office/use-run";
import { setStartPageAction } from "@/lib/actions/office";
import { START_PAGE_LABELS, type StartPage } from "@/lib/schemas/office";
import { cn } from "@/lib/utils";

const OPTIONS: { value: StartPage; hint: string }[] = [
  { value: "dashboard", hint: "売上・利益・警告を最初に見る" },
  { value: "office", hint: "今日やること・承認・月締めの手順を最初に見る（事務の人向け）" },
];

/** 最初に開く画面（ログインしたとき・ロゴを押したとき）。事務は管理者以上だけが選べる */
export function StartPageCard({ initial, canUseOffice }: { initial: StartPage; canUseOffice: boolean }) {
  const [value, setValue] = useState<StartPage>(initial);
  const { pending, run } = useRun();
  const choose = (next: StartPage) => {
    if (next === value) return;
    const prev = value;
    setValue(next);
    run(async () => {
      const res = await setStartPageAction(next);
      if (!res.ok) setValue(prev);
      return res;
    }, "保存しました");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>最初に開く画面</CardTitle>
        <CardDescription>ログインしたとき・左上のロゴを押したときに開く画面です。「事務」にすると、スマホの下のタブの先頭も事務になります。</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="最初に開く画面" className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.filter((o) => o.value !== "office" || canUseOffice).map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              disabled={pending}
              onClick={() => choose(o.value)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                value === o.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
              )}
            >
              <Label className="pointer-events-none text-sm font-semibold">{START_PAGE_LABELS[o.value]}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{o.hint}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
