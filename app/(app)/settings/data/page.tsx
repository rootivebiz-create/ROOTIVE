import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { requireStaff, canEdit, canManage, canSeeManagement, isOwner } from "@/lib/auth/session";
import { dateToMonth, formatMonthJa, monthFromParam } from "@/lib/month";
import { exportUrls } from "@/lib/exports/urls";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackupsList, type BackupRow } from "@/components/settings/data/backups-list";
import { ImportPanel } from "@/components/settings/data/import-panel";
import { SeedPanel } from "@/components/settings/data/seed-panel";
import { ResetPanel } from "@/components/settings/data/reset-panel";

export const metadata = { title: "データ" };

function DownloadLink({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a href={href} download className={cn(buttonVariants({ variant: primary ? "default" : "outline", size: "sm" }))}>
      {children}
    </a>
  );
}

export default async function DataSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const admin = canEdit(profile.role);
  const owner = isOwner(profile.role);
  // バックアップ（全テーブルの控え）と支払 CSV（会社利益を含む）は事務員には出さない（0027）
  const manager = canManage(profile.role);
  const management = canSeeManagement(profile.role);

  const [closingsRes, driversRes] = await Promise.all([
    supabase.from("month_closings").select("month, closed_at, backup_path").eq("company_id", company.id).order("month", { ascending: false }),
    supabase.from("drivers").select("id", { count: "exact" }).eq("company_id", company.id).limit(1),
  ]);
  if (closingsRes.error) throw closingsRes.error;
  if (driversRes.error) throw driversRes.error;

  // 埋め込みフィルタ（not.is.null）は互換サーバーの範囲外のため、取得後に絞る（月数ぶんの小さな表）
  const backups: BackupRow[] = (closingsRes.data ?? [])
    .filter((c): c is typeof c & { backup_path: string } => typeof c.backup_path === "string" && c.backup_path.length > 0)
    .map((c) => ({ month: dateToMonth(c.month), closedAt: c.closed_at, backupPath: c.backup_path }));
  const driverCount = driversRes.count ?? (driversRes.data ?? []).length;
  const monthLabel = formatMonthJa(month);

  return (
    <div>
      <PageHeader title="データ" description="CSV・バックアップ JSON の出力、締め時バックアップ、取り込み・復元、初期データ、データ全削除。" />

      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>出力</CardTitle>
              <CardDescription>
                CSV は UTF-8（BOM 付き）で Excel でそのまま開けます。弥生 CSV は Shift_JIS の仕訳インポート形式です。当月は稼動月セレクタの月（{monthLabel}）です。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <section className="space-y-2">
                <h3 className="flex items-center gap-1 text-sm font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> 稼働 CSV
                </h3>
                <div className="flex flex-wrap gap-2">
                  <DownloadLink href={exportUrls.entriesCsv(month)}>
                    <Download /> 当月（{monthLabel}）
                  </DownloadLink>
                  <DownloadLink href={exportUrls.entriesCsv("all")}>
                    <Download /> 全期間
                  </DownloadLink>
                </div>
              </section>
              {management && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1 text-sm font-semibold">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> 支払 CSV
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <DownloadLink href={exportUrls.payoutsCsv(month)}>
                      <Download /> 当月（{monthLabel}）
                    </DownloadLink>
                    <DownloadLink href={exportUrls.payoutsCsv("all")}>
                      <Download /> 全期間
                    </DownloadLink>
                  </div>
                </section>
              )}
              <section className="space-y-2">
                <h3 className="flex items-center gap-1 text-sm font-semibold">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /> 弥生会計 仕訳 CSV
                </h3>
                <div className="flex flex-wrap gap-2">
                  <DownloadLink href={exportUrls.yayoiCsv(month)}>
                    <Download /> 当月（{monthLabel}）
                  </DownloadLink>
                  <DownloadLink href={exportUrls.yayoiCsv("all")}>
                    <Download /> 全期間
                  </DownloadLink>
                </div>
              </section>
              {manager ? (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1 text-sm font-semibold">
                    <FileJson className="h-4 w-4 text-muted-foreground" /> バックアップ JSON
                  </h3>
                  <p className="text-xs text-muted-foreground">全テーブルのスナップショット。復元（取り込み）はオーナーのみ行えます。</p>
                  <div className="flex flex-wrap gap-2">
                    <DownloadLink href={exportUrls.backupJson()} primary>
                      <Download /> バックアップ JSON を保存
                    </DownloadLink>
                  </div>
                </section>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {admin ? "事務員は CSV 出力のみ利用できます（バックアップ JSON は管理者以上）。" : "閲覧者は CSV 出力のみ利用できます（バックアップ JSON は管理者以上）。"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>締め時バックアップ</CardTitle>
              <CardDescription>月を締めた時点で自動保存されたバックアップ JSON（{backups.length} 件）。</CardDescription>
            </CardHeader>
            <CardContent>
              <BackupsList rows={backups} canDownload={manager} />
            </CardContent>
          </Card>
        </div>

        {owner && <ImportPanel />}

        {manager && driverCount === 0 && <SeedPanel />}

        {owner && <ResetPanel companyName={company.name} />}
      </div>
    </div>
  );
}
