import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { ReopenButton } from "~/components/onboarding/mark-button";
import { PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { loadOnboarding, onboardingCounts, STATE_LABEL } from "~/server/features/onboarding";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "準備ができました" };

/** 最初の設定のおわり：何が入ったかと、これからの進め方（2〜3 か月は Excel と並べて締める） */
export default async function OnboardingDonePage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const [progress, counts] = await Promise.all([loadOnboarding(db, user.tenantId), onboardingCounts(db, user.tenantId)]);
  const month = monthFromParam(undefined);
  const m = monthParam(month);
  const later = progress.steps.filter((s) => s.state === "skipped" || s.state === "todo");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="準備ができました" description="おつかれさまでした。ここからは、毎月の締めを「今月の締め」の画面から進めます。" />

      <Card>
        <h2 className="font-bold">入っているもの</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">ドライバー</dt>
            <dd className="text-xl font-bold">{counts.drivers}人</dd>
            <dd className="text-xs text-muted-foreground">
              口座あり {counts.withBank}人・インボイス登録 {counts.registered}人
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">元請</dt>
            <dd className="text-xl font-bold">{counts.clients} 社</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">案件</dt>
            <dd className="text-xl font-bold">{counts.projects} 件</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">控除のルール</dt>
            <dd className="text-xl font-bold">{counts.rules} 件</dd>
          </div>
        </dl>
        {counts.drivers > counts.withBank && (
          <p className="mt-3 text-sm">
            口座が入っていない人が {counts.drivers - counts.withBank}人います。振込データを作る前に、設定のドライバーから入れてください（入れないうちは、振込データに入りません）。
          </p>
        )}
      </Card>

      {later.length > 0 && (
        <Card>
          <h2 className="font-bold">あとでやる手順</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {later.map((s) => (
              <li key={s.def.key}>
                {s.def.no}. {s.def.title}（{STATE_LABEL[s.state]}）
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link href="/onboarding">最初の設定</Link> からいつでも戻れます。
          </p>
        </Card>
      )}

      <Card className="border-2 border-foreground">
        <h2 className="font-bold">これからの進め方：2〜3 か月は Excel と並べて締めてください</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>毎月、今の Excel をそのまま取り込んで、しめ日ラボで明細を作ります。</li>
          <li>今までどおり Excel でも締めて、振込額を「Excel と比べる」に入れます（貼り付けでも入ります）。</li>
          <li>差が出たら、しめ日ラボが理由の見当（消費税・控除・端数など）を出します。どちらに合わせるかを決めて直します。</li>
          <li>2〜3 か月続けて差が 0 になったら、Excel をやめてください。</li>
        </ol>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link href={`/?m=${m}`} className={buttonClass("primary", "w-full")}>
            {monthLabelJa(month)}分の締めへ
          </Link>
          <Link href={`/parallel?m=${m}`} className={buttonClass("secondary", "w-full")}>
            Excel と比べる
          </Link>
        </div>
      </Card>

      {progress.finished && (
        <div className="text-sm">
          <p className="text-muted-foreground">ホームの「最初の設定」の案内は、いまは出していません。</p>
          <ReopenButton />
        </div>
      )}
    </div>
  );
}
