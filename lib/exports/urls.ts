/** 出力系エンドポイントの URL（画面から参照する。実装は app/api/export/*） */
export const exportUrls = {
  /** 稼働明細 CSV。month は "YYYY-MM" または "all" */
  entriesCsv: (month: string) => `/api/export/entries.csv?m=${encodeURIComponent(month)}`,
  /** 支払一覧 CSV。month は "YYYY-MM" または "all" */
  payoutsCsv: (month: string) => `/api/export/payouts.csv?m=${encodeURIComponent(month)}`,
  /** 個人明細 CSV */
  statementCsv: (month: string, driverId: string) => `/api/export/statement.csv?m=${encodeURIComponent(month)}&driver=${encodeURIComponent(driverId)}`,
  /** PDF 支払明細（A4 縦）。driver ロールは自分の締め済み月のみ */
  statementPdf: (month: string, driverId: string) => `/api/export/statement.pdf?m=${encodeURIComponent(month)}&driver=${encodeURIComponent(driverId)}`,
  /** 印刷用ページ（ブラウザ印刷） */
  statementPrint: (month: string, driverId: string) => `/payouts/${encodeURIComponent(driverId)}/print?m=${encodeURIComponent(month)}`,
  /** 全ドライバーの PDF 支払明細をまとめた ZIP（スタッフのみ） */
  statementsZip: (month: string) => `/api/export/statements.zip?m=${encodeURIComponent(month)}`,
  /** 弥生会計 仕訳インポート CSV（Shift_JIS） */
  yayoiCsv: (month: string) => `/api/export/yayoi.csv?m=${encodeURIComponent(month)}`,
  /** 単価表 CSV（稼働中のドライバー × 案件内容の実効単価と出所） */
  ratesCsv: () => "/api/export/rates.csv",
  /** 経費 CSV（その月の経費明細） */
  expensesCsv: (month: string) => `/api/export/expenses.csv?m=${encodeURIComponent(month)}`,
  /** 案件別採算 CSV。month は "YYYY-MM" または "all" */
  projectsCsv: (month: string) => `/api/export/projects.csv?m=${encodeURIComponent(month)}`,
  /** 資金繰り CSV（期間内の入金・支払の明細と残高） */
  cashflowCsv: (from: string, to: string) => `/api/export/cashflow.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  /** 請求書 PDF（A4 縦） */
  invoicePdf: (invoiceId: string) => `/api/export/invoice.pdf?id=${encodeURIComponent(invoiceId)}`,
  /** 請求書の印刷用ページ */
  invoicePrint: (invoiceId: string) => `/invoices/${encodeURIComponent(invoiceId)}/print`,
  /** 請求書一覧 CSV。month は "YYYY-MM" または "all" */
  invoicesCsv: (month: string) => `/api/export/invoices.csv?m=${encodeURIComponent(month)}`,
  /** 年次レポート CSV（月次推移）。year は西暦 4 桁 */
  reportCsv: (year: number) => `/api/export/report.csv?y=${encodeURIComponent(String(year))}`,
  /** ドライバー別の採算 CSV（その月。inactive で停止中も含める） */
  driversPlCsv: (month: string, includeInactive = false) => `/api/export/drivers-pl.csv?m=${encodeURIComponent(month)}${includeInactive ? "&inactive=1" : ""}`,
  /** バックアップ JSON（全テーブル） */
  backupJson: () => `/api/export/backup.json`,
  /** 締め時バックアップのダウンロード（Storage の署名付き URL へリダイレクト） */
  monthBackup: (month: string) => `/api/export/month-backup?m=${encodeURIComponent(month)}`,

  // ---------------------------------------------------------------------------
  // Excel（.xlsx）出力：CSV と同じ内容を、見出し・通貨書式・固定行つきで出す
  // ---------------------------------------------------------------------------
  entriesXlsx: (month: string) => `/api/export/entries.xlsx?m=${encodeURIComponent(month)}`,
  payoutsXlsx: (month: string) => `/api/export/payouts.xlsx?m=${encodeURIComponent(month)}`,
  expensesXlsx: (month: string) => `/api/export/expenses.xlsx?m=${encodeURIComponent(month)}`,
  invoicesXlsx: (month: string) => `/api/export/invoices.xlsx?m=${encodeURIComponent(month)}`,
  projectsXlsx: (month: string) => `/api/export/projects.xlsx?m=${encodeURIComponent(month)}`,
  driversPlXlsx: (month: string, includeInactive = false) =>
    `/api/export/drivers-pl.xlsx?m=${encodeURIComponent(month)}${includeInactive ? "&inactive=1" : ""}`,
  cashflowXlsx: (from: string, to: string) => `/api/export/cashflow.xlsx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  reportXlsx: (year: number) => `/api/export/report.xlsx?y=${encodeURIComponent(String(year))}`,
  ratesXlsx: () => "/api/export/rates.xlsx",
  statementXlsx: (month: string, driverId: string) =>
    `/api/export/statement.xlsx?m=${encodeURIComponent(month)}&driver=${encodeURIComponent(driverId)}`,
  alertsXlsx: (month: string, status = "open") =>
    `/api/export/alerts.xlsx?m=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`,
  bankXlsx: (status = "all") => `/api/export/bank.xlsx?status=${encodeURIComponent(status)}`,
  fleetXlsx: (kind: "vehicle" | "document") => `/api/export/fleet.xlsx?kind=${encodeURIComponent(kind)}`,
  hrXlsx: (kind: "applicant" | "contract") => `/api/export/hr.xlsx?kind=${encodeURIComponent(kind)}`,
  dailyXlsx: (month: string, kind: "report" | "entry") =>
    `/api/export/daily.xlsx?m=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`,

  /** 気になること CSV（その月。status で絞り込み）*/
  alertsCsv: (month: string, status = "open") =>
    `/api/export/alerts.csv?m=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`,
  /** 銀行明細 CSV（消込の状態で絞り込み）*/
  bankCsv: (status = "all") => `/api/export/bank.csv?status=${encodeURIComponent(status)}`,
  /** 車両 / 書類と期限の CSV */
  fleetCsv: (kind: "vehicle" | "document") => `/api/export/fleet.csv?kind=${encodeURIComponent(kind)}`,
  /** 応募者 / 業務委託契約の CSV */
  hrCsv: (kind: "applicant" | "contract") => `/api/export/hr.csv?kind=${encodeURIComponent(kind)}`,
  /** 点呼記録簿・業務記録 / 日別の稼働の CSV */
  dailyCsv: (month: string, kind: "report" | "entry") =>
    `/api/export/daily.csv?m=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`,

  // ---------------------------------------------------------------------------
  // 振込・月次パック・経営レポート（0014）
  // ---------------------------------------------------------------------------
  /** 全銀フォーマットの総合振込データ（Shift_JIS・固定長 120 バイト） */
  transferTxt: (month: string) => `/api/export/transfer.txt?m=${encodeURIComponent(month)}`,
  /** 振込一覧 CSV（銀行・支店・口座・金額。目視確認用） */
  transferCsv: (month: string) => `/api/export/transfer.csv?m=${encodeURIComponent(month)}`,
  /** 月次パック ZIP（明細 PDF・請求書 PDF・CSV・振込データを 1 つに）。parts で入れるものを選ぶ */
  monthPackZip: (month: string, parts?: string[]) =>
    `/api/export/month-pack.zip?m=${encodeURIComponent(month)}${parts && parts.length > 0 ? `&parts=${encodeURIComponent(parts.join(","))}` : ""}`,
  /** 月次の経営レポート PDF（P/L・経営指標・推移） */
  monthReportPdf: (month: string) => `/api/export/month-report.pdf?m=${encodeURIComponent(month)}`,
  /** 契約書ファイル（Storage の contracts バケット。署名付き URL へリダイレクト） */
  contractFile: (contractId: string) => `/api/contract-file?id=${encodeURIComponent(contractId)}`,

  // ---------------------------------------------------------------------------
  // 労務と支払通知（0018）
  // ---------------------------------------------------------------------------
  /** 労務 CSV（日ごとの拘束時間・実働・休息・連続勤務）。kind=day|month */
  laborCsv: (month: string, kind: "day" | "month" = "day") =>
    `/api/export/labor.csv?m=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`,
  /** 労務 Excel */
  laborXlsx: (month: string, kind: "day" | "month" = "day") =>
    `/api/export/labor.xlsx?m=${encodeURIComponent(month)}&kind=${encodeURIComponent(kind)}`,
  /** 支払通知の突合 CSV（1 件ぶんの明細と差） */
  noticeDiffCsv: (noticeId: string) => `/api/export/notice-diff.csv?id=${encodeURIComponent(noticeId)}`,

  // ---------------------------------------------------------------------------
  // 配車（0023）
  // ---------------------------------------------------------------------------
  /** 配車予定 CSV（期間。未指定なら今日から 2 週間） */
  dispatchCsv: (from?: string, to?: string) =>
    from && to ? `/api/export/dispatch.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "/api/export/dispatch.csv",

  // ---------------------------------------------------------------------------
  // 法定帳票と監査（0024）
  // ---------------------------------------------------------------------------
  /** 法定帳票 CSV（kind=roster|instruction|incident|aptitude。期間は任意） */
  complianceCsv: (kind: "roster" | "instruction" | "incident" | "aptitude", from?: string, to?: string) =>
    `/api/export/compliance.csv?kind=${encodeURIComponent(kind)}${from && to ? `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ""}`,
  /** 運転者台帳 PDF（1 人 1 ページ。all=1 で退職した人も） */
  rosterPdf: (includeRetired = false) => `/api/export/roster.pdf${includeRetired ? "?all=1" : ""}`,
  /** 監査一式 ZIP（期間。parts で入れるものを選ぶ） */
  auditPackZip: (from?: string, to?: string, parts?: string[]) => {
    const q = new URLSearchParams();
    if (from && to) {
      q.set("from", from);
      q.set("to", to);
    }
    if (parts && parts.length > 0) q.set("parts", parts.join(","));
    const s = q.toString();
    return `/api/export/audit-pack.zip${s ? `?${s}` : ""}`;
  },
};
