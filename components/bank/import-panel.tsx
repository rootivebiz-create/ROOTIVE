"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { autoMatchBankAction, deleteBankImportAction, importBankCsvAction, type ImportBankCsvResult } from "@/lib/actions/bank";
import { formatDateTimeJa } from "@/lib/format";
import { importPeriodText, importResultMessage, type BankImportRow } from "./helpers";

/** クライアントでも使う上限（lib/schemas/bank.ts と同じ値） */
const MAX_BYTES = 2 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface ImportPanelProps {
  imports: BankImportRow[];
  /** 取り込みが終わったときに結果を親へ渡す（画面上部のサマリー用） */
  onImported: (result: ImportBankCsvResult) => void;
}

/** CSV の取り込み・自動消込・取り込み履歴（admin+ のときだけ表示する） */
export function ImportPanel({ imports, onImported }: ImportPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankImportRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_BYTES) {
      toast.error(`CSV は 2MB 以下にしてください（${formatBytes(selected.size)}）。`);
      reset();
      return;
    }
    setFile(selected);
  };

  const upload = () => {
    if (!file) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await importBankCsvAction(fd);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(importResultMessage(res.data), { duration: 10000 });
      onImported(res.data);
      reset();
      router.refresh();
    });
  };

  const autoMatch = () => {
    startTransition(async () => {
      const res = await autoMatchBankAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.matched > 0) toast.success(`${res.data.matched} 件を自動で消し込みました。`);
      else toast.info("自動で消し込める明細はありませんでした。金額が一致する未入金の請求書が 1 件だけあるときに消し込みます。");
      router.refresh();
    });
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = await deleteBankImportAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${target.fileName} の取り込みを取り消しました（未消込の ${res.data.deleted} 件を削除）。`);
      setDeleteTarget(null);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>銀行 CSV の取り込み</CardTitle>
        <CardDescription>
          ネットバンキングからダウンロードした入出金明細 CSV をそのまま選んでください（.csv / .txt、2MB まで。UTF-8・Shift_JIS のどちらでも読めます）。
          書式は自動で判定します。同じ明細を 2 回取り込んでも増えません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="bank-csv-file" className="text-sm font-medium">
            入出金明細 CSV
          </label>
          <input
            ref={inputRef}
            id="bank-csv-file"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={onFileChange}
            disabled={pending}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
          />
          {file && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {file.name}（{formatBytes(file.size)}）
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={upload} disabled={pending || !file}>
            <Upload /> {pending ? "取り込み中…" : "取り込む"}
          </Button>
          <Button variant="outline" onClick={autoMatch} disabled={pending}>
            <Wand2 /> 自動で消し込む
          </Button>
        </div>

        {imports.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">取り込み履歴（直近 {imports.length} 件）</p>
            <ul className="divide-y rounded-md border">
              {imports.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={row.fileName}>
                      {row.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeJa(row.createdAt)}／{row.format}／{importPeriodText(row)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.rowCount} 件中 {row.insertedCount} 件を取り込み・{row.matchedCount} 件を自動消込
                      {row.skippedCount > 0 ? `・${row.skippedCount} 件は取り込み済み` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(row)} disabled={pending}>
                    <Trash2 /> 取り消し
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取り込みを取り消す</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.fileName}（{formatDateTimeJa(deleteTarget.createdAt)}）の取り込みを取り消します。未消込の明細と履歴だけを削除し、消込済み・対象外にした明細は残ります。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={pending}>
              {pending ? "取り消し中…" : "取り消す"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
