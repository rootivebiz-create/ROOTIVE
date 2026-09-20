/** AI 画面で共用する表示用の型と小さな純関数（サーバー・クライアント共用） */
import type { InsightAction, InsightFindingDetail, InsightSeverity } from "@/lib/ai/findings";

/** 会話一覧の 1 行（v_ai_conversation_list から作る） */
export interface ConversationSummary {
  id: string;
  title: string;
  /** 稼動月 "YYYY-MM"（未設定なら null） */
  month: string | null;
  messageCount: number;
  lastMessageAt: string;
  /** 最後の発言（一覧のプレビュー） */
  lastRole: "user" | "assistant" | "";
  lastContent: string;
  /** 削除ボタンを出すか（作成者本人か管理者。実際の可否は Server Action でも確認する） */
  canDelete: boolean;
}

/** 会話の 1 発言 */
export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string;
  createdAt: string;
}

/** 保存済みの月次分析（ai_insights の kind='monthly'） */
export interface AnalysisView {
  model: string;
  createdAt: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
}

/** 所見の重さ → Badge の見た目 */
export function severityVariant(severity: InsightSeverity): "destructive" | "warning" | "secondary" {
  return severity === "high" ? "destructive" : severity === "medium" ? "warning" : "secondary";
}

/** 一覧のプレビュー用に本文を切り詰める */
export function preview(text: string, max = 60): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** よくある質問（ワンタップで送れるボタン） */
export const SUGGESTED_QUESTIONS: string[] = [
  "今月の着地はどう？",
  "利益率が下がった原因は？",
  "来月の資金は足りる？",
  "単価を上げるならどの案件？",
  "赤字になっているドライバーはいる？",
  "経費で見直せるところは？",
];

/** 保存済みの週次サマリー（ai_insights の kind='weekly'）。画面に渡す形 */
export interface WeeklyInsightView {
  id: string;
  /** 週のはじめ（月曜）"YYYY-MM-DD" */
  from: string;
  /** 週のおわり（日曜） */
  to: string;
  /** 「2026年9月8日〜9月14日」 */
  label: string;
  createdAt: string;
  model: string;
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
}
