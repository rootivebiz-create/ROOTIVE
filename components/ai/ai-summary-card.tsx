import Link from "next/link";
import { ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeJa } from "@/lib/format";
import type { AnalysisView } from "./helpers";

export interface AiSummaryCardProps {
  /** 稼動月 "YYYY-MM"（リンクに ?m= として引き継ぐ） */
  month: string;
  /** 保存済みの最新の月次分析（無ければ null） */
  analysis: AnalysisView | null;
  /** ANTHROPIC_API_KEY が設定されている */
  aiEnabled: boolean;
}

/**
 * ダッシュボードに置く AI の要約カード（props だけで動く）。
 * 最新の分析の総括と改善策 1 件を出し、詳しくは /ai へ誘導する。
 */
export function AiSummaryCard({ month, analysis, aiEnabled }: AiSummaryCardProps) {
  const action = analysis?.actions[0] ?? null;
  const href = `/ai?m=${month}`;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> AI の経営分析
          </CardTitle>
          <CardDescription className="mt-1">
            {analysis ? `最終分析: ${formatDateTimeJa(analysis.createdAt)}` : "目標・着地見込み・実績から所見と改善策を作ります。"}
          </CardDescription>
        </div>
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          開く <ArrowRight />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {analysis?.summary ? (
          <p className="whitespace-pre-wrap text-sm">{analysis.summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {aiEnabled ? "まだこの月の分析はありません。AI の画面から分析を実行できます。" : "AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です"}
          </p>
        )}
        {action && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">{action.title}</span>
              {action.effect && <Badge variant="success">{action.effect}</Badge>}
            </p>
            {action.detail && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{action.detail}</p>}
            {analysis && analysis.actions.length > 1 && <p className="mt-1 text-xs text-muted-foreground">ほかに {analysis.actions.length - 1} 件の改善策があります。</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
