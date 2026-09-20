/**
 * 会社の台帳のまとめ（/executive/company?tab=basic の先頭）。
 * どのタブに何が入っているかを一目で分かるようにする。読むだけなのでサーバー部品のまま。
 */
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import type { Advisor, Guarantee, InsurancePolicy, Officer, Shareholder } from "@/lib/db/types";
import { qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXPIRY_BADGE, dateText, expiryText, expiryTone } from "./helpers";

/** 任期・満了の知らせの日数（v_executive_tasks と同じ） */
const TERM_SOON_DAYS = 90;
const EXPIRY_SOON_DAYS = 60;

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <MonthLink href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-2 hover:underline">
        {title}
        <ChevronRight className="h-4 w-4" />
      </MonthLink>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function LedgerSummary({
  officers,
  shareholders,
  policies,
  advisors,
  guarantees,
  today,
}: {
  officers: Officer[];
  shareholders: Shareholder[];
  policies: InsurancePolicy[];
  advisors: Advisor[];
  guarantees: Guarantee[];
  today: string;
}) {
  const activeOfficers = officers.filter((o) => o.is_active);
  const activePolicies = policies.filter((p) => p.is_active);
  const activeAdvisors = advisors.filter((a) => a.is_active);
  const activeGuarantees = guarantees.filter((g) => g.is_active);

  const shareTotal = shareholders.reduce((sum, s) => sum + Number(s.shares ?? 0), 0);
  const guaranteeTotal = activeGuarantees.reduce((sum, g) => sum + Number(g.amount ?? 0), 0);
  const nextPolicy = activePolicies
    .filter((p) => p.expires_on)
    .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""))[0];

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>台帳のまとめ</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Section title={`役員（${activeOfficers.length} 名）`} href="/executive/company?tab=officers">
          {activeOfficers.length === 0 ? (
            <p className="text-muted-foreground">まだ登録がありません。役員のタブから追加してください。</p>
          ) : (
            <ul className="space-y-1">
              {activeOfficers.map((o) => {
                const tone = expiryTone(today, o.term_end_on, TERM_SOON_DAYS);
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{o.name}</span>
                    <Badge variant="outline">{o.title}</Badge>
                    {tone !== "none" && tone !== "ok" && <Badge variant={EXPIRY_BADGE[tone]}>任期 {expiryText(today, o.term_end_on)}</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={`株主（${shareholders.length} 名）`} href="/executive/company?tab=shareholders">
          {shareholders.length === 0 ? (
            <p className="text-muted-foreground">まだ登録がありません。</p>
          ) : (
            <p className="num">発行済み {qty(shareTotal)} 株</p>
          )}
        </Section>

        <Section title={`保険（${activePolicies.length} 件）`} href="/executive/company?tab=insurance">
          {nextPolicy ? (
            <p className={cn(expiryTone(today, nextPolicy.expires_on, EXPIRY_SOON_DAYS) === "expired" && "text-destructive")}>
              いちばん早い満了は {nextPolicy.kind || "保険"}（{dateText(nextPolicy.expires_on)}／{expiryText(today, nextPolicy.expires_on)}）
            </p>
          ) : (
            <p className="text-muted-foreground">満了日の入った保険がありません。</p>
          )}
        </Section>

        <Section title={`顧問（${activeAdvisors.length} 件）`} href="/executive/company?tab=advisors">
          {activeAdvisors.length === 0 ? (
            <p className="text-muted-foreground">まだ登録がありません。</p>
          ) : (
            <p className="break-words">{activeAdvisors.map((a) => `${a.name}（${a.kind || "顧問"}）`).join("、")}</p>
          )}
        </Section>

        <Section title={`個人保証・担保（${activeGuarantees.length} 件）`} href="/executive/company?tab=guarantees">
          <p>
            代表が負っている合計 <Money value={guaranteeTotal} className="font-semibold" />
          </p>
        </Section>
      </CardContent>
    </Card>
  );
}
