"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AskForm } from "./ask-form";
import { ConversationList } from "./conversation-list";
import { AnalysisPanel } from "./analysis-panel";
import { DraftPanel } from "./draft-panel";
import type { AnalysisView, ConversationSummary } from "./helpers";

export interface AiWorkspaceProps {
  /** 稼動月 "YYYY-MM" */
  month: string;
  monthLabel: string;
  aiEnabled: boolean;
  /** 分析・文章の作成ができる（owner/admin） */
  canRun: boolean;
  conversations: ConversationSummary[];
  analysis: AnalysisView | null;
  /** 最初に開くタブ */
  defaultTab?: "chat" | "analysis" | "draft";
}

/** AI の画面（相談する／月次の分析／文章を作る） */
export function AiWorkspace({ month, monthLabel, aiEnabled, canRun, conversations, analysis, defaultTab = "chat" }: AiWorkspaceProps) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="chat">相談する</TabsTrigger>
        <TabsTrigger value="analysis">月次の分析</TabsTrigger>
        <TabsTrigger value="draft">文章を作る</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="space-y-4">
        <AskForm month={month} monthLabel={monthLabel} aiEnabled={aiEnabled} />
        <ConversationList conversations={conversations} />
      </TabsContent>

      <TabsContent value="analysis">
        <AnalysisPanel month={month} monthLabel={monthLabel} analysis={analysis} aiEnabled={aiEnabled} canRun={canRun} />
      </TabsContent>

      <TabsContent value="draft">
        <DraftPanel month={month} monthLabel={monthLabel} aiEnabled={aiEnabled} canRun={canRun} />
      </TabsContent>
    </Tabs>
  );
}
