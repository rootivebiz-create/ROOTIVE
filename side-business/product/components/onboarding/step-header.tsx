import Link from "next/link";
import type { ReactNode } from "react";
import { MarkButton } from "~/components/onboarding/mark-button";
import { minutesText, ONBOARDING_STEPS, STATE_LABEL, type OnboardingKey, type StepState } from "~/server/features/onboarding/steps";
import { monthFromParam, monthParam } from "~/server/month";

/** 案内の各手順の見出し：何番目か・かかる時間・戻る・とばす（済んだ手順には「あとでやる」を出さない） */
export function StepHeader({ step, description, showSkip = true, state }: { step: OnboardingKey; description: ReactNode; showSkip?: boolean; state?: StepState }) {
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
      {state && state !== "todo" && <p className="mt-2 text-sm font-bold">この手順：{STATE_LABEL[state]}</p>}
      {showSkip && (state === undefined || state === "todo") && (
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
    // 取り込みは先月（デモは架空のデータがある月）の分を開く
    <Link href={next.withMonth ? `${next.path}?m=${monthParam(monthFromParam(undefined))}` : next.path} className="inline-flex min-h-11 items-center text-sm font-bold">
      次の手順「{next.title}」へ →
    </Link>
  );
}
