"use client";

import { useMemo, useState } from "react";
import { Download, FileText, ShieldCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportUrls } from "@/lib/exports/urls";
import { groupGaps, rosterCompleteness, summarizeGaps, type Gap } from "@/lib/compliance/helpers";
import { qty } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface RetentionRow {
  kind: string;
  label: string;
  years: number;
  basis: string;
  recordCount: number;
  oldestOn: string | null;
  expiredCount: number;
}

export interface RosterRow {
  driverId: string;
  name: string;
  isActive: boolean;
  retiredOn: string | null;
  birthDate: string | null;
  address: string;
  hiredOn: string | null;
  appointedOn: string | null;
  licenseNo: string;
  licenseExpiresOn: string | null;
  healthCheckOn: string | null;
  instructionLastOn: string | null;
  aptitudeLastOn: string | null;
  keepUntil: string | null;
}

export interface ComplianceViewProps {
  editable: boolean;
  today: string;
  defaultFrom: string;
  gaps: Gap[];
  retention: RetentionRow[];
  roster: RosterRow[];
}

function dash(v: string | null | undefined): string {
  return v == null || v === "" ? "—" : v;
}

/** 法令対応の画面（足りないもの・運転者台帳・保存期間・一式の出力） */
export function ComplianceView({ editable, today, defaultFrom, gaps, retention, roster }: ComplianceViewProps) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);

  const summary = useMemo(() => summarizeGaps(gaps), [gaps]);
  const groups = useMemo(() => groupGaps(gaps), [gaps]);
  const active = useMemo(() => roster.filter((r) => r.isActive && r.retiredOn == null), [roster]);
  const completeness = useMemo(
    () =>
      rosterCompleteness(
        active.map((r) => ({
          birthDate: r.birthDate,
          address: r.address,
          hiredOn: r.hiredOn,
          appointedOn: r.appointedOn,
          licenseNo: r.licenseNo,
          licenseExpiresOn: r.licenseExpiresOn,
        })),
      ),
    [active],
  );

  const packUrl = exportUrls.auditPackZip(from, to);

  return (
    <div className="space-y-4">
      <PageHeader
        title="法令対応"
        description="監査で聞かれることを 1 画面にまとめています。足りないものを埋めて、記録は一式で出せます。"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {summary.total === 0 ? <ShieldCheck className="h-4 w-4 text-success" /> : <TriangleAlert className="h-4 w-4 text-warning" />}
              いまの状態
            </CardTitle>
            <CardDescription>在籍しているドライバーについて見ています。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md bg-muted/50 p-2 text-center">
                <p className="text-xs text-muted-foreground">急ぎ</p>
                <p className={cn("num mt-0.5 text-lg font-bold", summary.high > 0 && "text-destructive")}>{summary.high}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2 text-center">
                <p className="text-xs text-muted-foreground">要確認</p>
                <p className={cn("num mt-0.5 text-lg font-bold", summary.medium > 0 && "text-warning")}>{summary.medium}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2 text-center">
                <p className="text-xs text-muted-foreground">台帳の記入</p>
                <p className="num mt-0.5 text-lg font-bold">{Math.round(completeness.rate * 100)}%</p>
              </div>
            </div>
            {summary.total === 0 ? (
              <p className="text-sm text-success">足りないものはありません。</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {qty(summary.drivers)} 名のドライバーで {qty(summary.total)} 件の不足があります。
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-4 w-4" /> 監査一式を出す
            </CardTitle>
            <CardDescription>期間の記録と運転者台帳を 1 つの ZIP にまとめます。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="pack-from">はじめ</Label>
                <Input id="pack-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pack-to">おわり</Label>
                <Input id="pack-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={packUrl} download className={buttonVariants({ variant: "default" })}>
                <Download /> 監査一式 ZIP
              </a>
              <a href={exportUrls.rosterPdf(true)} download className={buttonVariants({ variant: "outline" })}>
                <FileText /> 運転者台帳 PDF
              </a>
              <a href={exportUrls.complianceCsv("roster")} download className={buttonVariants({ variant: "outline" })}>
                台帳 CSV
              </a>
            </div>
            <p className="text-xs text-muted-foreground">
              一式には 運転者台帳（PDF・CSV）・運転日報と点呼・指導・事故・適性診断・車両と書類・拘束時間が入ります。
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">足りないもの</TabsTrigger>
          <TabsTrigger value="roster">運転者台帳</TabsTrigger>
          <TabsTrigger value="retention">保存期間</TabsTrigger>
        </TabsList>

        <TabsContent value="gaps">
          {groups.length === 0 ? (
            <Empty title="足りないものはありません" description="台帳・指導・適性診断・健康診断はそろっています。" />
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <Card key={g.kind}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Badge variant={g.severity === "high" ? "destructive" : "warning"}>{g.severity === "high" ? "急ぎ" : "要確認"}</Badge>
                      {g.label}
                      <span className="text-sm font-normal text-muted-foreground">{qty(g.gaps.length)} 名</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm">
                      {g.gaps.map((x) => (
                        <li key={`${x.kind}-${x.driverId}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-medium">{x.driverName}</span>
                          <span className="text-muted-foreground">{x.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
              {editable && (
                <p className="text-xs text-muted-foreground">
                  台帳の項目は 設定 → ドライバー、指導と適性診断は 車両と書類 → 安全 から入れられます。
                </p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="roster">
          {roster.length === 0 ? (
            <Empty title="ドライバーがいません" description="設定 → ドライバー で登録してください。" />
          ) : (
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ドライバー</TableHead>
                    <TableHead>生年月日</TableHead>
                    <TableHead>雇入れ</TableHead>
                    <TableHead>選任</TableHead>
                    <TableHead>免許</TableHead>
                    <TableHead>免許期限</TableHead>
                    <TableHead>健康診断</TableHead>
                    <TableHead>最終の指導</TableHead>
                    <TableHead>最終の診断</TableHead>
                    <TableHead>保存期限</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((r) => (
                    <TableRow key={r.driverId}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {r.name}
                        {r.retiredOn && <Badge variant="secondary" className="ml-1">退職</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.birthDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.hiredOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.appointedOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.licenseNo)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.licenseExpiresOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.healthCheckOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.instructionLastOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.aptitudeLastOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dash(r.keepUntil)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="retention">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>記録</TableHead>
                  <TableHead>保存期間</TableHead>
                  <TableHead>起点</TableHead>
                  <TableHead className="text-right">いまの件数</TableHead>
                  <TableHead className="whitespace-nowrap">いちばん古い</TableHead>
                  <TableHead className="text-right">期間を過ぎたもの</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.map((r) => (
                  <TableRow key={r.kind}>
                    <TableCell className="whitespace-nowrap font-medium">{r.label}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.years} 年</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{r.basis}</TableCell>
                    <TableCell className="num text-right">{qty(r.recordCount)}</TableCell>
                    <TableCell className="whitespace-nowrap">{dash(r.oldestOn)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{qty(r.expiredCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            保存期間を過ぎた記録も自動では消しません。消してよいかは会社で決めてください。期間は 設定 → 安全管理 で変えられます。
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
