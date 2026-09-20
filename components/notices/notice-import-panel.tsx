"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Money, Qty } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { importNoticeItemsAction, previewNoticeCsvAction, type NoticeCsvPreview } from "@/lib/actions/notices";
import {
  MAX_NOTICE_CSV_BYTES,
  NOTICE_CSV_ACCEPT,
  NOTICE_CSV_SUPPORT_TEXT,
  NOTICE_IMPORT_MODE_LABELS,
  NOTICE_IMPORT_MODES,
  type NoticeImportMode,
} from "@/lib/schemas/notices";

export interface NoticeImportPanelProps {
  noticeId: string;
  /** 今ある明細の件数（置き換えの案内に使う） */
  itemCount: number;
}

const PREVIEW_LIMIT = 20;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** CSV ファイル・貼り付けから明細を取り込む（admin+ のときだけ表示する） */
export function NoticeImportPanel({ noticeId, itemCount }: NoticeImportPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<NoticeCsvPreview | null>(null);
  const [mode, setMode] = useState<NoticeImportMode>("replace");
  const inputRef = useRef<HTMLInputElement>(null);

  const resetFile = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_NOTICE_CSV_BYTES) {
      toast.error(`CSV は ${MAX_NOTICE_CSV_BYTES / 1024 / 1024}MB 以下にしてください（${formatBytes(selected.size)}）。`);
      resetFile();
      return;
    }
    setPreview(null);
    setFile(selected);
  };

  const runPreview = () => {
    const fd = new FormData();
    if (tab === "file") {
      if (!file) {
        toast.error("CSV ファイルを選んでください。");
        return;
      }
      fd.append("file", file);
    } else {
      if (text.trim() === "") {
        toast.error("支払通知書の表を貼り付けてください。");
        return;
      }
      fd.append("text", text);
    }
    startTransition(async () => {
      const res = await previewNoticeCsvAction(fd);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      setPreview(res.data);
      if (res.data.rows.length === 0) toast.error("取り込める明細がありませんでした。列の見出しと中身を確認してください。", { duration: 10000 });
      else toast.success(`${res.data.rows.length} 行を読み取りました。内容を確認して「取り込む」を押してください。`);
    });
  };

  const runImport = () => {
    if (!preview || preview.rows.length === 0) return;
    const rows = preview.rows.map((r) => ({ raw_name: r.raw_name, qty: r.qty, unit_price: r.unit_price, amount: r.amount }));
    startTransition(async () => {
      const res = await importNoticeItemsAction({ notice_id: noticeId, mode, rows });
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      const matched = res.data.matched > 0 ? `／${res.data.matched} 行に案件内容を自動で紐づけました` : "";
      toast.success(`${res.data.inserted} 行を取り込みました${matched}`, { duration: 8000 });
      setPreview(null);
      setText("");
      resetFile();
      router.refresh();
    });
  };

  const rows = preview?.rows ?? [];
  const shown = rows.slice(0, PREVIEW_LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle>明細を取り込む</CardTitle>
        <CardDescription>
          元請の支払明細書の CSV をそのまま選ぶか、PDF の表をコピーして貼り付けてください。列（内容・数量・単価・金額）は自動で判定し、読み取った結果を確認してから登録します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v === "paste" ? "paste" : "file")}>
          <TabsList>
            <TabsTrigger value="file">
              <FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden /> ファイル
            </TabsTrigger>
            <TabsTrigger value="paste">
              <ClipboardPaste className="mr-1 h-4 w-4" aria-hidden /> 貼り付け
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-2">
            <Label htmlFor="notice-csv-file">支払明細書の CSV</Label>
            <input
              ref={inputRef}
              id="notice-csv-file"
              type="file"
              accept={NOTICE_CSV_ACCEPT}
              onChange={onFileChange}
              disabled={pending}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
            />
            {file && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                {file.name}（{formatBytes(file.size)}）
              </p>
            )}
            <p className="text-xs text-muted-foreground">{NOTICE_CSV_SUPPORT_TEXT}</p>
          </TabsContent>

          <TabsContent value="paste" className="space-y-2">
            <Label htmlFor="notice-paste">支払明細書の表</Label>
            <Textarea
              id="notice-paste"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
              rows={8}
              className="min-h-[9rem] font-mono text-xs"
              placeholder={"内容\t数量\t単価\t金額\n板橋エリア 定期便\t20\t23,025\t460,500\nスポット便\t3\t12,000\t36,000"}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              PDF の表をそのままコピーして貼れます。タブ区切り・コンマ区切り・空白で桁を揃えた表のどれでも読み取ります。
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap gap-2">
          <Button onClick={runPreview} disabled={pending}>
            {pending ? "読み取り中…" : "内容を確認"}
          </Button>
          {preview && (
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={pending}>
              やり直す
            </Button>
          )}
        </div>

        {preview && (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">
                読み取り結果：{rows.length} 行・合計 <Money value={preview.total} />
                {preview.skipped > 0 && <span className="text-muted-foreground">（読み飛ばし {preview.skipped} 行）</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {preview.fileName ? `${preview.fileName}／` : ""}
                {preview.encoding}／{preview.delimiter}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium">読み取った列</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {preview.columnReport.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            {preview.notes.length > 0 && (
              <Alert>
                <ul className="space-y-1 text-sm">
                  {preview.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {preview.errors.length > 0 && (
              <Alert variant="warning">
                <p className="text-sm font-semibold">取り込まなかった行</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {preview.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {rows.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>内容</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                      <TableHead className="text-right">単価</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={`${r.line}-${r.raw_name}`}>
                        <TableCell className="max-w-[14rem] break-words">
                          {r.raw_name}
                          {r.derived && <span className="ml-1 text-xs text-muted-foreground">{r.derived === "amount" ? "（金額を計算）" : "（単価を計算）"}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Qty value={r.qty} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={r.unit_price} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={r.amount} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > shown.length && <p className="text-xs text-muted-foreground">ほか {rows.length - shown.length} 行（取り込みはすべての行が対象です）</p>}

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="notice-import-mode">取り込み方</Label>
                    <Select
                      id="notice-import-mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value === "append" ? "append" : "replace")}
                      disabled={pending}
                      className="w-auto"
                    >
                      {NOTICE_IMPORT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {NOTICE_IMPORT_MODE_LABELS[m]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button onClick={runImport} disabled={pending}>
                    <Upload /> {pending ? "取り込み中…" : `${rows.length} 行を取り込む`}
                  </Button>
                </div>
                {mode === "replace" && itemCount > 0 && (
                  <p className="text-xs text-destructive">今ある明細 {itemCount} 件を消してから入れ直します（紐づけた案件内容も消えます）。</p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
