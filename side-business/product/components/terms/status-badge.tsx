import { Badge } from "~/components/page";
import { TERMS_STATUS, termsStatusTone, type TermsStatusKey } from "~/server/features/terms/status";

/** 明示書の状態（未作成・未送付・送付済み・受け取り済み） */
export function TermsStatusBadge({ status, workedRecently = false }: { status: TermsStatusKey; workedRecently?: boolean }) {
  return <Badge tone={termsStatusTone(status, workedRecently)}>{TERMS_STATUS[status].label}</Badge>;
}
