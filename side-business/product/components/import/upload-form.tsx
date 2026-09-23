"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";

/**
 * ファイルを置く。スマホでは大きな押せる枠、パソコンでは枠にドラッグしても置ける。
 * 「見本で試す」は、架空の会社の Excel をサーバーの見本から読む（ファイルを持っていない人向け）。
 */
export function UploadForm({ action, month, showSamples }: { action: FormAction; month: string; showSamples: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="month" value={month} />
      <label
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed p-6 text-center transition ${
          dragging ? "border-foreground bg-muted" : "border-border bg-card hover:bg-muted"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const input = e.currentTarget.querySelector<HTMLInputElement>("input[type=file]");
          if (input && e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            setFileName(e.dataTransfer.files[0].name);
          }
        }}
      >
        <span className="text-base font-bold">{fileName ?? "ここを押して、稼働の Excel・CSV を選ぶ"}</span>
        <span className="text-xs text-muted-foreground">
          {fileName ? "別のファイルにするときは、もう一度押してください" : "パソコンなら、ここへドラッグしても置けます（10MB まで）"}
        </span>
        <input
          type="file"
          name="file"
          accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.pdf"
          className="sr-only"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </label>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending || !fileName}>
        {pending ? "読み込んでいます…" : "読み込む"}
      </Button>
      <p className="text-xs text-muted-foreground">読み込んでも、まだ稼働には入りません。次の画面で中身を確かめてから「反映する」を押します。</p>
      {showSamples && (
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <p className="text-sm font-bold">手元にファイルが無いときは、見本で試せます（架空の会社の 10 月分）</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="submit" name="sample" value="long" variant="secondary" disabled={pending}>
              見本：1 行 1 件の表
            </Button>
            <Button type="submit" name="sample" value="wide" variant="secondary" disabled={pending}>
              見本：人 × 案件の表
            </Button>
          </div>
        </div>
      )}
      <ResultLine state={state} />
    </form>
  );
}
