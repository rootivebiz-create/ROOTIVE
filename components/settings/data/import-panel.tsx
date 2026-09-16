"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileJson, Upload } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importBackupAction, previewImportAction } from "@/lib/actions/data";
import type { MigratePreview } from "@/lib/migrate/types";
import { MAX_IMPORT_FILE_BYTES } from "@/lib/schemas/data";
import { formatMonthJa } from "@/lib/month";
import { BACKUP_COUNT_ORDER, countsText, tableLabel } from "./labels";

const FORMAT_LABELS: Record<MigratePreview["format"], string> = {
  prototype: "試作アプリ JSON",
  backup: "本システムのバックアップ",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 取り込み・復元（owner）：ファイル選択 → プレビュー（件数・月別集計）→ 確認 → 取り込み */
export function ImportPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [preview, setPreview] = useState<MigratePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reset = () => {
    setFile(null);
    setJsonText(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_IMPORT_FILE_BYTES) {
      toast.error(`ファイルが大きすぎます（${formatBytes(f.size)}）。15MB 以内の JSON を指定してください。`);
      reset();
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error("ファイルを読み込めませんでした。");
      reset();
    };
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFile({ name: f.name, size: f.size });
      setJsonText(text);
      setPreview(null);
      startTransition(async () => {
        const res = await previewImportAction(text);
        if (res.ok) {
          setPreview(res.data.preview);
        } else {
          toast.error(res.error, { duration: 10000 });
          setPreview(null);
        }
      });
    };
    reader.readAsText(f);
  };

  const doImport = () => {
    if (!jsonText) return;
    startTransition(async () => {
      const res = await importBackupAction(jsonText);
      if (res.ok) {
        setConfirmOpen(false);
        toast.success(`${res.message ?? "取り込みが完了しました。"} ${countsText(res.data.counts)}`, { duration: 12000 });
        reset();
        router.refresh();
      } else {
        toast.error(res.error, { duration: 10000 });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>取り込み・復元（オーナー）</CardTitle>
        <CardDescription>
          試作アプリ（Claude 上の「ROOTIVE 利益管理」）のバックアップ JSON、または本システムのバックアップ JSON を取り込みます。取り込み前に件数と月別集計を表示するので、検算してから実行してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="import-file" className="text-sm font-medium">
            JSON ファイル
          </label>
          <input
            ref={inputRef}
            id="import-file"
            type="file"
            accept=".json,application/json"
            onChange={onFileChange}
            disabled={pending}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
          />
          {file && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileJson className="h-3.5 w-3.5" />
              {file.name}（{formatBytes(file.size)}）
            </p>
          )}
        </div>

        <Alert>
          <AlertDescription>
            同じファイルを何度取り込んでも重複しません（ID は決定的に生成されます）。ID が一致するデータは上書きされます。他社の ID と衝突する場合は拒否されます。
          </AlertDescription>
        </Alert>

        {pending && !preview && file && <p className="text-sm text-muted-foreground">プレビューを作成しています…</p>}

        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={preview.format === "prototype" ? "warning" : "secondary"}>{FORMAT_LABELS[preview.format]}</Badge>
              <span className="text-sm">
                会社名：<span className="font-medium">{preview.companyName ?? "（なし）"}</span>
              </span>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">件数</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted p-3 text-sm md:grid-cols-3">
                {BACKUP_COUNT_ORDER.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{tableLabel(k)}</dt>
                    <dd className="num">{preview.counts[k]} 件</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">月別集計（検算用）</h3>
              {preview.months.length === 0 ? (
                <p className="text-sm text-muted-foreground">稼働データはありません（マスタのみ）。</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>月</TableHead>
                      <TableHead className="text-right">件数</TableHead>
                      <TableHead className="text-right">ドライバー</TableHead>
                      <TableHead className="text-right">売上</TableHead>
                      <TableHead className="text-right">利益</TableHead>
                      <TableHead className="text-right">支払</TableHead>
                      <TableHead>状態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="whitespace-nowrap">{formatMonthJa(m.month)}</TableCell>
                        <TableCell className="num text-right">{m.entryCount}</TableCell>
                        <TableCell className="num text-right">{m.driverCount}</TableCell>
                        <TableCell className="text-right">
                          <Money value={m.bill} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={m.profit} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={m.payout} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.status === "closed" ? "secondary" : "outline"}>{m.status === "closed" ? "締め済み" : "未締め"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>合計</TableCell>
                      <TableCell className="num text-right">{preview.counts.work_entries}</TableCell>
                      <TableCell />
                      <TableCell className="text-right">
                        <Money value={preview.totals.bill} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={preview.totals.profit} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={preview.totals.payout} />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              )}
            </section>

            {preview.warnings.length > 0 && (
              <Alert variant="warning">
                <AlertTitle>注意（{preview.warnings.length} 件）</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {preview.warnings.map((w, i) => (
                      <li key={i} className="break-words">
                        {w}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={reset} disabled={pending}>
                別のファイルを選ぶ
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={pending}>
                <Upload /> 取り込みを実行
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(o) => !pending && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取り込みを実行しますか？</DialogTitle>
            <DialogDescription>
              ID が一致するデータは上書きされます。締め済み月のデータも含めて反映されます。取り消せないため、必要なら先にバックアップ JSON を保存してください。
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted p-3 text-sm">
              <dt className="text-muted-foreground">形式</dt>
              <dd className="text-right">{FORMAT_LABELS[preview.format]}</dd>
              <dt className="text-muted-foreground">稼働行</dt>
              <dd className="num text-right">{preview.counts.work_entries} 件</dd>
              <dt className="text-muted-foreground">売上合計</dt>
              <dd className="text-right">
                <Money value={preview.totals.bill} />
              </dd>
              <dt className="text-muted-foreground">支払合計</dt>
              <dd className="text-right">
                <Money value={preview.totals.payout} />
              </dd>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={doImport} disabled={pending}>
              <Upload /> {pending ? "取り込み中…" : "取り込みを実行"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
