import { Badge } from "@/components/ui/badge";
import { noticeDiffTone, noticeStatusTone } from "@/lib/notices/diff";
import type { NoticeStatus } from "@/lib/db/types";

/** 支払通知書の状態バッジ（受領・確認済み・解決済み） */
export function NoticeStatusBadge({ status }: { status: NoticeStatus }) {
  const tone = noticeStatusTone(status);
  return <Badge variant={tone.variant}>{tone.label}</Badge>;
}

/** 明細の判定バッジ（一致・通知のほうが多い／少ない・未紐づけ） */
export function NoticeDiffBadge({ status }: { status: string | null }) {
  const tone = noticeDiffTone(status);
  return <Badge variant={tone.variant}>{tone.label}</Badge>;
}
