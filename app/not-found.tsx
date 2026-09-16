import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">ページが見つかりません</h1>
      <p className="text-muted-foreground">URL が正しいか確認してください。</p>
      <Link href="/dashboard" className={buttonVariants()}>
        ホームへ戻る
      </Link>
    </main>
  );
}
