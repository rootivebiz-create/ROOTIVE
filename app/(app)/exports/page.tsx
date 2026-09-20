/**
 * 出力センター（/exports）
 * 「月末にボタン 1 つでその月の一式が手に入る」入口。分類ごとにカードを並べ、その場でダウンロードできる。
 * URL は lib/exports/urls.ts の exportUrls だけを使う。振込データとバックアップは閲覧者には出さない。
 */
import { BarChart3, Building2, ClipboardList, Database, FileSpreadsheet, FileText, Receipt, Wallet } from "lucide-react";
import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadMonthSummary } from "@/lib/db/queries";
import { exportUrls } from "@/lib/exports/urls";
import { addMonths, daysInMonth, formatMonthJa, monthFromParam, monthToDate } from "@/lib/month";
import { qty } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { DownloadLink, ExportCard, ExportPageLink, ExportRow } from "@/components/exports/export-card";
import { MonthPackCard } from "@/components/exports/month-pack-card";

export const metadata = { title: "出力" };

export default async function ExportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, profile, company } = await requireStaff();
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const monthLabel = formatMonthJa(month);
  const admin = canEdit(profile.role);
  const year = Number(month.slice(0, 4));

  const [summary, invoicesRes] = await Promise.all([
    loadMonthSummary(supabase, company.id, month),
    supabase.from("v_invoice_list").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("month", monthToDate(month)),
  ]);
  const closed = summary.status === "closed";
  const invoiceCount = invoicesRes.error ? 0 : (invoicesRes.count ?? 0);

  // 資金繰りは当月から 3 か月先までを既定の期間にする
  const cashTo = addMonths(month, 2);
  const cashFrom = monthToDate(month);
  const cashToDate = `${cashTo}-${String(daysInMonth(cashTo)).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="出力"
        description={`${monthLabel}の出力をまとめた画面です。必要なものをその場でダウンロードできます。`}
      />

      <Alert variant={closed ? "success" : "warning"}>
        <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={closed ? "success" : "warning"}>{closed ? "締め済み" : "未締め"}</Badge>
          <span className="font-medium">{monthLabel}</span>
          <span>稼働 {qty(summary.entry_count)} 件</span>
          <span>ドライバー {qty(summary.driver_count)} 名</span>
          <span>請求書 {qty(invoiceCount)} 件</span>
          <span className="text-xs">
            {closed ? "この月は締め済みです。金額は確定値です。" : "この月はまだ締めていません。出力の金額は速報値で、締めると確定します。"}
          </span>
        </AlertDescription>
      </Alert>

      {!admin ? (
        <p className="text-xs text-muted-foreground">閲覧者は CSV・Excel・PDF を出力できます（月次パック・振込データ・バックアップは管理者以上）。</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {admin ? <MonthPackCard month={month} monthLabel={monthLabel} canTransfer={admin} /> : null}

        <ExportCard title="経営レポート" description="その月の数字を 1 つの PDF にまとめます。会議や金融機関への説明にそのまま使えます。" icon={FileText}>
          <ExportRow label={`${monthLabel} 経営レポート（PDF）`} description="損益サマリー・経営指標・目標の進捗・12 か月の推移・ドライバー別と案件別の採算・気になることを A4 にまとめます。">
            <DownloadLink href={exportUrls.monthReportPdf(month)} primary>
              PDF
            </DownloadLink>
          </ExportRow>
        </ExportCard>

        <ExportCard title="支払" description="ドライバーへの支払に使う出力です。金額は税込のお支払額を含みます。" icon={Wallet}>
          <ExportRow label="支払一覧" description="ドライバーごとの支払額・消費税・会社利益の一覧。支払額の確認に使います。">
            <DownloadLink href={exportUrls.payoutsCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.payoutsXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="支払明細 PDF（全員分）" description="ドライバーごとの支払明細をまとめた ZIP。印刷して本人に渡せます。">
            <DownloadLink href={exportUrls.statementsZip(month)}>ZIP</DownloadLink>
          </ExportRow>
          {admin ? (
            <ExportRow label="振込データ" description="銀行に取り込む全銀フォーマットと確認用の一覧。口座情報を含むので取り扱いに注意してください。">
              <ExportPageLink href="/payouts/transfer">振込データを作る</ExportPageLink>
            </ExportRow>
          ) : null}
        </ExportCard>

        <ExportCard title="請求" description="取引先への請求に使う出力です。請求書 PDF は請求の画面から 1 件ずつ出せます。" icon={Receipt}>
          <ExportRow label="請求書一覧" description="その月の請求書の金額・状態・入金日の一覧。入金の確認に使います。">
            <DownloadLink href={exportUrls.invoicesCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.invoicesXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="請求書 PDF" description="1 件ずつの請求書は請求の画面から出します（月次パックにはまとめて入ります）。">
            <ExportPageLink href="/invoices">請求の画面へ</ExportPageLink>
          </ExportRow>
        </ExportCard>

        <ExportCard title="会計" description="会計ソフト・税理士へ渡す出力です。金額はすべて税抜です。" icon={Building2}>
          <ExportRow label="弥生会計 仕訳 CSV" description="弥生会計にそのまま取り込める仕訳データ（Shift_JIS）。">
            <DownloadLink href={exportUrls.yayoiCsv(month)}>当月</DownloadLink>
            <DownloadLink href={exportUrls.yayoiCsv("all")}>全期間</DownloadLink>
          </ExportRow>
          <ExportRow label="経費" description="その月の経費の明細。領収書の整理や経費の申告に使います。">
            <DownloadLink href={exportUrls.expensesCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.expensesXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="稼働明細" description="稼働 1 行ごとの売上・支払・利益。数字の根拠を見せるときに使います。">
            <DownloadLink href={exportUrls.entriesCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.entriesXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
        </ExportCard>

        <ExportCard title="分析" description="推移・採算・資金繰りを表計算で見たいときの出力です。" icon={BarChart3}>
          <ExportRow label={`年次レポート（${year}年）`} description="月ごとの売上・経費・営業利益の推移。年間の振り返りに使います。">
            <DownloadLink href={exportUrls.reportCsv(year)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.reportXlsx(year)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="案件別採算" description="案件ごとの売上・利益・目標との差。続けるかやめるかの判断に使います。">
            <DownloadLink href={exportUrls.projectsCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.projectsXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="ドライバー別採算" description="ドライバーごとの売上・支払・会社利益。単価の見直しに使います。">
            <DownloadLink href={exportUrls.driversPlCsv(month)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.driversPlXlsx(month)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="資金繰り（3 か月先まで）" description="入金予定と支払予定を日付順に並べた表。残高が足りるかの確認に使います。">
            <DownloadLink href={exportUrls.cashflowCsv(cashFrom, cashToDate)}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.cashflowXlsx(cashFrom, cashToDate)}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="単価表" description="ドライバー × 案件内容の実効単価と、その単価がどこから来たか。">
            <DownloadLink href={exportUrls.ratesCsv()}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.ratesXlsx()}>Excel</DownloadLink>
          </ExportRow>
        </ExportCard>

        <ExportCard title="記録" description="法令対応や監査で「記録を出してください」と言われたときの出力です。" icon={ClipboardList}>
          <ExportRow label="日報・点呼" description="業務前後の点呼と業務記録。1 年保存が必要な記録です。">
            <DownloadLink href={exportUrls.dailyCsv(month, "report")}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.dailyXlsx(month, "report")}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="日別の稼働" description="日ごとの稼働報告（承認済みが月次の数量になります）。">
            <DownloadLink href={exportUrls.dailyCsv(month, "entry")}>CSV</DownloadLink>
            <DownloadLink href={exportUrls.dailyXlsx(month, "entry")}>Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="車両と書類" description="車検・保険・免許の期限一覧。期限切れの確認に使います。">
            <DownloadLink href={exportUrls.fleetCsv("vehicle")}>車両 CSV</DownloadLink>
            <DownloadLink href={exportUrls.fleetXlsx("vehicle")}>車両 Excel</DownloadLink>
            <DownloadLink href={exportUrls.fleetCsv("document")}>書類 CSV</DownloadLink>
            <DownloadLink href={exportUrls.fleetXlsx("document")}>書類 Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="採用と契約" description="応募者の進み具合と業務委託契約の期限。">
            <DownloadLink href={exportUrls.hrCsv("applicant")}>応募者 CSV</DownloadLink>
            <DownloadLink href={exportUrls.hrXlsx("applicant")}>応募者 Excel</DownloadLink>
            <DownloadLink href={exportUrls.hrCsv("contract")}>契約 CSV</DownloadLink>
            <DownloadLink href={exportUrls.hrXlsx("contract")}>契約 Excel</DownloadLink>
          </ExportRow>
          <ExportRow label="書類の索引簿" description="レシート・請求書・支払通知・契約書の一覧（電子帳簿保存法の検索要件）。条件を絞って出したいときは「書類の検索」から。">
            <DownloadLink href="/api/export/records.csv">CSV</DownloadLink>
            <ExportPageLink href="/records">書類の検索へ</ExportPageLink>
          </ExportRow>
          <ExportRow label="気になること・銀行明細" description="未対応のアラートと、取り込んだ銀行明細の消込状況。">
            <DownloadLink href={exportUrls.alertsCsv(month)}>気になること CSV</DownloadLink>
            <DownloadLink href={exportUrls.alertsXlsx(month)}>気になること Excel</DownloadLink>
            <DownloadLink href={exportUrls.bankCsv()}>銀行明細 CSV</DownloadLink>
            <DownloadLink href={exportUrls.bankXlsx()}>銀行明細 Excel</DownloadLink>
          </ExportRow>
        </ExportCard>

        {admin ? (
          <ExportCard title="バックアップ" description="データそのものの控えです。パソコンや外付けディスクに保存してください。" icon={Database}>
            <ExportRow label="全データ JSON" description="今この瞬間の全テーブルの控え。復元（取り込み）はオーナーのみ行えます。">
              <DownloadLink href={exportUrls.backupJson()}>JSON</DownloadLink>
            </ExportRow>
            <ExportRow label="締め時バックアップ" description={closed ? `${monthLabel}を締めた時点の控え。締めたときの数字をそのまま残せます。` : "月を締めると自動で保存されます。締めるまではダウンロードできません。"}>
              {closed ? <DownloadLink href={exportUrls.monthBackup(month)}>JSON</DownloadLink> : <ExportPageLink href="/settings/months">月締めの画面へ</ExportPageLink>}
            </ExportRow>
          </ExportCard>
        ) : null}

        <ExportCard title="そのほか" description="ファイルの形式と文字コードについて。" icon={FileSpreadsheet}>
          <ExportRow label="CSV と Excel の違い" description="CSV は UTF-8（BOM 付き）でどのソフトでも開けます。Excel（.xlsx）は見出し・通貨書式つきでそのまま印刷できます。">
            <ExportPageLink href="/settings/data">データの画面へ</ExportPageLink>
          </ExportRow>
        </ExportCard>
      </div>
    </div>
  );
}
