import { Skeleton } from "@/components/ui/skeleton";

/**
 * スタッフ画面の読み込み中の表示。
 * 画面ごとの中身は違うので、見出し ＋ 数字カード ＋ 表 という共通の骨組みだけを出す。
 * スマホ（375px）でも横に溢れないよう、幅は親に合わせる。
 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">読み込んでいます</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
