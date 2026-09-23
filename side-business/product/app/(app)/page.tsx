import { NextCard } from "~/components/home/next-card";
import { OnboardingBanner } from "~/components/home/onboarding-banner";
import { SideCards } from "~/components/home/side-cards";
import { StepList } from "~/components/home/step-list";
import { PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { homeView, loadHomeStatus, unresolvedQuestionCount } from "~/server/features/home";
import { monthFromParam } from "~/server/month";

export const metadata = { title: "今月の締め" };

/** 今日（日本時間）の YYYY-MM-DD */
function todayJst(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

/** ホーム：今月の締めの 5 つの段と、いちばん大きな「次にやること」 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  const db = await getDb();
  const [st, allQuestions] = await Promise.all([loadHomeStatus(db, user.tenantId, month), unresolvedQuestionCount(db, user.tenantId)]);
  const canEdit = roleAtLeast(user.role, "staff");
  const view = homeView(st, { canEdit });

  return (
    <div>
      {canEdit && <OnboardingBanner progress={st.onboarding} />}
      <PageHeader
        title={view.title}
        month={month}
        basePath="/"
        description={st.closed ? "この月は締めてあります。残っている作業があれば、下に出します。" : `${user.name}さん、上から順に進めれば終わります。`}
      />
      <NextCard
        view={view}
        month={month}
        payDate={st.payDate}
        today={todayJst()}
        paid={st.transfer.batches > 0 && st.transfer.executed === st.transfer.batches && st.transfer.notInBatch === 0}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="steps-heading" className="lg:col-span-2">
          <h2 id="steps-heading" className="mb-3 text-lg font-bold">
            締めの流れ
          </h2>
          <StepList steps={view.steps} />
        </section>
        <aside aria-label="この月のまとめ">
          <h2 className="mb-3 text-lg font-bold">この月のまとめ</h2>
          <SideCards st={st} otherQuestions={Math.max(0, allQuestions - st.questions.count)} canEdit={canEdit} />
        </aside>
      </div>
    </div>
  );
}
