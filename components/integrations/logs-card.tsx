import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeJa } from "@/lib/format";
import { INTEGRATION_KIND_LABELS, type IntegrationLog } from "@/lib/db/types";
import { integrationActionLabel } from "@/lib/integrations/types";

/** 外部連携の実行ログ（直近 20 件） */
export function LogsCard({ rows }: { rows: IntegrationLog[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>実行ログ</CardTitle>
        <CardDescription>接続テスト・送信・バックアップなどの結果（直近 {rows.length} 件）。</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">まだ記録はありません。</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日時</TableHead>
                <TableHead>種類</TableHead>
                <TableHead>内容</TableHead>
                <TableHead className="text-right">結果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTimeJa(row.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{INTEGRATION_KIND_LABELS[row.kind]}</TableCell>
                  <TableCell className="min-w-40 text-xs">
                    <span className="font-medium">{integrationActionLabel(row.action)}</span>
                    {row.message && <span className="block text-muted-foreground">{row.message}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={row.status === "ok" ? "success" : "destructive"}>{row.status === "ok" ? "成功" : "失敗"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
