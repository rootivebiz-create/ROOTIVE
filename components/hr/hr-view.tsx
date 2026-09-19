/**
 * 採用と契約（/hr）の画面。稼動月には依存しない。
 * タブ（?tab=applicants|contracts）だけをサーバー側で切り替え、中身はそれぞれの client 部品に渡す。
 */
import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { hrCsvUrl } from "@/lib/exports/hr-csv";
import type { HrTab } from "@/lib/schemas/hr";
import { contractAlerts, isOpenStage, staleApplicants, type ApplicantEventView, type ApplicantView, type ContractView, type DriverLike } from "@/lib/hr/helpers";
import { cn } from "@/lib/utils";
import { ApplicantsPanel } from "./applicants-panel";
import { ContractsPanel } from "./contracts-panel";

export interface HrViewProps {
  tab: HrTab;
  applicants: ApplicantView[];
  events: ApplicantEventView[];
  contracts: ContractView[];
  /** 契約の相手に選べるドライバー */
  drivers: DriverLike[];
  /** 日本時間の今日 "YYYY-MM-DD"（サーバーで決めた値を画面でも使う） */
  today: string;
  /** owner / admin */
  canEdit: boolean;
}

export function HrView({ tab, applicants, events, contracts, drivers, today, canEdit }: HrViewProps) {
  const inProgress = applicants.filter((a) => isOpenStage(a.stage)).length;
  const stale = staleApplicants(applicants, today).length;
  const alerts = contractAlerts(contracts);
  const attention = alerts.renewal.length + alerts.expired.length;

  const tabs: { key: HrTab; label: string; count: number; badge: number }[] = [
    { key: "applicants", label: "採用", count: inProgress, badge: stale },
    { key: "contracts", label: "契約", count: contracts.length, badge: attention },
  ];

  return (
    <div>
      <PageHeader
        title="採用と契約"
        description="応募から稼働開始までの進み具合と、業務委託契約の期限をまとめて確認できます。"
        actions={
          <a href={hrCsvUrl(tab === "contracts" ? "contract" : "applicant")} download className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Download className="h-4 w-4" />
            CSV
          </a>
        }
      />

      {/* タブ（?tab=） */}
      <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex gap-1 rounded-md bg-muted p-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/hr?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                tab === t.key && "bg-card text-foreground shadow",
              )}
            >
              {t.label}
              <span className="num text-xs">({t.count})</span>
              {t.badge > 0 && <span className="num rounded-full bg-warning px-1.5 text-xs font-semibold text-white">{t.badge}</span>}
            </Link>
          ))}
        </div>
      </div>

      {tab === "contracts" ? (
        <ContractsPanel contracts={contracts} drivers={drivers} today={today} canEdit={canEdit} />
      ) : (
        <ApplicantsPanel applicants={applicants} events={events} today={today} canEdit={canEdit} />
      )}
    </div>
  );
}
