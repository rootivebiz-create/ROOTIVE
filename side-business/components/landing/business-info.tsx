import Link from "next/link";
import type { BusinessInfo as Info } from "@/site.config";
import { SITE } from "@/site.config";
import { Section } from "./section";

export function BusinessInfo({ info, email }: { info: Info; email: string | null }) {
  const rows: { label: string; value: string; href?: string }[] = [{ label: "屋号", value: SITE.name }];
  if (info.ownerName) rows.push({ label: "事業者名", value: info.ownerName });
  if (info.address) rows.push({ label: "所在地", value: info.address });
  if (info.phone) rows.push({ label: "電話", value: info.phone, href: `tel:${info.phone.replace(/[^\d+]/g, "")}` });
  if (email) rows.push({ label: "メール", value: email, href: `mailto:${email}` });
  if (info.invoiceRegNo) rows.push({ label: "インボイス登録番号", value: info.invoiceRegNo });
  const onlyName = rows.length === 1;

  return (
    <Section id="jigyosha" title="事業者の情報">
      <dl className="rounded-card border border-border bg-card px-4 sm:px-5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
            <dt className="text-sm font-bold text-muted-foreground sm:w-40 sm:shrink-0">{r.label}</dt>
            <dd className="break-all">
              {r.href ? (
                <a href={r.href} className="inline-flex min-h-11 items-center">
                  {r.value}
                </a>
              ) : (
                r.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {onlyName && <p className="mt-3 text-sm text-muted-foreground">事業者の詳しい情報は準備中です。</p>}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        個人で営む事業です。当方からのご案内が不要な場合は、<Link href="/contact">相談フォーム</Link>
        {email ? "かメール" : ""}でお知らせください。以後はお送りしません。
      </p>
    </Section>
  );
}
