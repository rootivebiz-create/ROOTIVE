import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "~/components/auth-frame";
import { DemoStartForm } from "~/components/demo-start-form";
import { currentUser } from "~/server/auth";
import { DEMO_TTL_HOURS, isDemoMode, safeDemoNext } from "~/server/demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "製品のデモ", robots: { index: false, follow: false } };

/**
 * デモの入口。開いただけでは何も作らない（ボタンを押したときだけ、架空の会社を作る）。
 * 検索のロボットやリンクのプレビューが開いても、デモの会社は増えない
 */
export default async function DemoStartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isDemoMode()) redirect("/login");
  const sp = await searchParams;
  const next = safeDemoNext(typeof sp.next === "string" ? sp.next : "");
  const user = await currentUser();
  return (
    <AuthFrame title="製品のデモを触る">
      <div className="space-y-3 text-sm">
        <p>あなた専用に、架空の運送会社を 1 つ作ります。ログインもパスワードも要りません。</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>ドライバー・元請・金額は、すべて架空のデータです</li>
          <li>ほかの人の操作は見えません。{DEMO_TTL_HOURS} 時間で消えます</li>
          <li>本物のドライバーの名前・口座などは入れないでください</li>
        </ul>
      </div>
      <div className="mt-6">
        <DemoStartForm next={next} />
      </div>
      {user && (
        <p className="mt-4 text-sm">
          <Link href={next} className="inline-flex min-h-11 items-center font-bold underline">
            作ってあるデモの続きを開く
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}
