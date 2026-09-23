import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">ページが見つかりません</h1>
      <p className="mt-3 text-muted-foreground">URL が変わったか、削除された可能性があります。</p>
      <p className="mt-6">
        <Link href="/">トップへ戻る</Link>
      </p>
    </div>
  );
}
