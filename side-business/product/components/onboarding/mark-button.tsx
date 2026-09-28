"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { finishOnboardingAction, markStepAction, reopenOnboardingAction, type MarkState } from "~/app/(app)/onboarding/actions";
import type { OnboardingKey } from "~/server/features/onboarding/steps";

function Result({ state }: { state: MarkState }) {
  if (!state) return null;
  if (!state.ok)
    return (
      <p role="alert" className="mt-2 text-sm text-danger">
        {state.error}
      </p>
    );
  return state.message ? (
    <p role="status" className="mt-2 text-sm text-success">
      {state.message}
    </p>
  ) : null;
}

/** 手順の印（済みにする・あとでやる・まだに戻す）を付けるボタン */
export function MarkButton({
  step,
  mark,
  label,
  variant = "secondary",
  className,
}: {
  step: OnboardingKey;
  mark: "done" | "skipped" | "todo";
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const [state, action, pending] = useActionState<MarkState, FormData>(markStepAction, undefined);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  return (
    <form onSubmit={onSubmit} className={className}>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="mark" value={mark} />
      <Button type="submit" variant={variant} disabled={pending} className="w-full sm:w-auto">
        {pending ? "記録しています…" : label}
      </Button>
      <Result state={state} />
    </form>
  );
}

/** 「案内を終える（残りはあとで）」 */
export function FinishButton({ label = "案内を終える（残りはあとで）" }: { label?: string }) {
  const [state, action, pending] = useActionState<MarkState, FormData>(finishOnboardingAction, undefined);
  return (
    <form action={action}>
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "記録しています…" : label}
      </Button>
      <Result state={state} />
    </form>
  );
}

/** 「ホームに案内をまた出す」 */
export function ReopenButton() {
  const [state, action, pending] = useActionState<MarkState, FormData>(reopenOnboardingAction, undefined);
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" disabled={pending} className="w-full sm:w-auto">
        {pending ? "記録しています…" : "ホームに案内をまた出す"}
      </Button>
      <Result state={state} />
    </form>
  );
}
