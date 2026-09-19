"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Download, Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BANK_TXN_STATUS_LABELS, type BankTxnStatus } from "@/lib/db/types";
import type { InvoiceCandidate } from "@/lib/bank";
import type { BankStatusFilter } from "@/lib/schemas/bank";
import { setBankTxnStatusAction, type ImportBankCsvResult } from "@/lib/actions/bank";
import { cn } from "@/lib/utils";
import { MatchDialog } from "./match-dialog";
import { ImportPanel } from "./import-panel";
import { BANK_STATUS_TABS, bankExportUrl, bankStatusHref, bankTotals, importResultMessage, shortDate, type BankImportRow, type BankTxnRow } from "./helpers";

export interface BankViewProps {
  status: BankStatusFilter;
  rows: BankTxnRow[];
  imports: BankImportRow[];
  /** 未入金の請求書（消込先の候補）。閲覧者には空で渡す */
  invoices: InvoiceCandidate[];
  /** 取り込み・消込ができる（owner/admin） */
  editable: boolean;
}

const STATUS_VARIANT: Record<BankTxnStatus, "outline" | "success" | "secondary"> = {
  unmatched: "outline",
  matched: "success",
  ignored: "secondary",
};

function StatusBadge({ row }: { row: BankTxnRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant={STATUS_VARIANT[row.status]}>{BANK_TXN_STATUS_LABELS[row.status]}</Badge>
      {row.status === "matched" && row.autoMatched && <Badge variant="secondary">自動</Badge>}
    </span>
  );
}

/** 消込先（請求書番号と取引先名） */
function MatchedTo({ row }: { row: BankTxnRow }) {
  if (row.status !== "matched") return <span className="text-muted-foreground">—</span>;
  if (row.invoiceNo || row.clientName) {
    return (
      <span className="min-w-0">
        <span className="num">{row.invoiceNo || "（番号なし）"}</span>
        {row.clientName && <span className="block text-xs text-muted-foreground">{row.clientName}</span>}
      </span>
    );
  }
  if (row.expenseLabel) return <span>{row.expenseLabel}</span>;
  return <span className="text-muted-foreground">—</span>;
}

/** 入金の消込（/bank）。稼動月には依存しない（全期間） */
export function BankView({ status, rows, imports, invoices, editable }: BankViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportBankCsvResult | null>(null);
  const [matchTarget, setMatchTarget] = useState<BankTxnRow | null>(null);

  const totals = useMemo(() => bankTotals(rows), [rows]);

  const changeStatus = (row: BankTxnRow, next: "unmatched" | "ignored") => {
    startTransition(async () => {
      const res = await setBankTxnStatusAction(row.id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next === "ignored" ? "対象外にしました" : "消込を外しました");
      router.refresh();
    });
  };

  /** 1 行分の操作ボタン（閲覧者には出さない） */
  const rowActions = (row: BankTxnRow, block = false) => {
    if (!editable) return null;
    return (
      <div className={cn("flex flex-wrap gap-1.5", block ? "mt-2 justify-end" : "justify-end")}>
        {row.status === "unmatched" && row.amount > 0 && (
          <Button size="sm" onClick={() => setMatchTarget(row)} disabled={pending}>
            <Link2 /> この請求書に消し込む
          </Button>
        )}
        {row.status === "matched" && (
          <Button size="sm" variant="outline" onClick={() => changeStatus(row, "unmatched")} disabled={pending}>
            <RotateCcw /> 消込を外す
          </Button>
        )}
        {row.status === "unmatched" && (
          <Button size="sm" variant="outline" onClick={() => changeStatus(row, "ignored")} disabled={pending}>
            <Ban /> 対象外にする
          </Button>
        )}
        {row.status === "ignored" && (
          <Button size="sm" variant="outline" onClick={() => changeStatus(row, "unmatched")} disabled={pending}>
            <RotateCcw /> 未消込に戻す
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="入金の消込"
        description="銀行の入出金明細 CSV を取り込み、入金を請求書に突き合わせます（全期間）。"
        actions={
          <a href={bankExportUrl(status)} download className={buttonVariants({ variant: "outline" })}>
            <Download /> CSV
          </a>
        }
      />

      {/* 取り込み直後のサマリー */}
      {result && (
        <Alert variant="success">
          <p className="font-medium">
            {result.fileName}（{result.format}）：{importResultMessage(result)}
          </p>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm">読み取れなかった行（{result.errors.length} 件の理由）を表示</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </Alert>
      )}

      {editable && <ImportPanel imports={imports} onImported={setResult} />}

      {/* 状態の切り替え */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="表示する状態">
        {BANK_STATUS_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={bankStatusHref(tab.key)}
            aria-current={status === tab.key ? "page" : undefined}
            className={buttonVariants({ variant: status === tab.key ? "default" : "outline", size: "sm" })}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* 集計 */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="min-w-0 p-3">
          <p className="text-xs text-muted-foreground">件数</p>
          <p className="num mt-1 text-lg font-semibold">{totals.count}</p>
        </Card>
        <Card className="min-w-0 p-3">
          <p className="text-xs text-muted-foreground">入金合計</p>
          <p className="mt-1 text-lg font-semibold">
            <Money value={totals.inflow} />
          </p>
        </Card>
        <Card className="min-w-0 p-3">
          <p className="text-xs text-muted-foreground">出金合計</p>
          <p className="mt-1 text-lg font-semibold">
            <Money value={-totals.outflow} />
          </p>
        </Card>
        <Card className="min-w-0 p-3">
          <p className="text-xs text-muted-foreground">未消込の入金</p>
          <p className="mt-1 text-lg font-semibold">
            <Money value={totals.unmatchedInflow} />
          </p>
          <p className="num text-xs text-muted-foreground">{totals.unmatchedCount} 件</p>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Empty
          title="表示できる明細がありません"
          description={
            editable
              ? "ネットバンキングからダウンロードした入出金明細 CSV を取り込んでください。"
              : "銀行明細がまだ取り込まれていません。管理者が取り込むとここに表示されます。"
          }
        />
      ) : (
        <>
          {/* PC：表 */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead className="text-right">残高</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>消込先</TableHead>
                  {editable && <TableHead className="w-64" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="num whitespace-nowrap">{row.txnDate}</TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={row.description}>
                      {row.description || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={row.amount} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.balance == null ? <span className="text-muted-foreground">—</span> : <Money value={row.balance} />}
                    </TableCell>
                    <TableCell>
                      <StatusBadge row={row} />
                    </TableCell>
                    <TableCell>
                      <MatchedTo row={row} />
                    </TableCell>
                    {editable && <TableCell>{rowActions(row)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* スマホ：カード */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => (
              <Card key={row.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-sm text-muted-foreground">{shortDate(row.txnDate)}</p>
                    <p className="break-words font-medium">{row.description || "（摘要なし）"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">
                      <Money value={row.amount} />
                    </p>
                    {row.balance != null && (
                      <p className="text-xs text-muted-foreground">
                        残高 <Money value={row.balance} className="text-xs" />
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge row={row} />
                  <span className="text-right text-sm">
                    <MatchedTo row={row} />
                  </span>
                </div>
                {rowActions(row, true)}
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        自動消込は「未消込の入金」と「金額が一致する未入金の請求書」を突き合わせ、候補が 1 件のときだけ消し込みます。消し込むと請求書は入金済みになり、外すと発行済みに戻ります。
      </p>

      <MatchDialog txn={matchTarget} invoices={invoices} onOpenChange={(open) => !open && setMatchTarget(null)} />
    </div>
  );
}
