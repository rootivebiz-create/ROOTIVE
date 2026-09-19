/**
 * ダッシュボードに差し込むカード（props だけで動く。サーバー部品としてそのまま使える）
 * 選考中の人数・フォロー漏れ・更新時期の契約を出し、すべて 0 なら一言だけを出す。
 * 件数は `hrCounts(applicants, contracts, today)`（lib/hr/helpers）で作る。
 */
import Link from "next/link";
import { ChevronRight, ClipboardList, FileSignature, TriangleAlert, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasHrAttention, ZERO_HR_COUNTS, type HrCounts } from "@/lib/hr/helpers";
import { cn } from "@/lib/utils";

export interface HrCardProps {
  /** 件数（lib/hr/helpers の hrCounts() で作る） */
  counts?: HrCounts;
  className?: string;
}

/** カードの 1 行 */
function Row({ href, icon: Icon, label, count, unit, tone }: { href: string; icon: typeof UserPlus; label: string; count: number; unit: string; tone?: "warning" | "destructive" }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
      <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", tone === "warning" && "text-warning", tone === "destructive" && "text-destructive")} />
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <span className={cn("num font-semibold", tone === "warning" && "text-warning", tone === "destructive" && "text-destructive")}>
        {count}
        <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function HrCard({ counts = ZERO_HR_COUNTS, className }: HrCardProps) {
  const attention = hasHrAttention(counts);
  const urgent = counts.stale > 0 || counts.expired > 0 || counts.renewal > 0;

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          {urgent ? <TriangleAlert className="h-4 w-4 text-warning" /> : <UserPlus className="h-4 w-4 text-muted-foreground" />}
          採用と契約
        </CardTitle>
        <Link href="/hr" className="text-xs font-medium text-primary hover:underline">
          すべて見る
        </Link>
      </CardHeader>
      <CardContent>
        {!attention ? (
          <p className="text-sm font-medium text-success">対応が必要なものはありません。</p>
        ) : (
          <div className="-mx-2 space-y-0.5">
            {counts.inProgress > 0 && <Row href="/hr?tab=applicants" icon={UserPlus} label="選考中の応募者" count={counts.inProgress} unit="人" />}
            {counts.stale > 0 && <Row href="/hr?tab=applicants" icon={ClipboardList} label="フォロー漏れ（10 日以上動きなし）" count={counts.stale} unit="人" tone="warning" />}
            {counts.renewal > 0 && <Row href="/hr?tab=contracts" icon={FileSignature} label="更新時期の契約" count={counts.renewal} unit="件" tone="warning" />}
            {counts.expired > 0 && <Row href="/hr?tab=contracts" icon={FileSignature} label="期間が切れた契約" count={counts.expired} unit="件" tone="destructive" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
