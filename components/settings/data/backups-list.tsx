import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportUrls } from "@/lib/exports/urls";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";

export interface BackupRow {
  /** YYYY-MM */
  month: string;
  closedAt: string | null;
  backupPath: string;
}

/** 締め時バックアップ一覧（month_closings の backup_path が非 null、降順） */
export function BackupsList({ rows, canDownload }: { rows: BackupRow[]; canDownload: boolean }) {
  if (rows.length === 0) {
    return <Empty title="締め時バックアップはまだありません" description="月を締めると、その時点のバックアップ JSON が自動保存され、ここからダウンロードできます。" />;
  }
  const link = (r: BackupRow) =>
    canDownload ? (
      <a
        href={exportUrls.monthBackup(r.month)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        aria-label={`${formatMonthJa(r.month)} の締め時バックアップをダウンロード`}
      >
        <Download /> ダウンロード
      </a>
    ) : (
      <span className="text-xs text-muted-foreground">管理者以上</span>
    );

  return (
    <>
      {/* スマホ：カード */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.month} className="flex items-center justify-between gap-2 rounded-md border p-3">
            <div className="min-w-0">
              <p className="font-medium">{formatMonthJa(r.month)}</p>
              <p className="num text-xs text-muted-foreground">締め {formatDateTimeJa(r.closedAt)}</p>
            </div>
            {link(r)}
          </li>
        ))}
      </ul>
      {/* PC：表 */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>稼動月</TableHead>
              <TableHead>締め日時</TableHead>
              <TableHead className="text-right">バックアップ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.month}>
                <TableCell className="whitespace-nowrap font-medium">{formatMonthJa(r.month)}</TableCell>
                <TableCell className="num whitespace-nowrap">{formatDateTimeJa(r.closedAt)}</TableCell>
                <TableCell className="text-right">{link(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
