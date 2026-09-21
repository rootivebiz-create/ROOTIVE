import { Skeleton } from "@/components/ui/skeleton";

/**
 * スタッフ画面の読み込み中の骨組み。
 *
 * これがあると Next.js が**動的ルートをプリフェッチできる**ようになり、
 * タップした瞬間にこの骨組みへ切り替わる（サーバーの応答を待って固まらない）。
 * 置き換わるのは `app/(app)/layout.tsx` の children だけで、
 * ヘッダー・ナビ・月セレクタはそのまま残る。
 */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">読み込んでいます</span>
      {/* 見出し */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      {/* 数字のカード */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-24" />
          </div>
        ))}
      </div>
      {/* 一覧 */}
      <div className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <Skeleton className="h-4 w-32" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
