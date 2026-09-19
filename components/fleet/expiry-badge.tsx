import { Badge } from "@/components/ui/badge";
import { EXPIRY_STATUS_LABELS } from "@/lib/db/types";
import { expiryLabel, type ExpiryState, type ExpiryStatus } from "@/lib/fleet/helpers";

const VARIANT: Record<ExpiryStatus, "destructive" | "warning" | "success" | "secondary"> = {
  expired: "destructive",
  soon: "warning",
  valid: "success",
  none: "secondary",
};

/** 期限の状態バッジ（期限切れ＝赤／まもなく期限＝黄／有効＝緑／期限なし＝灰） */
export function ExpiryBadge({ status, daysLeft, showDays = false }: ExpiryState & { showDays?: boolean }) {
  const label = showDays ? expiryLabel({ status, daysLeft }) : (EXPIRY_STATUS_LABELS[status] ?? status);
  return <Badge variant={VARIANT[status]}>{label}</Badge>;
}
