/**
 * ダッシュボードに差し込むカード（props だけで動く。サーバー部品としてそのまま使える）
 *
 * 使い方（例：app/(app)/dashboard/page.tsx）
 *   const today = todayJST();
 *   const documents = (await loadDocuments(supabase, company.id)).map((r) => toFleetDocument(r, today));
 *   <ExpiryCard documents={documents} />
 *
 * 期限切れ・まもなく期限の件数と、急ぎの上位 3 件（対象名・種類・残り日数）を出す。
 * 0 件なら「期限切れの書類はありません」の一言だけ。
 */
import Link from "next/link";
import { CalendarClock, ChevronRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_KIND_LABELS } from "@/lib/db/types";
import { countExpiry, documentTarget, documentTitle, expiryLabel, sortDocuments, type ExpiryCounts, type FleetDocument } from "@/lib/fleet/helpers";
import { cn } from "@/lib/utils";
import { ExpiryBadge } from "./expiry-badge";

export interface ExpiryCardProps {
  /** 書類（期限の状態つき。並べ替え・件数の計算はカード側で行う） */
  documents: FleetDocument[];
  /** 件数。省略すると documents から数える（documents を絞って渡すときは必ず渡すこと） */
  counts?: ExpiryCounts;
  /** 一覧に出す件数（既定 3） */
  max?: number;
  className?: string;
}

function DocumentRow({ doc }: { doc: FleetDocument }) {
  const target = documentTarget(doc);
  return (
    <Link href="/fleet?tab=documents" className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <ExpiryBadge status={doc.status} daysLeft={doc.daysLeft} />
          <span className="min-w-0 break-words font-medium">{target || "（対象なし）"}</span>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {DOCUMENT_KIND_LABELS[doc.kind]}
          {doc.label && doc.label !== DOCUMENT_KIND_LABELS[doc.kind] ? `／${documentTitle(doc)}` : ""} ・ {expiryLabel(doc)}
        </span>
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function ExpiryCard({ documents, counts, max = 3, className }: ExpiryCardProps) {
  const effective = counts ?? countExpiry(documents);
  const urgent = sortDocuments(documents).filter((d) => d.status === "expired" || d.status === "soon");
  const top = urgent.slice(0, Math.max(0, max));
  const total = effective.expired + effective.soon;
  const rest = total - top.length;

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          {effective.expired > 0 ? (
            <TriangleAlert className="h-4 w-4 text-destructive" />
          ) : effective.soon > 0 ? (
            <CalendarClock className="h-4 w-4 text-warning" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-success" />
          )}
          書類の期限
        </CardTitle>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            期限切れ {effective.expired} 件 ／ まもなく {effective.soon} 件
          </span>
        )}
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm font-medium text-success">期限切れの書類はありません。</p>
        ) : (
          <>
            <div className="-mx-2 space-y-0.5">
              {top.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </div>
            <Link href="/fleet?tab=documents" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {rest > 0 ? `ほか ${rest} 件をすべて見る` : "すべて見る"}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
