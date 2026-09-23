import { Badge } from "~/components/page";
import type { StatementStatus } from "~/server/features/statements/status";

/** 明細の状態の札（主な状態 ＋ 送り直し・質問） */
export function StatusChips({ status }: { status: StatementStatus }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={status.tone}>{status.label}</Badge>
      {status.needsResend && <Badge tone="yellow">変更後まだ送っていません</Badge>}
      {status.deemedBlockedByClause && <Badge tone="gray">条項なし（みなし確認にしません）</Badge>}
      {status.openQuestions > 0 && (
        <Badge tone="red">
          質問あり {status.openQuestions}
          {status.unread > 0 ? `（未読 ${status.unread}）` : ""}
        </Badge>
      )}
    </span>
  );
}
