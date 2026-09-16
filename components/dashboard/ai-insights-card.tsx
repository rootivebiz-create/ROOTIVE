"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { generateInsightsAction } from "@/lib/actions/insights";
import { formatDateTimeJa } from "@/lib/format";
import type { InsightFinding } from "@/lib/ai/findings";

export interface AiInsightView {
  model: string;
  createdAt: string;
  findings: InsightFinding[];
}

/** AI 月次分析カード（ANTHROPIC_API_KEY があるときだけ表示される） */
export function AiInsightsCard({ month, insight, canRun }: { month: string; insight: AiInsightView | null; canRun: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await generateInsightsAction(month);
      if (res.ok) {
        toast.success(res.message ?? "AI 月次分析を保存しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI 月次分析
          </CardTitle>
          <CardDescription className="mt-1">
            {insight ? (
              <>
                最終分析: {formatDateTimeJa(insight.createdAt)}
                {insight.model && <span className="ml-1 text-xs">（{insight.model}）</span>}
              </>
            ) : (
              "当月の集計を Claude に渡して、5 項目以内の所見を作成します。"
            )}
          </CardDescription>
        </div>
        {canRun && (
          <Button size="sm" variant={insight ? "outline" : "default"} onClick={run} disabled={pending} aria-busy={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" /> 分析中…
              </>
            ) : insight ? (
              "再分析"
            ) : (
              "分析を実行"
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {pending && <p className="mb-2 text-xs text-muted-foreground">数十秒かかることがあります。このまましばらくお待ちください。</p>}
        {insight && insight.findings.length > 0 ? (
          <ol className="space-y-2">
            {insight.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-medium">{f.title}</p>
                  {f.detail && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{f.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : insight ? (
          <p className="text-sm text-muted-foreground">所見はありませんでした。</p>
        ) : (
          <p className="text-sm text-muted-foreground">{canRun ? "まだ分析していません。「分析を実行」を押すと当月の所見を作成して保存します。" : "まだ分析結果はありません。"}</p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">AI の所見は集計データからの参考情報です。判断の前に元の数値を確認してください。</p>
      </CardContent>
    </Card>
  );
}
