import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { minutesText, type OnboardingProgress } from "~/server/features/onboarding/steps";

/** 最初の設定が終わっていないときの、やさしい案内（事務・オーナーだけに出す） */
export function OnboardingBanner({ progress }: { progress: OnboardingProgress }) {
  if (progress.complete || !progress.next) return null;
  const pct = Math.round((progress.doneCount / progress.total) * 100);
  return (
    <section aria-labelledby="onboarding-banner" className="mb-6 rounded-card border border-accent bg-accent/15 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p id="onboarding-banner" className="font-bold">
            最初の設定：{progress.total} つのうち {progress.doneCount} つ済み
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="最初の設定の進み具合">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm">
            次は「{progress.next.title}」です（{minutesText(progress.next.minutes)}）。残りは全部で{minutesText(progress.minutesLeft)}です。
          </p>
        </div>
        <Link href="/onboarding" className={buttonClass("primary", "w-full sm:w-auto")}>
          設定の続きへ
        </Link>
      </div>
    </section>
  );
}
