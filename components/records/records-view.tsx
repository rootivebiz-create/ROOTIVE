"use client";

import { useMemo, useState } from "react";
import { Download, FileCheck2, FileText, Filter, Receipt, ScrollText, Search, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Input, NumberInput } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  describeFilter,
  filterRecords,
  recordsSummary,
  RECORD_KINDS,
  RECORD_KIND_LABELS,
  type RecordDoc,
  type RecordFilter,
  type RecordKind,
} from "@/lib/records";
import { recordsCsvUrl } from "@/lib/exports/records-url";
import { formatDateJa } from "@/lib/month";
import { parseNumberInput } from "@/lib/calc/parse";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<RecordKind, typeof Receipt> = {
  receipt: Receipt,
  invoice: FileText,
  notice: FileCheck2,
  contract: ScrollText,
};

export interface RecordsViewProps {
  docs: RecordDoc[];
}

/**
 * 書類の検索（電子帳簿保存法の検索要件）
 * 取引年月日・取引金額・取引先の 3 つで、範囲と組み合わせの検索ができます。
 */
export function RecordsView({ docs }: RecordsViewProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<RecordKind[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);

  const filter: RecordFilter = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      minAmount: minText ? parseNumberInput(minText) : null,
      maxAmount: maxText ? parseNumberInput(maxText) : null,
      q: q || undefined,
      kinds,
      missingFileOnly: missingOnly,
    }),
    [from, to, minText, maxText, q, kinds, missingOnly],
  );

  const rows = useMemo(() => filterRecords(docs, filter), [docs, filter]);
  const summary = useMemo(() => recordsSummary(rows), [rows]);
  const hasFilter = Boolean(from || to || minText || maxText || q || kinds.length > 0 || missingOnly);

  const toggleKind = (k: RecordKind) => setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  const clearAll = () => {
    setFrom("");
    setTo("");
    setMinText("");
    setMaxText("");
    setQ("");
    setKinds([]);
    setMissingOnly(false);
  };

  return (
    <div>
      <PageHeader
        title="書類の検索"
        description="レシート・請求書・支払通知・契約書を、取引年月日・取引金額・取引先で探せます"
        actions={
          <a href={recordsCsvUrl(filter)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Download className="h-4 w-4" />
            索引簿 CSV
          </a>
        }
      />

      <Card className="mt-3">
        <CardContent className="space-y-3 p-3 md:p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" /> 絞り込み
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rec-from">取引年月日（開始）</Label>
              <Input id="rec-from" type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-to">取引年月日（終了）</Label>
              <Input id="rec-to" type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-min">取引金額（下限）</Label>
              <NumberInput id="rec-min" value={minText} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinText(e.target.value)} placeholder="例：10000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-max">取引金額（上限）</Label>
              <NumberInput id="rec-max" value={maxText} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxText(e.target.value)} placeholder="例：500000" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="rec-q">取引先・件名</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="rec-q" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} className="pl-8" placeholder="例：エネオス、テスト運輸" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RECORD_KINDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKind(k)}
                  aria-pressed={on}
                  className={cn(buttonVariants({ variant: on ? "default" : "outline", size: "sm" }))}
                >
                  {RECORD_KIND_LABELS[k]}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMissingOnly((v) => !v)}
              aria-pressed={missingOnly}
              className={cn(buttonVariants({ variant: missingOnly ? "default" : "outline", size: "sm" }))}
            >
              ファイル未保存のみ
            </button>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="h-4 w-4" /> 条件をクリア
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{describeFilter(filter)}</p>
        </CardContent>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">件数</p>
            <p className="num mt-1 text-xl font-bold">{summary.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">取引金額の合計</p>
            <p className="mt-1 text-xl font-bold">
              <Money value={summary.total} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">電子データあり</p>
            <p className="num mt-1 text-xl font-bold">{summary.withFile}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">ファイル未保存</p>
            <p className={cn("num mt-1 text-xl font-bold", summary.missingFile > 0 && "text-amber-600 dark:text-amber-400")}>{summary.missingFile}</p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Empty
          className="mt-3"
          title={hasFilter ? "条件に合う書類がありません" : "検索できる書類がまだありません"}
          description={
            hasFilter
              ? "日付や金額の範囲を広げるか、条件をクリアしてください。"
              : "経費にレシートを登録する、請求書を作る、元請の支払通知を登録する、契約書をアップロードすると、ここから探せるようになります。"
          }
        />
      ) : (
        <>
          {/* スマホはカード、PC は表 */}
          <div className="mt-3 space-y-2 md:hidden">
            {rows.map((d) => {
              const Icon = KIND_ICONS[d.kind];
              return (
                <Card key={d.id}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Icon className="h-3 w-3" />
                          {RECORD_KIND_LABELS[d.kind]}
                          {!d.hasFile && <Badge variant="warning">未保存</Badge>}
                        </p>
                        <p className="mt-1 truncate font-medium">{d.counterparty || "（取引先なし）"}</p>
                        <p className="truncate text-sm text-muted-foreground">{d.title}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm">{d.date ? formatDateJa(d.date) : "—"}</p>
                        <p className="font-medium">{d.amount == null ? "—" : <Money value={d.amount} />}</p>
                      </div>
                    </div>
                    {d.href && (
                      <a href={d.href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 w-full")}>
                        開く
                      </a>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-3 hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>取引年月日</TableHead>
                  <TableHead>種類</TableHead>
                  <TableHead>取引先</TableHead>
                  <TableHead>件名</TableHead>
                  <TableHead className="text-right">取引金額</TableHead>
                  <TableHead>電子データ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.date ? formatDateJa(d.date) : "—"}</TableCell>
                    <TableCell>{RECORD_KIND_LABELS[d.kind]}</TableCell>
                    <TableCell>{d.counterparty || "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{d.title}</TableCell>
                    <TableCell className="text-right">{d.amount == null ? "—" : <Money value={d.amount} />}</TableCell>
                    <TableCell>{d.hasFile ? <Badge variant="secondary">あり</Badge> : <Badge variant="warning">未保存</Badge>}</TableCell>
                    <TableCell>
                      {d.href ? (
                        <a href={d.href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                          開く
                        </a>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        電子帳簿保存法では、電子でやり取りした書類を「取引年月日・取引金額・取引先」で検索できるように保存することが求められます。
        この画面はその検索に対応しています。紙で受け取った書類は対象外ですが、スキャンして登録しておくと同じように探せます。
        正確な取り扱いは税理士に確認してください。
      </p>
    </div>
  );
}
