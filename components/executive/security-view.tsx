/**
 * 守り（/executive/security）の一覧部分。
 * 読むだけなのでサーバー部品のまま（props だけで動く）。機密の見せ方のフォームだけがクライアント。
 */
import { DoorOpen, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LOGIN_EVENT_LABELS, ROLE_LABELS, type ExportLogRow, type LoginEvent, type Role } from "@/lib/db/types";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { deviceText, exportKindLabel } from "./helpers";

function RoleBadge({ role }: { role: Role | null }) {
  if (!role) return <span className="text-muted-foreground">—</span>;
  const variant = role === "owner" ? "default" : role === "admin" ? "success" : role === "driver" ? "outline" : "secondary";
  return <Badge variant={variant}>{ROLE_LABELS[role]}</Badge>;
}

/** 出力の対象の月（月が無い出力もある） */
function monthText(month: string | null): string {
  return month && /^\d{4}-\d{2}/.test(month) ? formatMonthJa(month.slice(0, 7)) : "—";
}

export function LoginEventsCard({ events }: { events: LoginEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DoorOpen className="h-4 w-4 text-muted-foreground" />
          ログインの記録
        </CardTitle>
        <CardDescription>誰がいつ入ったかの記録です。1 年で自動的に消えます（必要以上に個人の行動履歴を残しません）。</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <Empty title="まだ記録がありません" description="次にだれかがログインすると、ここに日時と端末が並びます。" />
        ) : (
          <>
            {/* スマホ：カード */}
            <ul className="space-y-2 md:hidden">
              {events.map((e) => (
                <li key={e.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.display_name || e.email || "（不明）"}</span>
                    <RoleBadge role={e.role} />
                    <Badge variant="outline">{LOGIN_EVENT_LABELS[e.kind]}</Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">日時</dt>
                    <dd className="num text-right">{formatDateTimeJa(e.at)}</dd>
                    <dt className="text-muted-foreground">端末</dt>
                    <dd className="text-right">{deviceText(e.user_agent)}</dd>
                    <dt className="text-muted-foreground">IP</dt>
                    <dd className="num truncate text-right">{e.ip || "—"}</dd>
                  </dl>
                </li>
              ))}
            </ul>

            {/* PC：表 */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日時</TableHead>
                    <TableHead>名前</TableHead>
                    <TableHead>ロール</TableHead>
                    <TableHead>種別</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>端末</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="num whitespace-nowrap">{formatDateTimeJa(e.at)}</TableCell>
                      <TableCell className="font-medium">{e.display_name || e.email || "（不明）"}</TableCell>
                      <TableCell>
                        <RoleBadge role={e.role} />
                      </TableCell>
                      <TableCell>{LOGIN_EVENT_LABELS[e.kind]}</TableCell>
                      <TableCell className="num">{e.ip || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={e.user_agent || undefined}>
                        {deviceText(e.user_agent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ExportLogsCard({ logs }: { logs: ExportLogRow[] }) {
  const sensitive = logs.filter((l) => l.is_sensitive).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-4 w-4 text-muted-foreground" />
          持ち出しの記録
        </CardTitle>
        <CardDescription>
          CSV・振込データ・明細 PDF・バックアップを誰がいつ出したかの記録です。1 年で自動的に消えます。
          {sensitive > 0 && <> このうち {sensitive} 件は個人情報を含みます。</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <Empty title="まだ持ち出しの記録がありません" description="CSV や振込データを出すと、誰がいつ何件出したかがここに残ります。" />
        ) : (
          <>
            {/* スマホ：カード */}
            <ul className="space-y-2 md:hidden">
              {logs.map((l) => (
                <li key={l.id} className={cn("rounded-lg border border-border p-3", l.is_sensitive && "border-warning/40 bg-warning/5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{exportKindLabel(l.kind)}</span>
                    {l.is_sensitive && <Badge variant="warning">個人情報を含む</Badge>}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">出した人</dt>
                    <dd className="break-words text-right">{l.profile_name || "—"}</dd>
                    <dt className="text-muted-foreground">日時</dt>
                    <dd className="num text-right">{formatDateTimeJa(l.at)}</dd>
                    <dt className="text-muted-foreground">対象の月</dt>
                    <dd className="num text-right">{monthText(l.month)}</dd>
                    <dt className="text-muted-foreground">件数</dt>
                    <dd className="num text-right">{l.row_count ?? 0} 件</dd>
                  </dl>
                  {l.label && <p className="mt-1 break-words text-xs text-muted-foreground">{l.label}</p>}
                </li>
              ))}
            </ul>

            {/* PC：表 */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日時</TableHead>
                    <TableHead>出した人</TableHead>
                    <TableHead>ロール</TableHead>
                    <TableHead>出したもの</TableHead>
                    <TableHead>対象の月</TableHead>
                    <TableHead className="text-right">件数</TableHead>
                    <TableHead>端末</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id} className={cn(l.is_sensitive && "bg-warning/5")}>
                      <TableCell className="num whitespace-nowrap">{formatDateTimeJa(l.at)}</TableCell>
                      <TableCell className="font-medium">{l.profile_name || "—"}</TableCell>
                      <TableCell>
                        <RoleBadge role={l.role} />
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {exportKindLabel(l.kind)}
                          {l.is_sensitive && <Badge variant="warning">個人情報を含む</Badge>}
                        </span>
                        {l.label && <p className="max-w-[16rem] truncate text-xs text-muted-foreground">{l.label}</p>}
                      </TableCell>
                      <TableCell className="num whitespace-nowrap">{monthText(l.month)}</TableCell>
                      <TableCell className="num text-right">{l.row_count ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={l.user_agent || undefined}>
                        {deviceText(l.user_agent)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
