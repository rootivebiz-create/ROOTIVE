"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { Notice } from "~/components/page";
import { markManySentAction } from "~/app/(app)/statements/actions";

type Note = { tone: "ok" | "error" | "info"; text: string } | null;

/**
 * 送る一覧（名前とリンク）をまとめてコピーする（LINE・LINE WORKS に 1 人ずつ貼るため）。
 * コピーしただけでは送った記録をつけない。貼って送り終えたら「送った記録をつける」を押す。
 */
export function SendListCopy({ ids, text, count }: { ids: string[]; text: string; count: number }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setNote({ tone: "ok", text: `${count}人分の名前とリンクをコピーしました。1 人ずつ、その人とのトークに貼って送ってください` });
    } catch {
      setCopied(true);
      setNote({ tone: "info", text: "自動でコピーできませんでした。下の一覧を長押し（または右クリック）してコピーしてください" });
    }
  }

  function markAll() {
    startTransition(async () => {
      const r = await markManySentAction(ids);
      setNote(r.ok ? { tone: "ok", text: `${r.data?.count ?? count}人に送った記録をつけました（前に送った日時は変わりません）` } : { tone: "error", text: r.error });
    });
  }

  return (
    <details className="rounded-card border border-border bg-card px-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold">送る一覧をコピー（名前とリンク・{count}人）</summary>
      <div className="space-y-2 pb-3">
        <p className="text-muted-foreground">
          リンクは 1 人ずつ別のものです。グループのトークには貼らず、その人とのトークに貼ってください（リンクを知った人は、その人の明細を見られます）。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy} disabled={pending}>
            名前とリンクをコピー
          </Button>
          {copied && (
            <Button variant="secondary" onClick={markAll} disabled={pending}>
              {pending ? "記録しています…" : `送り終えたら：${count}人に送った記録をつける`}
            </Button>
          )}
        </div>
        <textarea
          readOnly
          value={text}
          rows={Math.min(8, count + 1)}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="送る一覧"
          className="block w-full rounded-lg border border-border bg-muted p-2 font-mono text-xs text-foreground"
        />
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </details>
  );
}
