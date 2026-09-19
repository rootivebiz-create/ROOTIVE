"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { generateAnalysisAction } from "@/lib/actions/ai";
import { formatDateTimeJa } from "@/lib/format";
import { INSIGHT_SEVERITY_LABELS } from "@/lib/ai/findings";
import { severityVariant, type AnalysisView } from "./helpers";

export interface AnalysisPanelProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  monthLabel: string;
  /** 保存済みの最新の分析（無ければ null） */
  analysis: AnalysisView | null;
  aiEnabled: boolean;
  /** 分析を実行できる（owner/admin） */
  canRun: boolean;
}

/** 月次の分析（目標 × 着地見込み × 実績）と改善策 */
export function AnalysisPanel({ month, monthLabel, analysis, aiEnabled, canRun }: AnalysisPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await generateAnalysisAction(month);
      if (res.ok) {
        toast.success(res.message ?? "AI 月次分析を保存しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {monthLabel}の分析
            </CardTitle>
            <CardDescription className="mt-1">
              {analysis ? (
                <>
                  最終分析: {formatDateTimeJa(analysis.createdAt)}
                  {analysis.model && <span className="ml-1 text-xs">（{analysis.model}）</span>}
                </>
              ) : (
                "目標・着地見込み・実績を突き合わせて、所見と改善策を作成します。"
              )}
            </CardDescription>
          </div>
          {canRun && (
            <Button size="sm" variant={analysis ? "outline" : "default"} onClick={run} disabled={!aiEnabled || pending} aria-busy={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" /> 分析中…
                </>
              ) : analysis ? (
                "再分析"
              ) : (
                "分析を実行"
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {pending && <p className="mb-2 text-xs text-muted-foreground">数十秒かかることがあります。このまましばらくお待ちください。</p>}
          {analysis?.summary ? (
            <p className="whitespace-pre-wrap text-sm">{analysis.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {!aiEnabled
                ? "AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です"
                : canRun
                  ? "まだ分析していません。「分析を実行」を押すとこの月の所見と改善策を作成して保存します。"
                  : "まだ分析結果はありません。"}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">気になる点</CardTitle>
        </CardHeader>
        <CardContent>
          {analysis && analysis.findings.length > 0 ? (
            <ol className="space-y-3">
              {analysis.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="min-w-0">{f.title}</span>
                      <Badge variant={severityVariant(f.severity)}>{INSIGHT_SEVERITY_LABELS[f.severity]}</Badge>
                    </p>
                    {f.detail && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{f.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="所見はまだありません" description="分析を実行すると、重要な順に最大 5 件の所見が出ます。" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-primary" /> 改善策
          </CardTitle>
          <CardDescription>データから概算できるものには効果額の目安が付きます。</CardDescription>
        </CardHeader>
        <CardContent>
          {analysis && analysis.actions.length > 0 ? (
            <ul className="space-y-3">
              {analysis.actions.map((a, i) => (
                <li key={i} className="rounded-lg border p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="min-w-0">{a.title}</span>
                    {a.effect && <Badge variant="success">{a.effect}</Badge>}
                  </p>
                  {a.detail && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.detail}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="改善策はまだありません" description="分析を実行すると、明日から試せる改善策が最大 3 件出ます。" />
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">AI の所見と改善策は集計データからの参考情報です。判断の前に元の数値を確認してください。</p>
    </div>
  );
}
