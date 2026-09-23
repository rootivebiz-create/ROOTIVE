import Link from "next/link";
import { Card } from "@/components/ui";
import { RulesForm } from "~/components/onboarding/rules-form";
import { NextStepLink, StepHeader } from "~/components/onboarding/step-header";
import { Badge } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { listRuleNames, loadOnboarding, nextStepOf, stepHref } from "~/server/features/onboarding";
import { ruleValueText, type RuleKind } from "~/server/features/onboarding/rules";
import { monthFromParam, monthParam } from "~/server/month";

export const metadata = { title: "最初の設定：控除のルール" };

/** ⑤ 控除のルール：今の取引条件に書いてある控除を写す（新しく控除を決める場所ではない。取り込みの「控除の提案」で採ったものはもう入っている） */
export default async function OnboardingRulesPage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const [rules, progress] = await Promise.all([listRuleNames(db, user.tenantId), loadOnboarding(db, user.tenantId)]);
  // 次の手順（順番は steps.ts が決める。取り込み・比べ合わせは先月の分を開く）
  const next = nextStepOf("rules");
  const nextHref = next ? stepHref(next, monthParam(monthFromParam(undefined))) : "/onboarding";

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader
        step="rules"
        state={progress.steps.find((x) => x.def.key === "rules")?.state}
        description={
          <>
            毎月の支払から引いているもの（ロイヤリティ・管理費など）を、今の取引条件のとおりに入れてください。
            ここで入れるのは全員に同じように当てるものです。車両リースのように人によって違うものは、あとで設定のドライバーから入れられます。
            引いているものが無ければ、この手順は「あとでやる」でとばせます。
          </>
        }
      />
      {rules.length > 0 && (
        <Card className="mb-4">
          <p className="text-sm font-bold">登録済みの控除（{rules.length} 件）</p>
          <ul className="mt-2 space-y-1 text-sm">
            {rules.map((r, i) => (
              <li key={`${r.name}:${i}`} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.name}</span>
                <span className="num">{ruleValueText({ kind: r.kind as RuleKind, rate: r.rate, amount: r.amount })}</span>
                <span className="text-muted-foreground">{r.forAll ? "全員" : "人ごと"}</span>
                {!r.agreedInWriting && <Badge tone="yellow">合意の印なし</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <RulesForm existing={rules.filter((r) => r.forAll).map((r) => r.name)} nextHref={nextHref} nextTitle={next?.title ?? "最初の設定"} />
      <div className="mt-8 space-y-2 text-sm text-muted-foreground">
        <p>
          根拠：取引条件に書いていない控除は、フリーランス法 第5条（報酬の減額の禁止）にあたるおそれがあります（
          <a href="https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html" target="_blank" rel="noopener noreferrer">
            公正取引委員会 フリーランス法 Q&amp;A
          </a>
          ）。どう扱うかの最終的な判断は、会社と顧問の弁護士・社労士・税理士の方でお願いします。
        </p>
        <p>
          あとで直すときは、メニューの <Link href="/settings/rules">設定 → 控除</Link> から開けます。
        </p>
        <NextStepLink step="rules" />
      </div>
    </div>
  );
}
