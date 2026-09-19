"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { startAiChatAction } from "@/lib/actions/ai";
import { useMonth } from "@/lib/hooks/use-month";
import { SUGGESTED_QUESTIONS } from "./helpers";

export interface AskFormProps {
  /** 稼動月 "YYYY-MM"（この月のデータを渡す） */
  month: string;
  monthLabel: string;
  /** ANTHROPIC_API_KEY が設定されている */
  aiEnabled: boolean;
}

/** 新しい相談（質問を送ると会話を作って /ai/<id> へ移動する） */
export function AskForm({ month, monthLabel, aiEnabled }: AskFormProps) {
  const router = useRouter();
  const { href } = useMonth();
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();

  const ask = (text: string) => {
    const q = text.trim();
    if (!q) {
      toast.error("質問を入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await startAiChatAction(month, q);
      if (res.ok) {
        setQuestion("");
        router.push(href(`/ai/${res.data.conversationId}`));
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> 数字のことを相談する
        </CardTitle>
        <CardDescription>{monthLabel}の売上・利益・経費・資金繰り・案件・ドライバーの数字を渡して回答します。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="例：今月の利益率が先月より下がった理由を教えて"
          rows={3}
          disabled={!aiEnabled || pending}
          aria-label="質問"
        />
        <div className="flex justify-end">
          <Button onClick={() => ask(question)} disabled={!aiEnabled || pending || !question.trim()} aria-busy={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" /> 考えています…
              </>
            ) : (
              <>
                <Send /> 質問する
              </>
            )}
          </Button>
        </div>
        <div>
          <p className="mb-2 text-xs text-muted-foreground">よくある質問</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <Button key={q} size="sm" variant="outline" className="h-auto whitespace-normal py-1.5 text-left" disabled={!aiEnabled || pending} onClick={() => ask(q)}>
                {q}
              </Button>
            ))}
          </div>
        </div>
        {pending && <p className="text-xs text-muted-foreground">回答まで数十秒かかることがあります。</p>}
      </CardContent>
    </Card>
  );
}
