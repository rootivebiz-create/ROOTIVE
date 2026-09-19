import { Skeleton } from "@/components/ui/skeleton";

/** ドライバーポータルの読み込み中の表示 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">読み込んでいます</span>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="space-y-2 rounded-lg border p-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
