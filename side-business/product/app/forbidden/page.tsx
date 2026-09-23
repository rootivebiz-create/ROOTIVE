import Link from "next/link";
import { AuthFrame } from "~/components/auth-frame";

export default function ForbiddenPage() {
  return (
    <AuthFrame title="この画面を開く権限がありません">
      <p className="text-sm">必要なときは、社内のオーナーに役割を変えてもらってください。</p>
      <p className="mt-4">
        <Link href="/">今月の締めへ戻る</Link>
      </p>
    </AuthFrame>
  );
}
