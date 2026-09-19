"use client";

/**
 * 月次パック：含めるものをチェックで選んで ZIP をダウンロードする（/exports のカード）
 * URL は lib/exports/urls.ts の exportUrls から組み立てる（?parts= を足すだけ）。
 */
import { useState } from "react";
import { Download, PackageCheck } from "lucide-react";
import { exportUrls } from "@/lib/exports/urls";
import {
  DEFAULT_MONTH_PACK_PARTS,
  MONTH_PACK_PARTS,
  MONTH_PACK_PART_DESCRIPTIONS,
  MONTH_PACK_PART_LABELS,
  isEmptyParts,
  monthPackFilename,
  monthPackPartsParam,
  type MonthPackPart,
} from "@/lib/exports/month-pack";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function MonthPackCard({ month, monthLabel, canTransfer }: { month: string; monthLabel: string; canTransfer: boolean }) {
  const [parts, setParts] = useState({ ...DEFAULT_MONTH_PACK_PARTS });
  const choices: MonthPackPart[] = MONTH_PACK_PARTS.filter((p) => canTransfer || p !== "transfer");
  const empty = isEmptyParts(parts);
  const href = exportUrls.monthPackZip(month, [monthPackPartsParam(parts)]);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          月次パック
        </CardTitle>
        <CardDescription>{monthLabel}の一式（明細・請求書・CSV・経営レポート）を 1 つの ZIP にまとめます。月末の保存や税理士への提出に使えます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {choices.map((p) => (
            <label key={p} className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={parts[p]} onCheckedChange={(c) => setParts((prev) => ({ ...prev, [p]: c === true }))} aria-label={MONTH_PACK_PART_LABELS[p]} />
              <span className="min-w-0">
                <span className="font-medium">{MONTH_PACK_PART_LABELS[p]}</span>
                <span className="block text-xs text-muted-foreground">{MONTH_PACK_PART_DESCRIPTIONS[p]}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {empty ? (
            <Button size="sm" disabled>
              <Download className="h-4 w-4" />
              ZIP をダウンロード
            </Button>
          ) : (
            <a href={href} download className={cn(buttonVariants({ size: "sm" }))}>
              <Download className="h-4 w-4" />
              ZIP をダウンロード
            </a>
          )}
          <span className="text-xs text-muted-foreground">{empty ? "含めるものを 1 つ以上選んでください。" : monthPackFilename(month)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          PDF をまとめて作るため、ドライバーや請求書が多い月は 1 分ほどかかることがあります。作れなかったファイルは ZIP の中の README.txt に理由が入ります。
        </p>
      </CardContent>
    </Card>
  );
}
