"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Lightbulb, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Alert } from "@/components/ui/alert";
import { generateWeeklySummaryAction, sendWeeklySummaryAction } from "@/lib/actions/insights";
import { formatDateTimeJa } from "@/lib/format";
import { INSIGHT_SEVERITY_LABELS } from "@/lib/ai/findings";
import { severityVariant, type WeeklyInsightView } from "./helpers";

export interface WeeklyPanelProps {
  /** 保存済みの週次サマリー（新しい順） */
  weeks: WeeklyInsightView[];
  /** URL の ?w= で指定された週（無ければ空文字） */
  selectedFrom: string;
  /** 作成・送信ができる（owner/admin） */
  canRun: boolean;
  /** LINE 連携が有効か（admin 以上のときだけ判定できる） */
  lineLinked: boolean;
  /** これから作る週（先週）のラベル */
  targetLabel: string;
}

/**
 * 週次サマリー（毎週月曜の朝に LINE へ届くもの）の履歴。
 * 一覧から週を選ぶと、その週の総括・要点・やるべきことを表示する。
 */
export function WeeklyPanel({ weeks, selectedFrom, canRun, lineLinked, targetLabel }: WeeklyPanelProps) {
  const router = useRouter();
  const [creating, startCreate] = useTransition();
  const [sending, startSend] = useTransition();
  const initial = weeks.find((w) => w.from === selectedFrom)?.id ?? weeks[0]?.id ?? "";
  const [activeId, setActiveId] = useState(initial);
  const active = weeks.find((w) => w.id === activeId) ?? weeks[0] ?? null;

  const create = () => {
    startCreate(async () => {
      const res = await generateWeeklySummaryAction();
      if (res.ok) {
        toast.success(res.message ?? "週次サマリーを作成しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const send = () => {
    if (!active) return;
    startSend(async () => {
      const res = await sendWeeklySummaryAction(active.from);
      if (res.ok) {
        toast.success(`${res.data.label}のサマリーを ${res.data.sent} 人に送りました`);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4 text-primary" /> 週次サマリー
            </CardTitle>
            <CardDescription className="mt-1">毎週月曜の朝に、先週の経営サマリーが LINE に届きます。ここには履歴が残ります。</CardDescription>
          </div>
          {canRun && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={create} disabled={creating} aria-busy={creating}>
                {creating ? (
                  <>
                    <Loader2 className="animate-spin" /> 作成中…
                  </>
                ) : (
                  "今週ぶんを作る"
                )}
              </Button>
              <Button size="sm" onClick={send} disabled={!active || sending} aria-busy={sending}>
                {sending ? (
                  <>
                    <Loader2 className="animate-spin" /> 送信中…
                  </>
                ) : (
                  <>
                    <Send /> LINE に送る
                  </>
                )}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {canRun && <p className="text-xs text-muted-foreground">「今週ぶんを作る」は先週（{targetLabel}）の数字でサマリーを作り直します。</p>}
          {canRun && !lineLinked && (
            <Alert variant="warning">LINE 連携がまだです。設定 → 外部連携 で LINE をつなぐと、毎週月曜の朝にこのサマリーが届きます。</Alert>
          )}
          {weeks.length > 0 ? (
            <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
              {weeks.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setActiveId(w.id)}
                  aria-pressed={w.id === active?.id}
                  className={`shrink-0 snap-start rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    w.id === active?.id ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="block font-medium">{w.label || "（期間不明）"}</span>
                  <span className="block text-[11px] text-muted-foreground">{formatDateTimeJa(w.createdAt)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {active ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{active.label || "週次サマリー"}</CardTitle>
              <CardDescription>
                作成: {formatDateTimeJa(active.createdAt)}
                {active.model ? <span className="ml-1 text-xs">（{active.model}）</span> : <span className="ml-1 text-xs">（AI 無し・数字のみ）</span>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {active.summary ? (
                <p className="whitespace-pre-wrap text-sm">{active.summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">総括はありません。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">先週の要点</CardTitle>
            </CardHeader>
            <CardContent>
              {active.findings.length > 0 ? (
                <ol className="space-y-3">
                  {active.findings.map((f, i) => (
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
                <Empty title="要点はまだありません" description="サマリーを作ると、先週の要点が最大 3 件出ます。" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="h-4 w-4 text-primary" /> 今週やること
              </CardTitle>
              <CardDescription>データから概算できるものには効果額の目安が付きます。</CardDescription>
            </CardHeader>
            <CardContent>
              {active.actions.length > 0 ? (
                <ul className="space-y-3">
                  {active.actions.map((a, i) => (
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
                <Empty title="やることはまだありません" description="ANTHROPIC_API_KEY を設定すると、今週やるべきことが最大 3 件出ます。" />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Empty
          title="週次サマリーはまだありません"
          description="毎週月曜の朝に、先週の経営サマリーが LINE に届きます。ここには履歴が残ります。"
        />
      )}

      <p className="text-[11px] text-muted-foreground">週次サマリーは集計データからの参考情報です。判断の前に元の数値を確認してください。</p>
    </div>
  );
}
