"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { generateDraftAction } from "@/lib/actions/ai";
import {
  DRAFT_KIND_DESCRIPTIONS,
  DRAFT_KIND_LABELS,
  DRAFT_KINDS,
  DRAFT_TONE_LABELS,
  DRAFT_TONES,
  type DraftKind,
  type DraftTone,
} from "@/lib/schemas/ai";

export interface DraftPanelProps {
  /** 稼動月 "YYYY-MM"（この月の数値を文面に使う） */
  month: string;
  monthLabel: string;
  aiEnabled: boolean;
  /** 文章を作れる（owner/admin） */
  canRun: boolean;
}

/** 文章を作る（取引先向けの月次報告・お知らせ・入金のお願い など） */
export function DraftPanel({ month, monthLabel, aiEnabled, canRun }: DraftPanelProps) {
  const [kind, setKind] = useState<DraftKind>("monthly_report");
  const [to, setTo] = useState("");
  const [tone, setTone] = useState<DraftTone>("polite");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await generateDraftAction(kind, { to, tone, note }, month);
      if (res.ok) {
        setText(res.data.text);
        setCopied(false);
        toast.success(res.message ?? "文章を作成しました");
      } else {
        toast.error(res.error);
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("コピーしました");
    } catch {
      toast.error("コピーできませんでした。文面を選択してコピーしてください。");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" /> 文章を作る
          </CardTitle>
          <CardDescription>{monthLabel}の数値を使って、そのまま送れる日本語の文面を作ります。分からない箇所は 〇〇 のままになります。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="draft-kind">種類</Label>
            <Select id="draft-kind" value={kind} onChange={(e) => setKind(e.target.value as DraftKind)} disabled={!aiEnabled || pending}>
              {DRAFT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DRAFT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{DRAFT_KIND_DESCRIPTIONS[kind]}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="draft-to">宛名（任意）</Label>
              <Input id="draft-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="例：〇〇運輸株式会社 ご担当者様" maxLength={100} disabled={!aiEnabled || pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-tone">文体</Label>
              <Select id="draft-tone" value={tone} onChange={(e) => setTone(e.target.value as DraftTone)} disabled={!aiEnabled || pending}>
                {DRAFT_TONES.map((t) => (
                  <option key={t} value={t}>
                    {DRAFT_TONE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-note">伝えたいこと（任意）</Label>
            <Textarea
              id="draft-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="例：来月から集荷時間が 30 分早くなることを伝えたい"
              disabled={!aiEnabled || pending}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={run} disabled={!aiEnabled || !canRun || pending} aria-busy={pending}>
              {pending ? (
                <>
                  <Loader2 className="animate-spin" /> 作成中…
                </>
              ) : (
                "文章を作る"
              )}
            </Button>
          </div>
          {!canRun && <p className="text-xs text-muted-foreground">文章の作成は管理者以上が実行できます。</p>}
          {!aiEnabled && <p className="text-xs text-muted-foreground">AI 機能を使うには ANTHROPIC_API_KEY の設定が必要です</p>}
        </CardContent>
      </Card>

      {text && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{DRAFT_KIND_LABELS[kind]}</CardTitle>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check /> : <Copy />} コピー
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCopied(false);
              }}
              rows={14}
              aria-label="作成した文章"
              className="min-h-[280px] font-normal"
            />
            <p className="text-[11px] text-muted-foreground">送る前に、宛名・日付・金額が正しいか必ず確認してください。</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
