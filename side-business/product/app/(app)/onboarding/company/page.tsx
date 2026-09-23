import { Card } from "@/components/ui";
import { CompanyForm } from "~/components/onboarding/company-form";
import { NextStepLink, StepHeader } from "~/components/onboarding/step-header";
import { Notice } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { loadCompanyForm, loadOnboarding, nextStepOf, stepHref } from "~/server/features/onboarding";
import { monthFromParam, monthParam } from "~/server/month";
import { payRuleText, SIZE_REASON, TAX_METHODS } from "~/server/features/onboarding/company";

export const metadata = { title: "最初の設定：会社の基本" };

function todayJst(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

/** ① 会社の基本（保存はオーナーだけ。事務の方には中身と、だれが入れるかを見せる） */
export default async function OnboardingCompanyPage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const [c, progress] = await Promise.all([loadCompanyForm(db, user.tenantId), loadOnboarding(db, user.tenantId)]);
  const isOwner = user.role === "owner";
  // 保存したあとの「次の手順」（会社の次は先月の Excel の取り込み。先月の分を開く）
  const next = nextStepOf("company");

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader
        step="company"
        state={progress.steps.find((x) => x.def.key === "company")?.state}
        description={
          <>
            {c.name}の、ドライバーへの支払の決まりです。明細に書く支払日・見張り番の確かめ・振込データに使います。
            振込依頼人（会社の口座）などの細かい設定は、メニューの「設定」にあります。
          </>
        }
      />
      {isOwner ? (
        <Card>
          <CompanyForm
            today={todayJst()}
            next={next ? { href: stepHref(next, monthParam(monthFromParam(undefined))), title: next.title } : null}
            initial={{
              closingDay: c.closingDay,
              payMonthOffset: c.payMonthOffset,
              payDay: c.payDay,
              transferFeeBearer: c.transferFeeBearer,
              registrationNo: c.registrationNo,
              taxMethod: c.taxMethod,
              paymentTermsText: c.paymentTermsText,
              capitalYen: c.capitalYen,
              employees: c.employees,
            }}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Notice tone="info">
            会社の基本を保存できるのはオーナーの方です{c.owners.length ? `（${c.owners.map((n) => `${n}さん`).join("・")}）` : ""}。
            中身が違うときは、オーナーの方に直してもらってください。この手順は「あとでやる」にして、先に進めても構いません。
          </Notice>
          <Card>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">締め日と支払日</dt>
                <dd className="font-bold">{payRuleText(c.closingDay, c.payMonthOffset, c.payDay)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">振込手数料</dt>
                <dd className="font-bold">{c.transferFeeBearer === "driver" ? "ドライバーが持つ" : c.transferFeeBearer === "company" ? "会社が持つ" : "まだ決めていません"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">会社の登録番号</dt>
                <dd className="num font-bold">{c.registrationNo ?? "入っていません"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">消費税の計算方法</dt>
                <dd className="font-bold">{TAX_METHODS.find((t) => t.value === c.taxMethod)?.label ?? c.taxMethod}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">取引条件の支払期日の文言</dt>
                <dd className="font-bold">{c.paymentTermsText ?? "入っていません"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">資本金</dt>
                <dd className="num font-bold">{c.capitalYen === null ? "入っていません" : `${c.capitalYen.toLocaleString("ja-JP")}円`}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">常時使用する従業員の数</dt>
                <dd className="num font-bold">{c.employees === null ? "入っていません" : `${c.employees.toLocaleString("ja-JP")}人`}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">資本金と従業員の数は、{SIZE_REASON}。</p>
          </Card>
        </div>
      )}
      <div className="mt-6">
        <NextStepLink step="company" />
      </div>
    </div>
  );
}
