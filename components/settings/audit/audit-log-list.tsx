import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeJa } from "@/lib/format";
import type { ChangeLine } from "./diff";

/** 画面表示用に整形済みの 1 行（page.tsx で作る） */
export interface AuditRowView {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  actionLabel: string;
  tableLabel: string;
  target: string;
  lines: ChangeLine[];
  /** 全 JSON（整形済み。details で折りたたみ表示） */
  beforeJson: string;
  afterJson: string;
}

const ACTION_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive" | "success" | "warning"> = {
  INSERT: "success",
  UPDATE: "secondary",
  DELETE: "destructive",
  close_month: "default",
  reopen_month: "warning",
  import_backup: "warning",
  reset_company_data: "destructive",
};

function ActionBadge({ row }: { row: AuditRowView }) {
  return <Badge variant={ACTION_VARIANT[row.action] ?? "outline"}>{row.actionLabel}</Badge>;
}

/** 差分：UPDATE は「キー: 旧 → 新」、INSERT/DELETE は主要項目 */
function Changes({ lines }: { lines: ChangeLine[] }) {
  if (lines.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {lines.map((l) => (
        <li key={l.key} className="flex flex-wrap items-center gap-x-1">
          <span className="text-muted-foreground">{l.label}:</span>
          {l.before !== undefined && l.after !== undefined ? (
            <>
              <span className="break-all line-through decoration-muted-foreground/60">{l.before}</span>
              <ArrowRight className="inline h-3 w-3 shrink-0 text-muted-foreground" aria-label="→" />
              <span className="break-all font-medium">{l.after}</span>
            </>
          ) : (
            <span className="break-all font-medium">{l.after ?? l.before}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 全 JSON の折りたたみ（JS 不要の details） */
function Details({ row }: { row: AuditRowView }) {
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer select-none text-primary hover:underline">詳細</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <p className="mb-1 font-medium text-muted-foreground">変更前</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">{row.beforeJson}</pre>
        </div>
        <div>
          <p className="mb-1 font-medium text-muted-foreground">変更後</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">{row.afterJson}</pre>
        </div>
      </div>
    </details>
  );
}

export function AuditLogList({ rows }: { rows: AuditRowView[] }) {
  if (rows.length === 0) {
    return <Empty title="該当する監査ログはありません" description="条件を変えるか、絞り込みを解除してください。" />;
  }
  return (
    <>
      {/* スマホ：カード */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="num text-xs text-muted-foreground">{formatDateTimeJa(r.createdAt)}</span>
              <ActionBadge row={r} />
            </div>
            <p className="mt-1 text-sm">
              <span className="font-medium">{r.tableLabel}</span>
              <span className="text-muted-foreground"> ／ </span>
              <span className="break-all">{r.target}</span>
            </p>
            <p className="text-xs text-muted-foreground">操作者: {r.actorName}</p>
            <div className="mt-2">
              <Changes lines={r.lines} />
            </div>
            <div className="mt-2">
              <Details row={r} />
            </div>
          </Card>
        ))}
      </div>

      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日時</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>テーブル</TableHead>
              <TableHead>対象</TableHead>
              <TableHead>差分</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="num whitespace-nowrap align-top">{formatDateTimeJa(r.createdAt)}</TableCell>
                <TableCell className="max-w-[10rem] truncate align-top" title={r.actorName}>
                  {r.actorName}
                </TableCell>
                <TableCell className="align-top">
                  <ActionBadge row={r} />
                </TableCell>
                <TableCell className="whitespace-nowrap align-top">{r.tableLabel}</TableCell>
                <TableCell className="max-w-[14rem] break-words align-top">{r.target}</TableCell>
                <TableCell className="min-w-[16rem] align-top">
                  <Changes lines={r.lines} />
                  <div className="mt-1">
                    <Details row={r} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
