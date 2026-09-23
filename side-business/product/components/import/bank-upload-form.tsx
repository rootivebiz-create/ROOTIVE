"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";
import { MAX_FILE_BYTES } from "~/server/features/import/types";

/**
 * 口座のファイルを置く：口座一覧の Excel・CSV か、先月の全銀の振込ファイル（.txt など）。
 * 置いてもまだ台帳には書かない（次の画面で、変わるところを見てから入れる）。
 */
export function BankUploadForm({ action, month }: { action: FormAction; month: string }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const pick = (file: File | undefined) => {
    setFileName(file?.name ?? null);
    setTooBig(!!file && file.size > MAX_FILE_BYTES);
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="month" value={month} />
      <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-card p-6 text-center hover:bg-muted">
        <span className="break-all text-base font-bold">{fileName ?? "ここを押して、口座一覧か振込ファイルを選ぶ"}</span>
        <span className="text-xs text-muted-foreground">Excel（.xlsx）・CSV・全銀の振込ファイル（.txt など）が読めます（10MB まで）</span>
        <input type="file" name="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.dat,.fb" className="sr-only" onChange={(e) => pick(e.currentTarget.files?.[0])} />
      </label>
      {tooBig && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          ファイルが大きすぎます（10MB まで）。
        </p>
      )}
      <Button type="submit" className="w-full sm:w-auto" disabled={pending || !fileName || tooBig}>
        {pending ? "読み込んでいます…" : "読み込む"}
      </Button>
      <p className="text-xs text-muted-foreground">読み込んでも、まだ台帳には入りません。次の画面で、新しく入る人・変わる人を確かめてから入れます。</p>
      <ResultLine state={state} />
    </form>
  );
}
