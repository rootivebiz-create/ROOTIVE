import Link from "next/link";
import type { ReactNode } from "react";
import { MarkButton } from "~/components/onboarding/mark-button";
import { minutesText, ONBOARDING_STEPS, type OnboardingKey } from "~/server/features/onboarding/steps";

/** 案内の各手順の見出し：何番目か・かかる時間・戻る・とばす */
export function StepHeader({ step, description, showSkip = true }: { step: OnboardingKey; description: ReactNode; showSkip?: boolean }) {
  const def = ONBOARDING_STEPS.find((s) => s.key === step)!;
  return (
    <div className="mb-6">
      <p className="text-sm">
        <Link href="/onboarding" className="inline-flex min-h-11 items-center">
          ← 最初の設定に戻る
        </Link>
      </p>
      <p className="text-sm font-bold text-muted-foreground">
        手順 {def.no} / {ONBOARDING_STEPS.length}・{minutesText(def.minutes)}
      </p>
      <h1 className="mt-1 text-2xl font-bold">
        {def.no}. {def.title}
      </h1>
      <div className="mt-2 text-sm text-muted-foreground">{description}</div>
      {showSkip && (
        <div className="mt-3">
          <MarkButton step={step} mark="skipped" label="この手順はあとでやる" variant="ghost" />
        </div>
      )}
    </div>
  );
}

/** 手順のおわりの「次へ」 */
export function NextStepLink({ step }: { step: OnboardingKey }) {
  const i = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const next = ONBOARDING_STEPS[i + 1];
  if (!next) return null;
  return (
    <Link href={next.withMonth ? "/onboarding" : next.path} className="inline-flex min-h-11 items-center text-sm font-bold">
      次の手順「{next.title}」へ →
    </Link>
  );
}
