"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AskForm } from "./ask-form";
import { ConversationList } from "./conversation-list";
import { AnalysisPanel } from "./analysis-panel";
import { DraftPanel } from "./draft-panel";
import { WeeklyPanel } from "./weekly-panel";
import type { AnalysisView, ConversationSummary, WeeklyInsightView } from "./helpers";

export interface AiWorkspaceProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  monthLabel: string;
  aiEnabled: boolean;
  /** 分析・文章の作成ができる（owner/admin） */
  canRun: boolean;
  conversations: ConversationSummary[];
  analysis: AnalysisView | null;
  /** 保存済みの週次サマリー（新しい順） */
  weeks: WeeklyInsightView[];
  /** URL の ?w= で指定された週（無ければ空文字） */
  selectedWeek: string;
  /** これから作る週（先週）のラベル */
  weekTargetLabel: string;
  /** LINE 連携が有効か（admin 以上のときだけ判定できる） */
  lineLinked: boolean;
  /** 最初に開くタブ */
  defaultTab?: AiTab;
}

/** タブの種類 */
export type AiTab = "chat" | "analysis" | "weekly" | "draft";

/** AI の画面（相談する／月次の分析／週次サマリー／文章を作る） */
export function AiWorkspace({
  month,
  monthLabel,
  aiEnabled,
  canRun,
  conversations,
  analysis,
  weeks,
  selectedWeek,
  weekTargetLabel,
  lineLinked,
  defaultTab = "chat",
}: AiWorkspaceProps) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
        <TabsTrigger value="chat">相談する</TabsTrigger>
        <TabsTrigger value="analysis">月次の分析</TabsTrigger>
        <TabsTrigger value="weekly">週次サマリー</TabsTrigger>
        <TabsTrigger value="draft">文章を作る</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="space-y-4">
        <AskForm month={month} monthLabel={monthLabel} aiEnabled={aiEnabled} />
        <ConversationList conversations={conversations} />
      </TabsContent>

      <TabsContent value="analysis">
        <AnalysisPanel month={month} monthLabel={monthLabel} analysis={analysis} aiEnabled={aiEnabled} canRun={canRun} />
      </TabsContent>

      <TabsContent value="weekly">
        <WeeklyPanel weeks={weeks} selectedFrom={selectedWeek} canRun={canRun} lineLinked={lineLinked} targetLabel={weekTargetLabel} />
      </TabsContent>

      <TabsContent value="draft">
        <DraftPanel month={month} monthLabel={monthLabel} aiEnabled={aiEnabled} canRun={canRun} />
      </TabsContent>
    </Tabs>
  );
}
