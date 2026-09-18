import { Badge } from "@/components/ui/badge";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/db/types";

/** 状態ごとのバッジの色（下書き：灰／発行済み：既定／入金済み：緑） */
export const INVOICE_STATUS_VARIANTS: Record<InvoiceStatus, "secondary" | "default" | "success"> = {
  draft: "secondary",
  issued: "default",
  paid: "success",
};

/** 請求書の状態バッジ */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={INVOICE_STATUS_VARIANTS[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>;
}
