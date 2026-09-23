import Link from "next/link";
import { MAINTENANCE_INCLUDES, OPTIONS, PLANS, type Plan } from "@/site.config";
import { CheckIcon, Section, cx, ctaClass, regNoText, yenText } from "./section";

/** 月額のない「お試し」（無ければ null） */
export function trialPlan(): Plan | null {
  return PLANS.find((p) => p.monthlyYen === 0) ?? null;
}

/** 構築して毎月使うパック（月額のあるもの） */
export function buildPlans(): Plan[] {
  return PLANS.filter((p) => p.monthlyYen > 0);
}

function PriceRow({ label, value, sub, plain }: { label: string; value: string; sub?: string; plain?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <span className={plain ? "font-bold" : "num text-xl font-bold"}>{value}</span>
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const oneOff = plan.monthlyYen === 0;
  return (
    <li
      className={cx(
        "relative flex flex-col rounded-card bg-card p-5",
        plan.featured ? "border-2 border-foreground shadow-sm" : "border border-border",
      )}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-4 rounded-full bg-accent px-3 py-0.5 text-xs font-bold text-accent-foreground">
          おすすめ
        </span>
      )}
      <h3 className="text-lg font-bold leading-snug">{plan.name}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{plan.forWhom}</p>
      <dl className="mt-3">
        <PriceRow label={oneOff ? "費用（1回）" : "初期費用"} value={yenText(plan.initialYen)} sub="税抜" />
        <PriceRow label="月額" value={oneOff ? "なし" : yenText(plan.monthlyYen)} sub={oneOff ? undefined : "税抜"} />
        <PriceRow label="期間の目安" value={plan.weeks} plain />
      </dl>
      <ul className="mt-4 flex-1 space-y-2 text-sm leading-relaxed">
        {plan.includes.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckIcon small className="mt-1" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {plan.note && <p className="mt-4 rounded-lg bg-muted p-3 text-sm leading-relaxed">{plan.note}</p>}
    </li>
  );
}

export function Pricing({ invoiceRegNo }: { invoiceRegNo: string | null }) {
  return (
    <Section
      id="ryokin"
      title="料金（税抜）"
      lead={
        <ul className="space-y-1">
          <li>月額は、ドライバーは何人でも同じです。</li>
          <li>サーバー代はお客様が直接お支払いください（見積で目安をお示しします）。</li>
          {invoiceRegNo && <li className="num">インボイス登録番号 {regNoText(invoiceRegNo)}</li>}
        </ul>
      }
    >
      <ul className="grid gap-6 pt-3 lg:grid-cols-3 lg:gap-4">
        {PLANS.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </ul>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="options-title" className="rounded-card border border-border bg-card p-5">
          <h3 id="options-title" className="font-bold">
            オプション
          </h3>
          <ul className="mt-2 space-y-4">
            {OPTIONS.map((o) => (
              <li key={o.id}>
                <p className="font-bold leading-snug">{o.name}</p>
                <dl className="mt-1">
                  <PriceRow label="初期費用" value={yenText(o.initialYen)} sub="税抜" />
                  <PriceRow label="月額" value={yenText(o.monthlyYen)} sub="税抜" />
                </dl>
                {o.note && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{o.note}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="maintenance-title" className="rounded-card border border-border bg-card p-5">
          <h3 id="maintenance-title" className="font-bold">
            月額（保守）に含むもの
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {MAINTENANCE_INCLUDES.map((m) => (
              <li key={m} className="flex gap-2">
                <CheckIcon small className="mt-1" />
                <span>{m}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            これを超える変更は、内容をうかがって別にお見積りします。保守の範囲は契約書にも書きます。
          </p>
        </section>
      </div>

      <div className="no-print mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href="/contact" className={ctaClass("accent", "w-full sm:w-auto")}>
          見積を相談する（無料）
        </Link>
        <Link href="/demo" className={ctaClass("secondary", "w-full sm:w-auto")}>
          先にデモを触る
        </Link>
      </div>
    </Section>
  );
}
