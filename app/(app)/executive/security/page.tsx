import { requirePageRole } from "@/lib/auth/session";
import { loadExportLogs, loadLoginEvents } from "@/lib/executive/queries";
import { toConfidentialScope } from "@/lib/db/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ExportLogsCard, LoginEventsCard } from "@/components/executive/security-view";
import { ConfidentialForm } from "@/components/executive/confidential-form";

export const metadata = { title: "守り" };

/** 一覧の読み込み上限（どちらも 1 年で自動的に消える） */
const LOGIN_LIMIT = 100;
const EXPORT_LIMIT = 100;

/**
 * 守り（/executive/security）：代表（owner）専用
 *
 * 稼動月（?m）には依存しない。ログインの記録・持ち出しの記録は代表しか読めない（RLS）。
 * 機密の見せ方（confidential_scope）を変えると、画面だけでなく RLS ごと変わる。
 */
export default async function ExecutiveSecurityPage() {
  const { supabase, company } = await requirePageRole(["owner"]);

  const [events, logs] = await Promise.all([
    loadLoginEvents(supabase, company.id, LOGIN_LIMIT),
    loadExportLogs(supabase, company.id, { limit: EXPORT_LIMIT }),
  ]);

  const sensitive = logs.filter((l) => l.is_sensitive).length;

  return (
    <div className="space-y-4">
      <PageHeader title="守り" description="誰が入ったか、誰が何を持ち出したか。そして、機密をどこまで見せるか。" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">ログインの記録</p>
            <p className="num mt-1 text-lg font-semibold md:text-xl">{events.length} 件</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">持ち出しの記録</p>
            <p className="num mt-1 text-lg font-semibold md:text-xl">{logs.length} 件</p>
          </CardContent>
        </Card>
        <Card className={sensitive > 0 ? "border-warning/40 bg-warning/5" : undefined}>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">個人情報を含む持ち出し</p>
            <p className="num mt-1 text-lg font-semibold text-warning md:text-xl">{sensitive} 件</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 md:p-4">
            <p className="text-xs text-muted-foreground">記録が残る期間</p>
            <p className="mt-1 text-lg font-semibold md:text-xl">1 年</p>
          </CardContent>
        </Card>
      </div>

      <LoginEventsCard events={events} />
      <ExportLogsCard logs={logs} />
      <ConfidentialForm scope={toConfidentialScope(company.confidential_scope)} />
    </div>
  );
}
