"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/db/types";
import { suggestInvoiceMatches, type InvoiceCandidate } from "@/lib/bank";
import { matchBankTxnAction } from "@/lib/actions/bank";
import { formatMonthJa } from "@/lib/month";
import { yen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankTxnRow } from "./helpers";

export interface MatchDialogProps {
  txn: BankTxnRow | null;
  /** 未入金の請求書（下書き・発行済み） */
  invoices: InvoiceCandidate[];
  onOpenChange: (open: boolean) => void;
}

function statusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status;
}

/** 入金明細を請求書に消し込むダイアログ（候補は suggestInvoiceMatches の順） */
export function MatchDialog({ txn, invoices, onOpenChange }: MatchDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");

  const suggestions = useMemo(() => (txn ? suggestInvoiceMatches(txn, invoices) : []), [txn, invoices]);

  // 明細を開き直すたびに、一番上の候補を初期選択にする
  useEffect(() => {
    setSelected(suggestions[0]?.invoice.id ?? "");
  }, [suggestions, txn?.id]);

  const submit = () => {
    if (!txn || !selected) return;
    startTransition(async () => {
      const res = await matchBankTxnAction(txn.id, selected);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "請求書に消し込みました");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={txn != null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>この請求書に消し込む</DialogTitle>
          <DialogDescription>
            {txn && (
              <>
                {txn.txnDate}／{txn.description || "（摘要なし）"}／{yen(txn.amount)} の入金を、未入金の請求書に紐づけます。消し込むと請求書は「入金済み」になります。
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">未入金の請求書がありません。先に請求書を作成してください。</p>
        ) : (
          <div className="space-y-3">
            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">候補</p>
                <ul className="space-y-1.5">
                  {suggestions.map((s) => (
                    <li key={s.invoice.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(s.invoice.id)}
                        className={cn(
                          "flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-left hover:bg-muted",
                          selected === s.invoice.id && "border-primary bg-muted",
                        )}
                        aria-pressed={selected === s.invoice.id}
                      >
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {selected === s.invoice.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            <span className="font-medium">{s.invoice.clientName || "（取引先なし）"}</span>
                            <span className="num text-xs text-muted-foreground">{s.invoice.invoiceNo}</span>
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {s.reasons.map((reason) => (
                              <Badge key={reason} variant="secondary">
                                {reason}
                              </Badge>
                            ))}
                            <Badge variant="outline">{statusLabel(s.invoice.status)}</Badge>
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <Money value={s.invoice.total} className="font-semibold" />
                          {s.invoice.month && <span className="block text-xs text-muted-foreground">{formatMonthJa(s.invoice.month)}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="bank-match-invoice" className="text-sm font-medium">
                未入金の請求書から選ぶ
              </label>
              <Select id="bank-match-invoice" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={pending}>
                <option value="">選択してください</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {`${inv.invoiceNo || "（番号なし）"}｜${inv.clientName || "（取引先なし）"}｜${yen(inv.total)}｜${statusLabel(inv.status)}`}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !selected}>
            <Link2 /> {pending ? "消込中…" : "この請求書に消し込む"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
